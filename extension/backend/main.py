"""FastAPI 应用:插件(中间人)的业务后端。

启动:
    uvicorn backend.main:app --host 0.0.0.0 --port 8000

契约与插件 src/handlers/backendApiClient.ts 一一对应:统一信封
{code, message, data, requestId},code === 0 且 2xx 为成功;401 → TOKEN_INVALID。
金额在插件侧为「元」定点小数,内部统一按「分」存储。
"""
from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from . import db, orders, quote, reply_config
from .auth import issue_token, make_current_user_id
from .config import is_oss_configured, load_settings
from .liangpiao_client import (
    BUSINESS,
    HTTP as HTTP_KIND,
    NETWORK,
    PROTOCOL,
    UNAUTHORIZED,
    LiangPiaoClient,
    LiangPiaoError,
)
from .oss_upload import OssUploadError
from .quote import QuoteBusinessError, QuoteNetworkError, run_quote_image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

settings = load_settings()
client = LiangPiaoClient(settings)

app = FastAPI(title="闲鱼电影票业务后端", version="0.1.0")

current_user_id = make_current_user_id(settings)

DEFAULT_USER_ID = 1  # 首版单管理员账号


# —— 请求模型 ——


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class SyncRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    client_version: str = Field(min_length=1)
    device_id: str = Field(min_length=1)


class AutomationRequest(BaseModel):
    enabled: bool


class AiReplyRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    message_id: str = Field(min_length=1)
    chat_id: str = Field(min_length=1)
    buyer_user_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content: str = Field(min_length=1)


class CreateQuoteTaskRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    message_id: str = Field(min_length=1)
    origin_platform: Literal["xianyu"]
    chat_id: str = Field(min_length=1)
    customer_id: str = Field(min_length=1)
    customer_name: str = Field(min_length=1)
    product_id: str = Field(min_length=1)
    seats_image: str = Field(min_length=1)


class ChatRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    chat_id: str = Field(min_length=1)


class ByStatusRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    chat_id: str = Field(min_length=1)
    status: Literal[25]


class PriceAdjustedRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str = Field(min_length=1)
    xianyu_order_id: str = Field(min_length=1)


class BuyerPaidRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str = Field(min_length=1)
    actual_amount: float = Field(gt=0)


class PlatformCancelResultRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str = Field(min_length=1)
    failure_reason: Literal["AMOUNT_MISMATCH", "UPSTREAM_ORDER_FAILED"]
    actual_amount: float = Field(gt=0)
    cancel_succeeded: bool


class DeliveryResultRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str = Field(min_length=1)
    result: Literal["DELIVERY_SUCCEEDED", "DELIVERY_FAILED", "TICKET_FAILURE_HANDLED"]
    failure_stage: Literal["TICKET_IMAGE", "SUCCESS_MESSAGE"] | None = None
    sent_image_count: int | None = Field(default=None, ge=0)
    notice_sent: bool | None = None
    cancel_succeeded: bool | None = None


# —— 信封与错误映射 ——


def envelope(data: Any = None, message: str = "ok") -> dict[str, Any]:
    return {
        "code": 0,
        "message": message,
        "data": data,
        "requestId": uuid.uuid4().hex,
    }


def _error_response(status_code: int, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "data": None,
            "requestId": uuid.uuid4().hex,
        },
    )


def map_upstream_error(error: LiangPiaoError) -> JSONResponse:
    message = str(error)
    if error.kind == UNAUTHORIZED:
        return _error_response(401, 40101, message)
    if error.kind in (NETWORK, HTTP_KIND):
        return _error_response(502, 50201, message)
    if error.kind == PROTOCOL:
        return _error_response(422, 42201, message)
    # BUSINESS:业务失败,HTTP 200 + code 非 0(插件按 HTTP 层区分)
    return _error_response(200, 20001, message)


def _cents_to_yuan(cents: int) -> float:
    return round(cents / 100, 2)


# —— 基础 ——


@app.get("/health")
async def health():
    return {"ok": True, "service": "xianyu-movie-ticket-backend"}


# —— 认证 ——


@app.post("/api/v1/auth/login")
async def login(request: LoginRequest):
    # 首版单管理员:账号密码来自环境变量,直接比较(env 本身即秘密)。
    if (
        request.username != settings.admin_username
        or request.password != settings.admin_password
    ):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    reply_config.ensure_default_config(settings.db_path, DEFAULT_USER_ID)
    token = issue_token(settings, DEFAULT_USER_ID, request.username)
    return envelope({"accessToken": token})


# —— 插件基础接口 ——


@app.post("/api/v1/plugin/sync")
async def plugin_sync(request: SyncRequest, user_id: int = Depends(current_user_id)):
    db.upsert_device(settings.db_path, request.device_id, user_id, request.client_version)
    reply_config.ensure_default_config(settings.db_path, user_id)
    automation = db.get_automation_state(settings.db_path, user_id)
    config = db.get_reply_config(settings.db_path, user_id)
    version = config["version"] if config is not None else 0
    return envelope(
        {
            "automationEnabled": automation["enabled"],
            "automationRevision": automation["revision"],
            "replyConfigVersion": version,
        }
    )


@app.put("/api/v1/plugin/automation")
async def plugin_automation(request: AutomationRequest, user_id: int = Depends(current_user_id)):
    state = db.get_automation_state(settings.db_path, user_id)
    revision = state["revision"] + 1
    db.set_automation_state(settings.db_path, user_id, request.enabled, revision)
    return envelope(
        {"automationEnabled": request.enabled, "automationRevision": revision}
    )


@app.get("/api/v1/plugin/reply-config")
async def plugin_reply_config(user_id: int = Depends(current_user_id)):
    reply_config.ensure_default_config(settings.db_path, user_id)
    config = db.get_reply_config(settings.db_path, user_id)
    if config is None:
        raise HTTPException(status_code=500, detail="reply config missing")
    return envelope(
        {
            "version": config["version"],
            "templates": config["templates"],
            "keywordRules": config["rules"],
        }
    )


@app.post("/api/v1/plugin/ai-reply")
async def plugin_ai_reply(request: AiReplyRequest, user_id: int = Depends(current_user_id)):
    # AI 客服已排除:恒静默,关键词未命中由插件静默结束。
    return envelope({"reply": None})


# —— 报价 ——


@app.post("/api/v1/plugin/quote-image")
async def plugin_quote_image(
    request: CreateQuoteTaskRequest, user_id: int = Depends(current_user_id)
):
    if not is_oss_configured(settings):
        return _error_response(422, 42202, "OSS credentials are not configured")
    try:
        quote_result = run_quote_image(
            settings, client, settings.db_path, user_id, request.model_dump(by_alias=True)
        )
    except QuoteBusinessError as error:
        logger.info(
            "[报价] %s 业务失败: %s%s",
            request.message_id,
            error.failure_code,
            f" ({error.upstream_message})" if error.upstream_message else "",
        )
        return envelope({"status": "FAILED", "failureCode": error.failure_code})
    except (QuoteNetworkError, LiangPiaoError, OssUploadError) as error:
        logger.warning("[报价] %s 失败: %s", request.message_id, error)
        return _error_response(502, 50202, str(error))
    logger.info("[报价] %s 成功: %s", request.message_id, quote_result["id"])
    return envelope({"status": "SUCCEEDED", "quote": quote_result})


# —— 订单状态机 ——


@app.post("/api/v1/plugin/orders/waiting-payment")
async def waiting_payment(request: ChatRequest, user_id: int = Depends(current_user_id)):
    order = db.get_latest_order_by_chat_and_status(
        settings.db_path, user_id, request.chat_id, "20"
    )
    if order is None:
        return envelope(None)
    return envelope(
        {
            "id": order["id"],
            "status": 20,
            "productId": order["product_id"],
            "customerId": order["customer_id"],
            "cityName": order["city_name"],
            "cinemaName": order["cinema_name"],
            "amount": _cents_to_yuan(order["amount_cents"]),
        }
    )


@app.post("/api/v1/plugin/orders/price-adjusted")
async def price_adjusted(
    request: PriceAdjustedRequest, user_id: int = Depends(current_user_id)
):
    try:
        orders.require_order(settings.db_path, user_id, request.id)
    except orders.OrderStateError as error:
        return _error_response(404, 40401, str(error))
    db.update_order_status(
        settings.db_path,
        user_id,
        request.id,
        "25",
        xianyu_order_id=request.xianyu_order_id,
    )
    return envelope(None)


@app.post("/api/v1/plugin/orders/buyer-paid")
async def buyer_paid(request: BuyerPaidRequest, user_id: int = Depends(current_user_id)):
    actual_cents = round(request.actual_amount * 100)
    try:
        orders.advance_paid_order(
            settings.db_path, client, user_id, request.id, actual_cents
        )
    except orders.OrderStateError as error:
        return _error_response(409, 40901, str(error))
    except LiangPiaoError as error:
        logger.warning("[订单] %s 良票下单失败: %s", request.id, error)
        return map_upstream_error(error)
    return envelope(None)


@app.post("/api/v1/plugin/orders/platform-cancel-result")
async def platform_cancel_result(
    request: PlatformCancelResultRequest, user_id: int = Depends(current_user_id)
):
    try:
        orders.require_order(settings.db_path, user_id, request.id)
    except orders.OrderStateError as error:
        return _error_response(404, 40401, str(error))
    db.update_order_status(
        settings.db_path,
        user_id,
        request.id,
        "90",
        failure_reason=request.failure_reason,
        delivered=1,
    )
    return envelope(None)


@app.post("/api/v1/plugin/orders/by-status")
async def order_by_status(request: ByStatusRequest, user_id: int = Depends(current_user_id)):
    order = db.get_latest_order_by_chat_and_status(
        settings.db_path, user_id, request.chat_id, "25"
    )
    if order is None:
        return envelope(None)
    return envelope(
        {
            "id": order["id"],
            "xianyuOrderId": order["xianyu_order_id"] or "",
            "customerId": order["customer_id"],
            "amount": _cents_to_yuan(order["amount_cents"]),
        }
    )


@app.post("/api/v1/plugin/orders/ticket-results")
async def ticket_results(user_id: int = Depends(current_user_id)):
    orders.poll_upstream_ticket_status(settings.db_path, client, user_id)
    results = []
    for order in orders.pending_deliveries(settings.db_path, user_id):
        if order["status"] == "50":
            ticket_codes = order["ticket_codes"] or []
            ticket_images = order["ticket_images"] or [""] * len(ticket_codes)
            results.append(
                {
                    "id": order["id"],
                    "status": 50,
                    "chatId": order["chat_id"],
                    "customerId": order["customer_id"],
                    "ticketCodeInfo": {
                        "ticketItems": [
                            {
                                "ticketCode": ticket_codes[index],
                                "ticketCodeOriginImage": (
                                    ticket_images[index] if index < len(ticket_images) else ""
                                ),
                            }
                            for index in range(len(ticket_codes))
                        ]
                    },
                }
            )
        elif order["status"] == "450":
            results.append(
                {
                    "id": order["id"],
                    "status": 450,
                    "chatId": order["chat_id"],
                    "customerId": order["customer_id"],
                    "xianyuOrderId": order["xianyu_order_id"] or "",
                }
            )
    return envelope(results)


@app.post("/api/v1/plugin/orders/delivery-result")
async def delivery_result(
    request: DeliveryResultRequest, user_id: int = Depends(current_user_id)
):
    try:
        orders.settle_delivery(
            settings.db_path,
            user_id,
            request.id,
            request.result,
            failure_stage=request.failure_stage,
            sent_image_count=request.sent_image_count,
            notice_sent=request.notice_sent,
            cancel_succeeded=request.cancel_succeeded,
        )
    except orders.OrderStateError as error:
        return _error_response(404, 40401, str(error))
    return envelope(None)


# —— 管理后台(浏览器 Web 页) ——

ORDER_STATUS_LABELS: dict[str, str] = {
    "QUOTE_FAILED": "报价失败",
    "20": "已报价",
    "25": "已改价",
    "30": "出票中",
    "50": "已出票",
    "90": "已取消",
    "450": "出票失败",
}


class ReplyConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    templates: dict[str, str]
    keyword_rules: list[dict[str, Any]]


class QuoteStrategyRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    float_cents: int = Field(ge=0)
    diff_threshold_cents: int = Field(ge=0)
    diff_markup_percent: int = Field(ge=0)


@app.get("/api/v1/admin/overview")
async def admin_overview(user_id: int = Depends(current_user_id)):
    """管理后台概览:订单状态分布、城市排行、近 7 日趋势与最新订单。"""
    reply_config.ensure_default_config(settings.db_path, user_id)
    counts = db.order_status_counts(settings.db_path, user_id)
    city_rank = db.order_city_rank(settings.db_path, user_id)
    daily = db.order_daily_summary(settings.db_path, user_id)
    automation = db.get_automation_state(settings.db_path, user_id)
    recent = db.list_orders(settings.db_path, user_id, limit=5)
    status_distribution = [
        {"status": status, "label": label, "count": counts.get(status, 0)}
        for status, label in ORDER_STATUS_LABELS.items()
    ]
    return envelope(
        {
            "automationEnabled": automation["enabled"],
            "automationRevision": automation["revision"],
            "statusDistribution": status_distribution,
            "cityRank": [
                {
                    "city": item["city"],
                    "count": item["count"],
                    "revenue": _cents_to_yuan(item["revenueCents"]),
                }
                for item in city_rank
            ],
            "daily": [
                {
                    "date": item["date"],
                    "count": item["count"],
                    "revenue": _cents_to_yuan(item["revenueCents"]),
                    "paidCount": item["paidCount"],
                }
                for item in daily
            ],
            "recentOrders": [_admin_order_view(order) for order in recent],
            "today": _today_summary(daily, counts),
        }
    )


@app.get("/api/v1/admin/orders")
async def admin_orders(
    status: str | None = None,
    limit: int = 200,
    user_id: int = Depends(current_user_id),
):
    """管理后台订单列表,可按状态过滤。"""
    all_orders = db.list_orders(settings.db_path, user_id, limit=limit)
    if status:
        all_orders = [order for order in all_orders if order["status"] == status]
    return envelope([_admin_order_view(order) for order in all_orders])


@app.put("/api/v1/plugin/reply-config")
async def plugin_update_reply_config(
    request: ReplyConfigUpdateRequest, user_id: int = Depends(current_user_id)
):
    """插件端保存话术模板与关键词规则:版本号自增,下次 sync 插件拉取新版本。"""
    reply_config.ensure_default_config(settings.db_path, user_id)
    current = db.get_reply_config(settings.db_path, user_id)
    version = (current["version"] if current else 0) + 1
    db.save_reply_config(
        settings.db_path,
        user_id,
        version,
        request.templates,
        request.keyword_rules,
    )
    return envelope({"version": version})


@app.get("/api/v1/admin/quote-strategy")
async def admin_get_quote_strategy(user_id: int = Depends(current_user_id)):
    strategy = db.get_quote_strategy(settings.db_path, user_id)
    if not strategy:
        strategy = {
            "float_cents": settings.quote_float_cents,
            "diff_threshold_cents": settings.quote_diff_threshold_cents,
            "diff_markup_percent": settings.quote_diff_markup_percent,
        }
    return envelope(
        {
            "floatCents": strategy["float_cents"],
            "diffThresholdCents": strategy["diff_threshold_cents"],
            "diffMarkupPercent": strategy["diff_markup_percent"],
        }
    )


@app.put("/api/v1/admin/quote-strategy")
async def admin_update_quote_strategy(
    request: QuoteStrategyRequest, user_id: int = Depends(current_user_id)
):
    db.save_quote_strategy(
        settings.db_path,
        user_id,
        request.float_cents,
        request.diff_threshold_cents,
        request.diff_markup_percent,
    )
    return envelope(
        {
            "floatCents": request.float_cents,
            "diffThresholdCents": request.diff_threshold_cents,
            "diffMarkupPercent": request.diff_markup_percent,
        }
    )


def _admin_order_view(order: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": order["id"],
        "status": order["status"],
        "statusLabel": ORDER_STATUS_LABELS.get(order["status"], order["status"]),
        "chatId": order["chat_id"],
        "customerId": order["customer_id"],
        "customerName": order["customer_name"] or "",
        "filmName": order["film_name"],
        "cinemaName": order["cinema_name"],
        "cityName": order["city_name"],
        "hallName": order["hall_name"],
        "showTimeMs": order["show_time_ms"],
        "ticketNum": order["ticket_num"],
        "amount": _cents_to_yuan(order["amount_cents"]),
        "netPrice": _cents_to_yuan(order["net_price_cents"]),
        "biddingPrice": _cents_to_yuan(order["bidding_price_cents"]),
        "marketPrice": _cents_to_yuan(order["market_price_cents"]),
        "xianyuOrderId": order["xianyu_order_id"] or "",
        "upstreamOrderNumber": order["upstream_order_number"] or "",
        "failureReason": order["failure_reason"] or "",
        "seatRowsCols": order["seat_rows_cols"],
        "seatsImage": order.get("seats_image") or "",
        "ticketCodes": order["ticket_codes"],
        "ticketImages": order["ticket_images"],
        "createdAt": order["created_at"],
    }


def _today_summary(
    daily: list[dict[str, Any]], counts: dict[str, int]
) -> dict[str, Any]:
    total_revenue = sum(item["revenueCents"] for item in daily)
    total_orders = sum(item["count"] for item in daily)
    total_paid = sum(item["paidCount"] for item in daily)
    return {
        "totalOrders": total_orders,
        "totalRevenue": _cents_to_yuan(total_revenue),
        "totalPaid": total_paid,
        "quoteSuccessRate": (
            round(total_paid / total_orders * 100, 1) if total_orders else 0.0
        ),
        "pending": counts.get("20", 0) + counts.get("25", 0) + counts.get("30", 0),
        "failed": counts.get("QUOTE_FAILED", 0) + counts.get("450", 0),
        "cancelled": counts.get("90", 0),
    }


# 启动时初始化数据库
import os

os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)
db.init_db(settings.db_path)

# —— 管理后台 Web 页面(浏览器直接访问 /admin) ——
from fastapi.staticfiles import StaticFiles

# —— 图片代理:闲鱼 alicdn 图片有防盗链,浏览器直接加载会 CORS 失败 ——
import requests as _requests


@app.get("/admin/proxy-image")
async def admin_proxy_image(url: str):
    """代理加载闲鱼/OSS 图片:后端带 Referer 抓取,绕过浏览器 CORS 限制。

    仅允许 http(s) URL,且必须来自闲鱼/阿里 CDN 域,防止 SSRF。
    """
    if not url.startswith(("https://img.alicdn.com/", "https://liangpiao-ticket-img.oss-cn-beijing.aliyuncs.com/", "http://img.alicdn.com/", "https://stream-upload.goofish.com/")):
        raise HTTPException(status_code=400, detail="image url not allowed")
    try:
        response = _requests.get(
            url,
            headers={
                "Referer": "https://www.goofish.com/",
                "User-Agent": settings.liangpiao_user_agent,
            },
            timeout=15,
        )
    except _requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"image fetch failed: {error}") from error
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"image fetch returned {response.status_code}")
    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
    return Response(content=response.content, media_type=content_type)


_WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


class _NoCacheStaticFiles(StaticFiles):
    """管理页静态文件禁用缓存,避免浏览器用旧 JS/CSS 组合导致布局错乱。"""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store"
        return response


app.mount("/admin", _NoCacheStaticFiles(directory=_WEB_DIR, html=True), name="admin-web")
