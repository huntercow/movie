"""后端单元测试:报价策略、座位解析、订单状态机(用假良票 client)。

运行: backend/.venv/Scripts/python -m unittest backend.test_backend -v
"""
from __future__ import annotations

import os
import tempfile
import unittest

from backend import db, orders, quote
from backend.config import load_settings
from backend.liangpiao_client import (
    BUSINESS,
    UNAUTHORIZED,
    Discern,
    DiscernSeat,
    LiangPiaoError,
    OrderDetail,
    QuotationResult,
    TicketInfo,
)


class FakeLiangPiaoClient:
    """记录调用并按预设脚本响应的假良票 client。"""

    def __init__(self):
        self.identify_result = None
        self.quotation_results: list[QuotationResult] = []
        self.submit_failure: LiangPiaoError | None = None
        self.order_detail_results: list[OrderDetail] = []
        self.calls: list[str] = []

    def with_auto_relogin(self, action):
        return action()

    def identify(self, img_url):
        self.calls.append(f"identify:{img_url}")
        if self.identify_result is None:
            raise LiangPiaoError(BUSINESS, "识别失败")
        return self.identify_result

    def official_quotation(self, show_id, net_price, seat_count, seat_name, quotation_channels):
        self.calls.append(
            f"official_quotation:{quotation_channels[0]}:{net_price}:{seat_count}"
        )
        return self.quotation_results.pop(0)

    def submit_order(self, show_id, seats, price_cents, official_quotation_id, official_channel_number):
        self.calls.append(f"submit_order:{price_cents}:{official_channel_number}")
        if self.submit_failure is not None:
            raise self.submit_failure
        return "LP-TEST-0001"

    def pay_order(self, order_number):
        self.calls.append(f"pay_order:{order_number}")

    def get_order_detail(self, order_number):
        self.calls.append(f"get_order_detail:{order_number}")
        return self.order_detail_results.pop(0) if self.order_detail_results else None


class QuoteStrategyTest(unittest.TestCase):
    def test_plain_float_markup(self):
        self.assertEqual(
            quote.apply_quote_strategy(
                {"float_cents": 500, "diff_threshold_cents": 0, "diff_markup_percent": 0},
                base_cents=2766,
                net_cents=3300,
            ),
            3266,
        )

    def test_threshold_markup_applied(self):
        # 利润 3266-3300 为负,不触发加价
        self.assertEqual(
            quote.apply_quote_strategy(
                {"float_cents": 500, "diff_threshold_cents": 100, "diff_markup_percent": 50},
                base_cents=2766,
                net_cents=3300,
            ),
            3266,
        )

    def test_high_margin_triggers_markup(self):
        # 报价 4000+500=4500,利润 4500-3000=1500 > 300 阈值 → +1500*50%=750 → 5250
        self.assertEqual(
            quote.apply_quote_strategy(
                {"float_cents": 500, "diff_threshold_cents": 300, "diff_markup_percent": 50},
                base_cents=4000,
                net_cents=3000,
            ),
            5250,
        )


class QuotationCandidateTest(unittest.TestCase):
    """双通道报价选择:0 价通道视为失败,双通道均无正价时拒绝报价。"""

    def test_picks_higher_positive_price(self):
        limit = QuotationResult(task_id="limit-1", limit_price=2766, fix_price=None)
        fix = QuotationResult(task_id="fix-1", limit_price=None, fix_price=2888)
        self.assertEqual(quote.select_quotation_candidate(limit, fix), (2888, "fix-1", 2))

    def test_zero_price_channel_is_rejected(self):
        # 单通道 0 价 + 另一通道正价 → 取正价通道
        limit = QuotationResult(task_id="limit-1", limit_price=0, fix_price=None)
        fix = QuotationResult(task_id="fix-1", limit_price=None, fix_price=2888)
        self.assertEqual(quote.select_quotation_candidate(limit, fix), (2888, "fix-1", 2))

    def test_all_zero_prices_reject_quote(self):
        # 双通道都返回 0(不可报价) → 抛业务失败,禁止亏本成交
        limit = QuotationResult(task_id="limit-1", limit_price=0, fix_price=None)
        fix = QuotationResult(task_id="fix-1", limit_price=None, fix_price=0)
        with self.assertRaises(quote.QuoteBusinessError) as ctx:
            quote.select_quotation_candidate(limit, fix)
        self.assertEqual(ctx.exception.failure_code, "IDENTIFY_FAIL")

    def test_missing_prices_reject_quote(self):
        limit = QuotationResult(task_id="limit-1", limit_price=None, fix_price=None)
        fix = QuotationResult(task_id="fix-1", limit_price=None, fix_price=None)
        with self.assertRaises(quote.QuoteBusinessError):
            quote.select_quotation_candidate(limit, fix)


class SeatParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(quote.parse_seat_row_col("5排6座"), (5, 6))
        self.assertEqual(quote.parse_seat_row_col("12排1座"), (12, 1))


class OrderStateMachineTest(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self._tmpdir, "test.db")
        db.init_db(self.db_path)
        self.user_id = 1
        self.client = FakeLiangPiaoClient()
        self._create_order()

    def _create_order(self):
        db.create_order(
            self.db_path,
            {
                "id": "order-1",
                "user_id": self.user_id,
                "status": "20",
                "chat_id": "chat-1",
                "customer_id": "buyer-1",
                "customer_name": "买家",
                "product_id": "product-1",
                "message_id": "msg-1",
                "city_name": "北京",
                "cinema_address": "朝阳区",
                "cinema_name": "万达影城",
                "hall_name": "1号厅",
                "film_name": "测试电影",
                "show_time_ms": 1770000000000,
                "seats": ["5排6座", "5排7座"],
                "ticket_num": 2,
                "bidding_price_cents": 3266,
                "amount_cents": 6532,
                "market_price_cents": 6600,
                "show_id": "show-1",
                "net_price_cents": 3300,
                "official_quotation_id": "quotation-1",
                "official_channel": 2,
                "seat_rows_cols": [{"row": 5, "col": 6}, {"row": 5, "col": 7}],
                "created_at": db.now_seconds(),
                "updated_at": db.now_seconds(),
            },
        )
        db.update_order_status(self.db_path, self.user_id, "order-1", "25",
                               xianyu_order_id="xianyu-1")

    def test_advance_paid_success(self):
        orders.advance_paid_order(self.db_path, self.client, self.user_id, "order-1", 6532)
        order = db.get_order(self.db_path, self.user_id, "order-1")
        self.assertEqual(order["status"], "30")
        self.assertEqual(order["upstream_order_number"], "LP-TEST-0001")
        self.assertIn("submit_order:3266:2", self.client.calls)
        self.assertIn("pay_order:LP-TEST-0001", self.client.calls)

    def test_advance_paid_upstream_failure_rolls_back(self):
        self.client.submit_failure = LiangPiaoError(BUSINESS, "下单失败")
        with self.assertRaises(LiangPiaoError):
            orders.advance_paid_order(self.db_path, self.client, self.user_id, "order-1", 6532)
        order = db.get_order(self.db_path, self.user_id, "order-1")
        self.assertEqual(order["status"], "25")
        self.assertIn("UPSTREAM_ORDER_FAILED", order["failure_reason"])

    def test_poll_issued(self):
        db.update_order_status(self.db_path, self.user_id, "order-1", "30",
                               upstream_order_number="LP-TEST-0001")
        self.client.order_detail_results = [
            OrderDetail(
                order_id="up-1", order_status=5,
                tickets=[TicketInfo(ticket=None, ticket_code="123456"),
                         TicketInfo(ticket=None, ticket_code="654321")],
                failed_reason=None,
            )
        ]
        orders.poll_upstream_ticket_status(self.db_path, self.client, self.user_id)
        order = db.get_order(self.db_path, self.user_id, "order-1")
        self.assertEqual(order["status"], "50")
        self.assertEqual(order["ticket_codes"], ["123456", "654321"])
        pending = orders.pending_deliveries(self.db_path, self.user_id)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["status"], "50")

    def test_poll_refunded(self):
        db.update_order_status(self.db_path, self.user_id, "order-1", "30",
                               upstream_order_number="LP-TEST-0001")
        self.client.order_detail_results = [
            OrderDetail(order_id="up-1", order_status=12, tickets=[], failed_reason="影院取消")
        ]
        orders.poll_upstream_ticket_status(self.db_path, self.client, self.user_id)
        order = db.get_order(self.db_path, self.user_id, "order-1")
        self.assertEqual(order["status"], "450")

    def test_settle_delivery_success_removes_from_pending(self):
        db.update_order_status(self.db_path, self.user_id, "order-1", "50",
                               ticket_codes=["123456"], ticket_images=[""])
        orders.settle_delivery(self.db_path, self.user_id, "order-1", "DELIVERY_SUCCEEDED")
        self.assertEqual(orders.pending_deliveries(self.db_path, self.user_id), [])

    def test_settle_delivery_failed_goes_manual(self):
        db.update_order_status(self.db_path, self.user_id, "order-1", "50",
                               ticket_codes=["123456"], ticket_images=[""])
        orders.settle_delivery(
            self.db_path, self.user_id, "order-1", "DELIVERY_FAILED",
            failure_stage="SUCCESS_MESSAGE", sent_image_count=1,
        )
        order = db.get_order(self.db_path, self.user_id, "order-1")
        self.assertEqual(order["status"], "45")
        self.assertIn("DELIVERY_FAILED", order["failure_reason"])


if __name__ == "__main__":
    unittest.main()
