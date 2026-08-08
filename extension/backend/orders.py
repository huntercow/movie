"""订单状态机编排:插件契约的订单操作 + 良票下单/支付/出票推进。

状态流转(插件契约固定):
    20(已报价)→ 25(已改价)→ 30(已付款,良票下单支付)→ 50(出票待交付)/ 450(退款)
    45 = 交付失败转人工(内部);90 = 平台取消。
"""
from __future__ import annotations

import logging
from typing import Any

from . import db
from .liangpiao_client import LiangPiaoClient, LiangPiaoError
from .quote import build_submit_seats

logger = logging.getLogger("backend.orders")


class OrderStateError(Exception):
    """订单状态不允许的操作(如对不存在的订单回写)。"""


def require_order(db_path: str, user_id: int, order_id: str) -> dict[str, Any]:
    order = db.get_order(db_path, user_id, order_id)
    if order is None:
        raise OrderStateError(f"order not found: {order_id}")
    return order


def advance_paid_order(
    db_path: str,
    client: LiangPiaoClient,
    user_id: int,
    order_id: str,
    actual_amount_cents: int,
) -> None:
    """status 25 → 30:良票下单 + 支付。下单失败回退 25(插件下次重试)。"""
    order = require_order(db_path, user_id, order_id)
    if order["status"] != "25":
        raise OrderStateError(f"order {order_id} is not in status 25")

    seats = build_submit_seats(order)
    try:
        order_number = client.with_auto_relogin(
            lambda: client.submit_order(
                show_id=order["show_id"],
                seats=seats,
                price_cents=order["bidding_price_cents"],
                official_quotation_id=order["official_quotation_id"] or "",
                official_channel_number=order["official_channel"] or 1,
            )
        )
        client.with_auto_relogin(lambda: client.pay_order(order_number))
    except LiangPiaoError as error:
        # 上游失败:回退 25 并记录原因,插件收到付款卡后会重新校验重试。
        db.update_order_status(
            db_path,
            user_id,
            order_id,
            "25",
            failure_reason=f"UPSTREAM_ORDER_FAILED: {error}",
        )
        # TODO(notify): 余额不足/下单失败需要人工介入(充值良票余额/处理订单),
        # 此处应推送告警通知(钉钉群 webhook / 闲鱼 IM / manage 页待办)。
        # 当前只打高可见性告警日志,通知通道待定后接入。
        logger.warning(
            "[订单][ALERT] %s 良票下单失败需人工处理: %s (status 已回退 25, "
            "买家已付款但未出票, 应尽快取消闲鱼订单或充值后重试)",
            order_id,
            error,
        )
        raise

    db.update_order_status(
        db_path,
        user_id,
        order_id,
        "30",
        upstream_order_number=order_number,
        failure_reason=None,
    )
    logger.info("[订单] %s → 30,上游订单号 %s", order_id, order_number)


def poll_upstream_ticket_status(
    db_path: str, client: LiangPiaoClient, user_id: int
) -> None:
    """推进 status 30 订单:查良票详情 → 出票(5)→ 50 / 退款(12)→ 450。"""
    pending = db.get_orders_by_status(db_path, user_id, ["30"])
    for order in pending:
        order_number = order.get("upstream_order_number")
        if not order_number:
            continue
        try:
            detail = client.with_auto_relogin(
                lambda: client.get_order_detail(order_number)
            )
        except LiangPiaoError:
            continue  # 暂不可查,等下次轮询
        if detail.order_status == 5:
            ticket_codes = [
                ticket.ticket_code or ticket.ticket or ""
                for ticket in detail.tickets
            ]
            ticket_codes = [code for code in ticket_codes if code]
            db.update_order_status(
                db_path,
                user_id,
                order["id"],
                "50",
                upstream_order_id=detail.order_id,
                ticket_codes=ticket_codes,
                ticket_images=[""] * len(ticket_codes),
            )
            logger.info("[订单] %s → 50,票码 %s", order["id"], ticket_codes)
        elif detail.order_status == 12:
            db.update_order_status(
                db_path,
                user_id,
                order["id"],
                "450",
                upstream_order_id=detail.order_id,
                failure_reason=detail.failed_reason,
            )
            logger.info("[订单] %s → 450,退款", order["id"])


def pending_deliveries(db_path: str, user_id: int) -> list[dict[str, Any]]:
    """待交付订单(status 50/450 且未结算)。"""
    orders = db.get_orders_by_status(db_path, user_id, ["50", "450"])
    return [order for order in orders if not order["delivered"]]


def settle_delivery(
    db_path: str,
    user_id: int,
    order_id: str,
    result: str,
    failure_stage: str | None = None,
    sent_image_count: int | None = None,
    notice_sent: bool | None = None,
    cancel_succeeded: bool | None = None,
) -> None:
    """交付结算:成功后标记 delivered;失败转人工(45);出票失败已处理标记 delivered。"""
    order = require_order(db_path, user_id, order_id)
    if result == "DELIVERY_SUCCEEDED":
        db.update_order_status(db_path, user_id, order_id, order["status"], delivered=1)
    elif result == "DELIVERY_FAILED":
        stage = failure_stage or "UNKNOWN"
        db.update_order_status(
            db_path,
            user_id,
            order_id,
            "45",
            delivered=1,
            failure_reason=f"DELIVERY_FAILED:{stage}:{sent_image_count}",
        )
    elif result == "TICKET_FAILURE_HANDLED":
        db.update_order_status(
            db_path,
            user_id,
            order_id,
            order["status"],
            delivered=1,
            failure_reason=f"NOTICE_SENT={notice_sent},CANCEL={cancel_succeeded}",
        )
    else:
        raise OrderStateError(f"unknown delivery result: {result}")
    logger.info("[订单] %s 交付结算 %s", order_id, result)
