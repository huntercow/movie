"""话术配置:默认模板与关键词规则。

默认配置来自仓库根目录的导出 JSON(与插件构建期打包的本地配置同源):
- 闲鱼业务话术_2026-03-16.json  模板(10 个业务键,与插件 REPLY_TEMPLATE_KEYS 一致)
- 闲鱼关键词回复规则_2026-03-16.json  关键词规则数组

后端启动时把默认配置写入每个用户的 reply_config;当前无在线编辑接口,
模板/规则变更需重新部署(直接改 JSON 后重启,或后续加管理接口)。
"""
from __future__ import annotations

import json
import os
from typing import Any

from . import db

# 插件 REPLY_TEMPLATE_KEYS 固定的 10 个模板键(多一个少一个插件都会拒绝)。
REPLY_TEMPLATE_KEYS = [
    "identify_wait",
    "identify_fail",
    "identify_success",
    "edit_price_success",
    "payment_successful",
    "no_quote_record",
    "show_time_too_short",
    "cancel_ticket",
    "text_message_replay",
    "send_ticket_success",
]

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_FILE = os.path.join(_ROOT, "闲鱼业务话术_2026-03-16.json")
RULES_FILE = os.path.join(_ROOT, "闲鱼关键词回复规则_2026-03-16.json")

CONFIG_VERSION = 1


def load_default_templates() -> dict[str, str]:
    """读根目录话术 JSON,只取插件契约允许的 10 个模板键。"""
    with open(TEMPLATE_FILE, encoding="utf-8") as handle:
        data = json.load(handle)
    templates = data.get("templates", {})
    result: dict[str, str] = {}
    for key in REPLY_TEMPLATE_KEYS:
        value = templates.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"话术模板缺少必填键: {key}")
        result[key] = value
    return result


def load_default_rules() -> list[dict[str, Any]]:
    """读关键词规则 JSON(裸数组)。"""
    with open(RULES_FILE, encoding="utf-8") as handle:
        rules = json.load(handle)
    if not isinstance(rules, list):
        raise ValueError("关键词规则文件必须是数组")
    normalized: list[dict[str, Any]] = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"关键词规则[{index}] 必须是对象")
        normalized.append(
            {
                "id": str(rule.get("id") or f"rule-{index}"),
                "keywords": [str(k) for k in rule.get("keywords", [])],
                "reply": str(rule.get("reply", "")),
                "enabled": bool(rule.get("enabled", True)),
                "priority": int(rule.get("priority", 0)),
            }
        )
    return normalized


def ensure_default_config(path: str, user_id: int) -> None:
    """用户首次出现时写入默认话术配置(幂等,已存在则跳过)。"""
    existing = db.get_reply_config(path, user_id)
    if existing is not None:
        return
    templates = load_default_templates()
    rules = load_default_rules()
    db.save_reply_config(path, user_id, CONFIG_VERSION, templates, rules)
