"""良票上游 HTTP client:内存会话、自动登录、领域接口与响应解码。

契约与 docs/apifox-liangpiao-upstream-openapi.yaml 一一对应(8 个领域接口)。
所有请求除登录外携带 user-token;响应顶层 state 为 200(数值或字符串)
才算成功,非成功必须带非空 message。Origin/Referer/User-Agent 由服务端
requests 直接设置。token 内存持有,401 时用最近一次账号自动重登一次。
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, TypeVar

import requests

from .config import Settings

logger = logging.getLogger("backend.liangpiao")

LIANGPIAO_PATHS = {
    "login": "/login",
    "city_list": "/film/cinema/getCityList",
    "identify": "/film/identify/filmIdentify",
    "official_quotation": "/film/order/officialQuotation",
    "submit_order": "/film/order/officialSubmitOrder",
    "pay_order": "/film/order/payOrder",
    "order_detail": "/film/order/getOrderDetail",
    "cancel_order": "/film/order/cancelOrder",
}

BUSINESS = "BUSINESS"
UNAUTHORIZED = "UNAUTHORIZED"
NETWORK = "NETWORK"
HTTP = "HTTP"
PROTOCOL = "PROTOCOL"

OK_STATES = (200, "200")


class LiangPiaoError(Exception):
    """良票错误。kind: BUSINESS / UNAUTHORIZED / NETWORK / HTTP / PROTOCOL。"""

    def __init__(
        self,
        kind: str,
        message: str,
        status: int | None = None,
        business_state: int | None = None,
    ):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.business_state = business_state


@dataclass
class DiscernSeat:
    seat_name: str
    seat_price: int


@dataclass
class Discern:
    province: str | None
    city: str | None
    cinema_address: str | None
    show_id: str
    film_name: str
    cinema_name: str
    show_time: int  # Unix 毫秒时间戳
    hall_name: str | None
    seats: list[DiscernSeat]
    total_image_price: int | None


@dataclass
class IdentifyResult:
    task_id: str | None
    discern: Discern


@dataclass
class QuotationResult:
    task_id: str
    limit_price: int | None
    fix_price: int | None


@dataclass
class TicketInfo:
    ticket: str | None
    ticket_code: str | None


@dataclass
class OrderDetail:
    order_id: str
    order_status: int  # 1 待支付 / 4 出票中 / 5 已出票 / 12 已退款
    tickets: list[TicketInfo]
    failed_reason: str | None


@dataclass
class SubmitSeat:
    row: int
    col: int
    seat_name: str


def _require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LiangPiaoError(PROTOCOL, f"{path} must be a non-empty string")
    return value


def _require_record(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LiangPiaoError(PROTOCOL, f"{path} must be an object")
    return value


def _require_int(value: Any, path: str) -> int:
    if not isinstance(value, int):
        raise LiangPiaoError(PROTOCOL, f"{path} must be an integer")
    return value


def _int_value(value: Any, path: str) -> int:
    """良票实返回字符串数字(如 "4300"),按真实格式转 int。"""
    if isinstance(value, bool):
        raise LiangPiaoError(PROTOCOL, f"{path} must be an integer, got {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    raise LiangPiaoError(PROTOCOL, f"{path} must be an integer, got {value!r}")


class LiangPiaoClient:
    """良票 HTTP 门面。持有内存会话;未登录需 login;401 自动重登一次。"""

    def __init__(self, settings: Settings, session: requests.Session | None = None):
        self._settings = settings
        self._session = session or requests.Session()
        self._token: str | None = None
        self._user_id: str | None = None
        self._user_name: str | None = None
        self._last_user_name: str | None = None
        self._last_password: str | None = None

    # —— 会话 ——

    def login(self, user_name: str, password: str) -> str:
        body = self._request(
            "POST",
            LIANGPIAO_PATHS["login"],
            None,
            json_body={
                "userName": user_name,
                "password": password,
                "userTypeEnum": "Consume",
            },
        )
        try:
            token = _require_string(body.get("token"), "login response token")
            data = _require_record(body.get("data"), "login response data")
            user_id = _require_string(data.get("id"), "login response data.id")
            login_user_name = _require_string(
                data.get("userName"), "login response data.userName"
            )
        except LiangPiaoError as error:
            raw_data = body.get("data")
            raise LiangPiaoError(
                PROTOCOL,
                f"{error} | 实际登录响应: 顶层字段={sorted(body.keys())} "
                f"data 类型={type(raw_data).__name__} "
                f"data 字段={sorted(raw_data.keys()) if isinstance(raw_data, dict) else raw_data!r} "
                f"完整 data={raw_data!r}",
            ) from error
        self._token = token
        self._user_id = user_id
        self._user_name = login_user_name
        self._last_user_name = user_name
        self._last_password = password
        logger.info("[良票] 登录成功: %s", self._user_name)
        return self._user_name

    def user_name(self) -> str | None:
        return self._user_name

    def user_id(self) -> str | None:
        return self._user_id

    def _ensure_session(self) -> str:
        if self._token is not None:
            return self._token
        if self._last_user_name is None or self._last_password is None:
            if not self._settings.liangpiao_user_name:
                raise LiangPiaoError(
                    UNAUTHORIZED, "not logged in; LIANGPIAO_USER_NAME not configured"
                )
            self.login(
                self._settings.liangpiao_user_name, self._settings.liangpiao_password
            )
        else:
            self.login(self._last_user_name, self._last_password)
        assert self._token is not None
        return self._token

    T = TypeVar("T")

    def with_auto_relogin(self, action: Callable[[], T]) -> T:
        """执行 action;UNAUTHORIZED 时重登一次并重试。"""
        try:
            return action()
        except LiangPiaoError as error:
            if error.kind != UNAUTHORIZED:
                raise
            self._token = None
            self._ensure_session()
            return action()

    # —— 底层请求 ——

    def _request(
        self,
        method: str,
        path: str,
        token: str | None,
        *,
        json_body: dict[str, Any] | None = None,
        form: dict[str, str] | None = None,
        query: str = "",
    ) -> dict[str, Any]:
        headers = {
            "Origin": self._settings.liangpiao_origin,
            "Referer": f"{self._settings.liangpiao_origin}/",
            "User-Agent": self._settings.liangpiao_user_agent,
        }
        if token is not None:
            headers["user-token"] = token
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        elif form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        url = f"{self._settings.liangpiao_base_url}{path}{query}"
        try:
            response = self._session.request(
                method, url, headers=headers, json=json_body, data=form, timeout=20
            )
        except requests.RequestException as error:
            raise LiangPiaoError(NETWORK, f"LiangPiao request failed: {error}") from error
        return self._expect_success(response, path)

    def _expect_success(
        self, response: requests.Response, context: str
    ) -> dict[str, Any]:
        if response.status_code == 401:
            raise LiangPiaoError(
                UNAUTHORIZED, f"{context} rejected: user-token is invalid",
                response.status_code,
            )
        if not (200 <= response.status_code < 300):
            raise LiangPiaoError(
                HTTP, f"{context} returned HTTP {response.status_code}",
                response.status_code,
            )
        try:
            body = response.json()
        except ValueError as error:
            raise LiangPiaoError(
                PROTOCOL, f"{context} response is not JSON", response.status_code
            ) from error
        if not isinstance(body, dict):
            raise LiangPiaoError(PROTOCOL, f"{context} response must be a JSON object")
        if body.get("state") in OK_STATES:
            return body
        message = body.get("message")
        if not isinstance(message, str) or not message.strip():
            message = f"{context} failed with state {body.get('state')!r}"
        state = _failure_state_number(body.get("state"))
        if state == 401:
            raise LiangPiaoError(UNAUTHORIZED, message, response.status_code, state)
        raise LiangPiaoError(BUSINESS, message, response.status_code, state)

    # —— 领域接口 ——

    def identify(self, img_url: str) -> IdentifyResult:
        token = self._ensure_session()
        body = self._request(
            "POST",
            LIANGPIAO_PATHS["identify"],
            token,
            form={"imgUrl": img_url},
        )
        data = _success_data(body, "identify response")
        try:
            return _decode_identify(data)
        except LiangPiaoError:
            logger.warning(
                "[良票] identify 解码失败,原始响应: %s",
                json.dumps(body, ensure_ascii=False)[:3000],
            )
            raise

    def official_quotation(
        self,
        show_id: str,
        net_price: int,
        seat_count: int,
        seat_name: list[str],
        quotation_channels: list[str],
    ) -> QuotationResult:
        token = self._ensure_session()
        body = self._request(
            "POST",
            LIANGPIAO_PATHS["official_quotation"],
            token,
            json_body={
                "showId": show_id,
                "netPrice": str(net_price),
                "seatCount": seat_count,
                "seatName": seat_name,
                "quotationChannels": quotation_channels,
            },
        )
        data = _success_data(body, "official quotation response")
        task_id = _require_string(data.get("taskId"), "official quotation data.taskId")
        limit_price = data.get("limitPrice")
        fix_price = data.get("fixPrice")
        return QuotationResult(
            task_id=task_id,
            limit_price=_optional_int(limit_price, "limitPrice"),
            fix_price=_optional_int(fix_price, "fixPrice"),
        )

    def submit_order(
        self,
        show_id: str,
        seats: list[SubmitSeat],
        price_cents: int,
        official_quotation_id: str,
        official_channel_number: int,
    ) -> str:
        token = self._ensure_session()
        if self._user_id is None or self._user_name is None:
            raise LiangPiaoError(UNAUTHORIZED, "not logged in before submit order")
        body = self._request(
            "POST",
            LIANGPIAO_PATHS["submit_order"],
            token,
            json_body={
                "userId": self._user_id,
                "userName": self._user_name,
                "showId": show_id,
                "seats": [
                    {"row": seat.row, "col": seat.col, "seatName": seat.seat_name}
                    for seat in seats
                ],
                "channel": 3,
                "orderType": 1,
                "changeSeat": 1,
                "inputLimitPrice": price_cents,
                "matchChannel": 1,
                "quotationMode": 1,
                "inquiryPrice": price_cents,
                "officialQuotationId": official_quotation_id,
                "officialChannel": official_channel_number,
                "OfficialQuotationChannel": [official_channel_number],
                "officialChannelState": 1,
            },
        )
        data = _success_data(body, "submit order response")
        return _require_string(data.get("orderNumber"), "submit order data.orderNumber")

    def pay_order(self, order_number: str) -> None:
        token = self._ensure_session()
        self._request(
            "POST",
            LIANGPIAO_PATHS["pay_order"],
            token,
            form={"orderNumber": order_number},
        )

    def get_order_detail(self, order_number: str) -> OrderDetail:
        token = self._ensure_session()
        body = self._request(
            "GET",
            LIANGPIAO_PATHS["order_detail"],
            token,
            query=f"?orderNumber={order_number}",
        )
        data = _success_data(body, "order detail response")
        order_info = _require_record(data.get("orderInfo"), "order detail data.orderInfo")
        order_id = _require_string(order_info.get("id"), "order detail data.orderInfo.id")
        order_status = _require_int(
            order_info.get("orderStatus"), "order detail data.orderInfo.orderStatus"
        )
        tickets: list[TicketInfo] = []
        ticket_info = data.get("ticketInfo")
        if isinstance(ticket_info, list):
            for index, ticket in enumerate(ticket_info):
                if not isinstance(ticket, dict):
                    raise LiangPiaoError(
                        PROTOCOL, f"order detail ticketInfo[{index}] must be an object"
                    )
                tickets.append(
                    TicketInfo(
                        ticket=_optional_str(ticket.get("ticket")),
                        ticket_code=_optional_str(ticket.get("ticketCode")),
                    )
                )
        failed_reason = None
        for key in ("failedReason", "refundReason", "cancelReason"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                failed_reason = value
                break
        return OrderDetail(
            order_id=order_id,
            order_status=order_status,
            tickets=tickets,
            failed_reason=failed_reason,
        )

    def cancel_order(self, order_id: str) -> None:
        token = self._ensure_session()
        self._request(
            "POST",
            LIANGPIAO_PATHS["cancel_order"],
            token,
            form={"orderId": order_id},
        )


def _success_data(body: dict[str, Any], context: str) -> dict[str, Any]:
    data = body.get("data")
    if not isinstance(data, dict):
        raise LiangPiaoError(PROTOCOL, f"{context} data must be an object")
    return data


def _optional_int(value: Any, path: str) -> int | None:
    if value is None:
        return None
    return _require_int(value, path)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise LiangPiaoError(PROTOCOL, "expected optional string")
    return value


def _failure_state_number(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _decode_identify(data: dict[str, Any]) -> IdentifyResult:
    task_id = data.get("taskId")
    discern_value = data.get("discern")
    if not isinstance(discern_value, dict):
        raise LiangPiaoError(PROTOCOL, "identify response data.discern must be an object")
    discern = discern_value

    def optional_text(key: str) -> str | None:
        value = discern.get(key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise LiangPiaoError(PROTOCOL, f"discern.{key} must be a string")
        return value

    seats: list[DiscernSeat] = []
    raw_seats = discern.get("seats")
    if not isinstance(raw_seats, list):
        raise LiangPiaoError(PROTOCOL, "discern.seats must be an array")
    for index, seat in enumerate(raw_seats):
        if not isinstance(seat, dict):
            raise LiangPiaoError(PROTOCOL, f"discern.seats[{index}] must be an object")
        seat_name = _require_string(seat.get("seatName"), f"seats[{index}].seatName")
        seat_price = _int_value(seat.get("seatPrice"), f"seats[{index}].seatPrice")
        seats.append(DiscernSeat(seat_name=seat_name, seat_price=seat_price))

    show_id = _require_string(discern.get("showId"), "discern.showId")
    film_name = _require_string(discern.get("filmName"), "discern.filmName")
    cinema_name = _require_string(discern.get("cinemaName"), "discern.cinemaName")
    show_time = _int_value(discern.get("showTime"), "discern.showTime")
    total_image_price = discern.get("totalImagePrice")
    if total_image_price is not None:
        total_image_price = _int_value(
            total_image_price, "discern.totalImagePrice"
        )
    logger.info(
        "[良票] OCR: %s %s showTime=%s 座位数=%s 首座价=%s 总价=%s",
        cinema_name, film_name, show_time, len(seats),
        seats[0].seat_price if seats else None, total_image_price,
    )

    return IdentifyResult(
        task_id=_optional_str(task_id),
        discern=Discern(
            province=optional_text("province"),
            city=optional_text("city"),
            cinema_address=optional_text("cinemaAddress"),
            show_id=show_id,
            film_name=film_name,
            cinema_name=cinema_name,
            show_time=show_time,
            hall_name=optional_text("hallName"),
            seats=seats,
            total_image_price=total_image_price,
        ),
    )
