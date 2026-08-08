"""SQLite 存储层:用户、设备、自动化状态、话术配置、报价策略、订单。

金额统一用「分」整数存储;API 层与插件交互时转「元」小数(插件契约要求
最多两位小数的定点小数)。时间用 Unix 秒;show_time 用 Unix 毫秒(与良票一致)。

订单状态(插件契约固定):QUOTE_FAILED / 20(已报价)→ 25(已改价)→
30(已付款,良票下单)→ 50(已出票交付)/ 90(取消)/ 450(退款)。
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_devices (
    device_id      TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL,
    client_version TEXT NOT NULL,
    last_seen_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_state (
    user_id  INTEGER PRIMARY KEY,
    enabled  INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reply_config (
    user_id     INTEGER PRIMARY KEY,
    version     INTEGER NOT NULL,
    templates   TEXT NOT NULL,
    rules       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_strategy (
    user_id               INTEGER PRIMARY KEY,
    float_cents           INTEGER NOT NULL,
    diff_threshold_cents  INTEGER NOT NULL,
    diff_markup_percent   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id                    TEXT PRIMARY KEY,
    user_id               INTEGER NOT NULL,
    status                TEXT NOT NULL,
    chat_id               TEXT NOT NULL,
    customer_id           TEXT NOT NULL,
    customer_name         TEXT,
    product_id            TEXT NOT NULL,
    message_id            TEXT NOT NULL,
    city_name             TEXT NOT NULL,
    cinema_address        TEXT NOT NULL,
    cinema_name           TEXT NOT NULL,
    hall_name             TEXT NOT NULL,
    film_name             TEXT NOT NULL,
    show_time_ms          INTEGER NOT NULL,
    seats                 TEXT NOT NULL,
    ticket_num            INTEGER NOT NULL,
    bidding_price_cents   INTEGER NOT NULL,
    amount_cents          INTEGER NOT NULL,
    market_price_cents    INTEGER NOT NULL,
    show_id               TEXT NOT NULL,
    net_price_cents       INTEGER NOT NULL,
    official_quotation_id TEXT,
    official_channel      INTEGER,
    seat_rows_cols        TEXT NOT NULL,
    xianyu_order_id       TEXT,
    upstream_order_number TEXT,
    upstream_order_id     TEXT,
    failure_reason        TEXT,
    ticket_codes          TEXT,
    ticket_images         TEXT,
    seats_image           TEXT,
    delivered             INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user_chat ON orders(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(user_id, status);
"""


def init_db(path: str) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        # 老库迁移:补新增列(忽略已存在列的错误)
        try:
            conn.execute("ALTER TABLE orders ADD COLUMN seats_image TEXT")
        except sqlite3.OperationalError:
            pass
        conn.commit()
    finally:
        conn.close()


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def now_seconds() -> int:
    return int(time.time())


# —— 设备与自动化状态 ——


def upsert_device(path: str, device_id: str, user_id: int, client_version: str) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO plugin_devices (device_id, user_id, client_version, last_seen_at)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET"
            " user_id = excluded.user_id, client_version = excluded.client_version,"
            " last_seen_at = excluded.last_seen_at",
            (device_id, user_id, client_version, now_seconds()),
        )
        conn.commit()
    finally:
        conn.close()


def get_automation_state(path: str, user_id: int) -> dict[str, Any]:
    conn = _connect(path)
    try:
        row = conn.execute(
            "SELECT enabled, revision FROM automation_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return {"enabled": False, "revision": 0}
        return {"enabled": bool(row["enabled"]), "revision": int(row["revision"])}
    finally:
        conn.close()


def set_automation_state(
    path: str, user_id: int, enabled: bool, revision: int
) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO automation_state (user_id, enabled, revision) VALUES (?, ?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET"
            " enabled = excluded.enabled, revision = excluded.revision",
            (user_id, int(enabled), revision),
        )
        conn.commit()
    finally:
        conn.close()


# —— 话术配置 ——


def get_reply_config(path: str, user_id: int) -> dict[str, Any] | None:
    conn = _connect(path)
    try:
        row = conn.execute(
            "SELECT version, templates, rules FROM reply_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "version": int(row["version"]),
            "templates": json.loads(row["templates"]),
            "rules": json.loads(row["rules"]),
        }
    finally:
        conn.close()


def save_reply_config(
    path: str, user_id: int, version: int, templates: dict, rules: list
) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO reply_config (user_id, version, templates, rules)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET"
            " version = excluded.version, templates = excluded.templates,"
            " rules = excluded.rules",
            (user_id, version, json.dumps(templates, ensure_ascii=False),
             json.dumps(rules, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        conn.close()


# —— 报价策略 ——


def get_quote_strategy(path: str, user_id: int) -> dict[str, int]:
    conn = _connect(path)
    try:
        row = conn.execute(
            "SELECT float_cents, diff_threshold_cents, diff_markup_percent"
            " FROM quote_strategy WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return {}
        return {
            "float_cents": int(row["float_cents"]),
            "diff_threshold_cents": int(row["diff_threshold_cents"]),
            "diff_markup_percent": int(row["diff_markup_percent"]),
        }
    finally:
        conn.close()


def save_quote_strategy(
    path: str,
    user_id: int,
    float_cents: int,
    diff_threshold_cents: int,
    diff_markup_percent: int,
) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO quote_strategy"
            " (user_id, float_cents, diff_threshold_cents, diff_markup_percent)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET"
            " float_cents = excluded.float_cents,"
            " diff_threshold_cents = excluded.diff_threshold_cents,"
            " diff_markup_percent = excluded.diff_markup_percent",
            (user_id, float_cents, diff_threshold_cents, diff_markup_percent),
        )
        conn.commit()
    finally:
        conn.close()


# —— 订单 ——


def _order_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["seats"] = json.loads(item["seats"])
    item["seat_rows_cols"] = (
        json.loads(item["seat_rows_cols"]) if item["seat_rows_cols"] else []
    )
    item["ticket_codes"] = json.loads(item["ticket_codes"]) if item["ticket_codes"] else []
    item["ticket_images"] = (
        json.loads(item["ticket_images"]) if item["ticket_images"] else []
    )
    return item


def create_order(path: str, order: dict[str, Any]) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO orders ("
            " id, user_id, status, chat_id, customer_id, customer_name, product_id,"
            " message_id, city_name, cinema_address, cinema_name, hall_name, film_name,"
            " show_time_ms, seats, ticket_num, bidding_price_cents, amount_cents,"
            " market_price_cents, show_id, net_price_cents, official_quotation_id,"
            " official_channel, seat_rows_cols, seats_image, created_at, updated_at"
            ") VALUES ("
            " ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?"
            ")",
            (
                order["id"], order["user_id"], order["status"], order["chat_id"],
                order["customer_id"], order["customer_name"], order["product_id"],
                order["message_id"], order["city_name"], order["cinema_address"],
                order["cinema_name"], order["hall_name"], order["film_name"],
                order["show_time_ms"], json.dumps(order["seats"], ensure_ascii=False),
                order["ticket_num"], order["bidding_price_cents"],
                order["amount_cents"], order["market_price_cents"],
                order["show_id"], order["net_price_cents"],
                order.get("official_quotation_id"),
                order.get("official_channel"),
                json.dumps(order["seat_rows_cols"], ensure_ascii=False),
                order.get("seats_image"),
                order["created_at"], order["updated_at"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def update_order_status(
    path: str, user_id: int, order_id: str, status: str, **fields: Any
) -> bool:
    """按 id+user_id 更新订单状态与附加字段,返回是否命中。"""
    sets = ["status = ?", "updated_at = ?"]
    params: list[Any] = [status, now_seconds()]
    for key, value in fields.items():
        if key == "seats" or key == "ticket_codes" or key == "ticket_images":
            value = json.dumps(value, ensure_ascii=False)
        sets.append(f"{key} = ?")
        params.append(value)
    params.extend([order_id, user_id])
    conn = _connect(path)
    try:
        cursor = conn.execute(
            f"UPDATE orders SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_order(path: str, user_id: int, order_id: str) -> dict[str, Any] | None:
    conn = _connect(path)
    try:
        row = conn.execute(
            "SELECT * FROM orders WHERE id = ? AND user_id = ?", (order_id, user_id)
        ).fetchone()
        return _order_row_to_dict(row) if row is not None else None
    finally:
        conn.close()


def get_latest_order_by_chat_and_status(
    path: str, user_id: int, chat_id: str, status: str
) -> dict[str, Any] | None:
    conn = _connect(path)
    try:
        row = conn.execute(
            "SELECT * FROM orders WHERE user_id = ? AND chat_id = ? AND status = ?"
            " ORDER BY created_at DESC LIMIT 1",
            (user_id, chat_id, status),
        ).fetchone()
        return _order_row_to_dict(row) if row is not None else None
    finally:
        conn.close()


def get_orders_by_status(
    path: str, user_id: int, statuses: list[str]
) -> list[dict[str, Any]]:
    conn = _connect(path)
    try:
        placeholders = ", ".join("?" * len(statuses))
        rows = conn.execute(
            f"SELECT * FROM orders WHERE user_id = ? AND status IN ({placeholders})"
            " ORDER BY created_at DESC",
            [user_id, *statuses],
        ).fetchall()
        return [_order_row_to_dict(row) for row in rows]
    finally:
        conn.close()


# —— 管理后台聚合查询 ——


def list_orders(path: str, user_id: int, limit: int = 200) -> list[dict[str, Any]]:
    """管理后台订单列表(按创建时间倒序)。"""
    conn = _connect(path)
    try:
        rows = conn.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_order_row_to_dict(row) for row in rows]
    finally:
        conn.close()


def order_status_counts(path: str, user_id: int) -> dict[str, int]:
    """按状态统计订单数(管理后台看板)。"""
    conn = _connect(path)
    try:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS count FROM orders WHERE user_id = ?"
            " GROUP BY status",
            (user_id,),
        ).fetchall()
        return {row["status"]: int(row["count"]) for row in rows}
    finally:
        conn.close()


def order_city_rank(path: str, user_id: int, limit: int = 5) -> list[dict[str, Any]]:
    """按城市统计订单数与成交额(管理后台看板)。"""
    conn = _connect(path)
    try:
        rows = conn.execute(
            "SELECT city_name, COUNT(*) AS count, SUM(amount_cents) AS revenue_cents"
            " FROM orders WHERE user_id = ? GROUP BY city_name"
            " ORDER BY count DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [
            {
                "city": row["city_name"],
                "count": int(row["count"]),
                "revenueCents": int(row["revenue_cents"] or 0),
            }
            for row in rows
        ]
    finally:
        conn.close()


def order_daily_summary(path: str, user_id: int, days: int = 7) -> list[dict[str, Any]]:
    """按天统计订单数/成交额/报价数(管理后台看板,近 N 天)。"""
    conn = _connect(path)
    try:
        rows = conn.execute(
            "SELECT date(created_at, 'unixepoch', 'localtime') AS day,"
            " COUNT(*) AS count, SUM(amount_cents) AS revenue_cents,"
            " SUM(CASE WHEN status IN ('25','30','50') THEN 1 ELSE 0 END) AS paid_count"
            " FROM orders WHERE user_id = ? AND created_at >= ?"
            " GROUP BY day ORDER BY day ASC",
            (user_id, now_seconds() - days * 86400),
        ).fetchall()
        return [
            {
                "date": row["day"],
                "count": int(row["count"]),
                "revenueCents": int(row["revenue_cents"] or 0),
                "paidCount": int(row["paid_count"] or 0),
            }
            for row in rows
        ]
    finally:
        conn.close()
