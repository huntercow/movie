"""报价链路:截图下载 → OSS 上传 → 良票 OCR → 双通道报价 → 后端定价 → 建订单。

报价策略(后端实现,插件无感知):
    基础报价 = max(限价, 一口价) + quoteFloatCents(固定加价)
    若 基础报价 - 成本 > diffThresholdCents:
        报价 += (基础报价 - 成本) × diffMarkupPercent / 100
成本 = 良票识别返回的整单净价(totalImagePrice,缺失时取座位价之和)。
"""
from __future__ import annotations

import re
import time
import uuid
from datetime import datetime, timezone
import logging
from typing import Any

import requests

from . import db
from .config import Settings
from .liangpiao_client import BUSINESS, LiangPiaoClient, LiangPiaoError, SubmitSeat

logger = logging.getLogger("backend.quote")

# 距开场不足该时长视为「场次太近,不出票」
SHOW_TIME_MIN_LEAD_MS = 40 * 60 * 1000

DOWNLOAD_TIMEOUT_SECONDS = 20


class QuoteBusinessError(Exception):
    """业务失败(识别不了/场次太近):映射为 FAILED 响应,插件发对应话术。"""

    def __init__(self, failure_code: str, upstream_message: str = ""):
        super().__init__(failure_code)
        self.failure_code = failure_code  # SHOW_TIME_TOO_SHORT | IDENTIFY_FAIL
        # 上游(良票)原始返回 message,便于定位失败原因
        self.upstream_message = upstream_message


class QuoteNetworkError(Exception):
    """网络/上游失败:向上抛,插件侧重试。"""


def apply_quote_strategy(
    strategy: dict[str, int], base_cents: int, net_cents: int
) -> int:
    """按报价策略计算单座售价(分)。"""
    float_cents = strategy.get("float_cents", 0)
    threshold = strategy.get("diff_threshold_cents", 0)
    percent = strategy.get("diff_markup_percent", 0)
    bidding = base_cents + float_cents
    margin = bidding - net_cents
    if margin > threshold and percent > 0:
        bidding += margin * percent // 100
    return bidding


def parse_seat_row_col(seat_name: str) -> tuple[int, int]:
    match = re.match(r"(\d+)\s*排\s*(\d+)\s*座", seat_name)
    if match is None:
        raise QuoteBusinessError("IDENTIFY_FAIL")
    return int(match.group(1)), int(match.group(2))


def _download_image(settings: Settings, url: str) -> tuple[bytes, str]:
    try:
        response = requests.get(
            url,
            headers={"User-Agent": settings.liangpiao_user_agent},
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise QuoteNetworkError(f"download seats image failed: {error}") from error
    if response.status_code != 200 or not response.content:
        raise QuoteNetworkError(
            f"download seats image returned HTTP {response.status_code}"
        )
    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
    return response.content, content_type


def _show_time_iso(show_time_ms: int) -> str:
    """Unix 毫秒 → 插件契约要求的 ISO 8601 带时区字符串。"""
    dt = datetime.fromtimestamp(show_time_ms / 1000, tz=timezone.utc).astimezone()
    return dt.isoformat()


def _is_transient_quotation_failure(message: str) -> bool:
    """判断官方报价业务错误是否为瞬态(可重试):「没有匹配到场次」等偶发错误,
    手动重放同一 show_id/座位可成功。确定性业务错误(场次不存在等)不重试。"""
    return "没有匹配到场次" in message or "匹配到场次" in message


def select_quotation_candidate(
    limit: QuotationResult, fix: QuotationResult
) -> tuple[int, str, int]:
    """从双通道报价中选择较高正价作为基础报价。

    良票返回 0 价表示该通道不可报价(场次/座位不可售或渠道无价),必须视为失败,
    否则会把 0 当基础报价,最终以「成本+加价」之外的亏本价卖出。
    """
    candidates: list[tuple[int, str, int]] = []
    if limit.limit_price:
        candidates.append((limit.limit_price, limit.task_id, 1))
    if fix.fix_price:
        candidates.append((fix.fix_price, fix.task_id, 2))
    if not candidates:
        raise QuoteBusinessError(
            "IDENTIFY_FAIL",
            f"双通道均无有效报价: limit_price={limit.limit_price} fix_price={fix.fix_price}",
        )
    return max(candidates, key=lambda item: item[0])


def run_quote_image(
    settings: Settings,
    client: LiangPiaoClient,
    db_path: str,
    user_id: int,
    request: dict[str, Any],
) -> dict[str, Any]:
    """执行完整报价链路,返回插件契约的 Quote 对象。

    抛 QuoteBusinessError → FAILED{failureCode};抛 QuoteNetworkError/LiangPiaoError
    非业务错误 → HTTP 错误让插件重试。
    """
    # 1. 下载选座截图
    image_bytes, content_type = _download_image(settings, request["seatsImage"])

    # 2. 上传 OSS(良票 OCR 需要公网 URL)
    from .oss_upload import upload_image

    public_url = upload_image(settings, image_bytes, content_type)

    # 3. 良票 OCR
    try:
        result = client.with_auto_relogin(lambda: client.identify(public_url))
    except LiangPiaoError as error:
        if error.kind == BUSINESS:
            raise QuoteBusinessError("IDENTIFY_FAIL", str(error)) from error
        raise
    discern = result.discern

    # 4. 场次太近
    now_ms = int(time.time() * 1000)
    if discern.show_time - now_ms < SHOW_TIME_MIN_LEAD_MS:
        raise QuoteBusinessError("SHOW_TIME_TOO_SHORT")

    # 5. 双通道官方报价(netPrice 为单座净价,apifox 契约:净价/座位数/座位名一一对应)
    seat_names = [seat.seat_name for seat in discern.seats]
    if not seat_names:
        raise QuoteBusinessError("IDENTIFY_FAIL")
    ticket_num = len(seat_names)
    total_net = discern.total_image_price or sum(
        seat.seat_price for seat in discern.seats
    )
    if total_net <= 0:
        raise QuoteBusinessError("IDENTIFY_FAIL")
    net_price = total_net // ticket_num  # 单座成本(分)

    try:
        limit = client.with_auto_relogin(
            lambda: client.official_quotation(
                show_id=discern.show_id,
                net_price=net_price,
                seat_count=ticket_num,
                seat_name=seat_names,
                quotation_channels=["LIMIT_PRICE"],
            )
        )
        fix = client.with_auto_relogin(
            lambda: client.official_quotation(
                show_id=discern.show_id,
                net_price=net_price,
                seat_count=ticket_num,
                seat_name=seat_names,
                quotation_channels=["FIX_PRICE"],
            )
        )
    except LiangPiaoError as error:
        if error.kind == BUSINESS:
            # 官方报价偶发「没有匹配到场次」等瞬态业务错误（手动重放可成功），
            # 有限重试 2 次(间隔 2 秒)后再判定识别失败。
            transient = _is_transient_quotation_failure(str(error))
            if transient:
                logger.warning(
                    "[报价] 官方报价瞬态失败(%s)，重试中…", error
                )
                last_error = error
                for retry in range(1, 3):
                    time.sleep(2)
                    try:
                        limit = client.with_auto_relogin(
                            lambda: client.official_quotation(
                                show_id=discern.show_id,
                                net_price=net_price,
                                seat_count=ticket_num,
                                seat_name=seat_names,
                                quotation_channels=["LIMIT_PRICE"],
                            )
                        )
                        fix = client.with_auto_relogin(
                            lambda: client.official_quotation(
                                show_id=discern.show_id,
                                net_price=net_price,
                                seat_count=ticket_num,
                                seat_name=seat_names,
                                quotation_channels=["FIX_PRICE"],
                            )
                        )
                        last_error = None
                        break
                    except LiangPiaoError as retry_error:
                        last_error = retry_error
                        if retry_error.kind != BUSINESS:
                            raise
                if last_error is not None:
                    raise QuoteBusinessError("IDENTIFY_FAIL", str(last_error)) from last_error
            else:
                raise QuoteBusinessError("IDENTIFY_FAIL", str(error)) from error
        else:
            raise

    base_cents, quotation_id, channel = select_quotation_candidate(limit, fix)
    logger.info(
        "[报价] 单座成本=%s 限价=%s 一口价=%s → 基础报价=%s 通道=%s",
        net_price, limit.limit_price, fix.fix_price, base_cents, channel,
    )

    # 6. 后端定价(报价策略)
    strategy = db.get_quote_strategy(db_path, user_id)
    if not strategy:
        strategy = {
            "float_cents": settings.quote_float_cents,
            "diff_threshold_cents": settings.quote_diff_threshold_cents,
            "diff_markup_percent": settings.quote_diff_markup_percent,
        }
    bidding_cents = apply_quote_strategy(strategy, base_cents, net_price)
    amount_cents = bidding_cents * ticket_num
    market_cents = discern.total_image_price or max(
        seat.seat_price for seat in discern.seats
    )

    # 7. 建订单(status 20)
    order_id = uuid.uuid4().hex
    seat_rows_cols = [
        {"row": row, "col": col}
        for seat in discern.seats
        for row, col in [parse_seat_row_col(seat.seat_name)]
    ]
    now = db.now_seconds()
    db.create_order(
        db_path,
        {
            "id": order_id,
            "user_id": user_id,
            "status": "20",
            "chat_id": request["chatId"],
            "customer_id": request["customerId"],
            "customer_name": request.get("customerName"),
            "product_id": request["productId"],
            "message_id": request["messageId"],
            "city_name": discern.city or "",
            "cinema_address": discern.cinema_address or "",
            "cinema_name": discern.cinema_name,
            "hall_name": discern.hall_name or "",
            "film_name": discern.film_name,
            "show_time_ms": discern.show_time,
            "seats": seat_names,
            "ticket_num": ticket_num,
            "bidding_price_cents": bidding_cents,
            "amount_cents": amount_cents,
            "market_price_cents": market_cents,
            "show_id": discern.show_id,
            "net_price_cents": net_price,
            "official_quotation_id": quotation_id,
            "official_channel": channel,
            "seat_rows_cols": seat_rows_cols,
            "seats_image": request.get("seatsImage"),
            "created_at": now,
            "updated_at": now,
        },
    )

    return {
        "id": order_id,
        "cityName": discern.city or "",
        "cinemaAddress": discern.cinema_address or "",
        "cinemaName": discern.cinema_name,
        "hallName": discern.hall_name or "",
        "filmName": discern.film_name,
        "showTime": _show_time_iso(discern.show_time),
        "seats": seat_names,
        "ticketNum": ticket_num,
        "biddingPrice": round(bidding_cents / 100, 2),
        "amount": round(amount_cents / 100, 2),
        "marketPrice": round(market_cents / 100, 2),
    }


def build_submit_seats(order: dict[str, Any]) -> list[SubmitSeat]:
    """从订单座位名与行列号构造良票下单座位。"""
    seats = order["seats"]
    rows_cols = order.get("seat_rows_cols") or []
    result: list[SubmitSeat] = []
    for index, seat_name in enumerate(seats):
        if index < len(rows_cols):
            row = int(rows_cols[index]["row"])
            col = int(rows_cols[index]["col"])
        else:
            row, col = parse_seat_row_col(seat_name)
        result.append(SubmitSeat(row=row, col=col, seat_name=seat_name))
    return result
