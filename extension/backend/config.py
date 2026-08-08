"""后端配置:全部来自环境变量,代码不内置任何真实凭证。

环境变量:
- APP_ADMIN_USERNAME / APP_ADMIN_PASSWORD   管理员登录账号(首版单账号)
- APP_AUTH_JWT_SECRET                       JWT 签名密钥
- APP_DB_PATH                               SQLite 路径(默认 backend/data/app.db)
- LIANGPIAO_USER_NAME / LIANGPIAO_PASSWORD  良票账号(必填,后端自动登录,401 自动重登)
- LIANGPIAO_BASE_URL / LIANGPIAO_ORIGIN     良票 API / H5 地址
- OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_REGION / OSS_UPLOAD_DIR
  OSS 凭证(必填,报价需要;未配置时报价接口返回 422)
- QUOTE_FLOAT_CENTS / QUOTE_DIFF_THRESHOLD_CENTS / QUOTE_DIFF_MARKUP_PERCENT
  报价策略:固定加价(分)、差价阈值(分)、加价系数(%)
"""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_LIANGPIAO_BASE_URL = "http://business-api.liangpiao.net.cn"
DEFAULT_LIANGPIAO_ORIGIN = "http://h5.liangpiao.net.cn"


@dataclass(frozen=True)
class Settings:
    admin_username: str
    admin_password: str
    jwt_secret: str
    db_path: str
    liangpiao_user_name: str
    liangpiao_password: str
    liangpiao_base_url: str
    liangpiao_origin: str
    liangpiao_user_agent: str
    oss_access_key_id: str
    oss_access_key_secret: str
    oss_bucket: str
    oss_region: str
    oss_upload_dir: str
    quote_float_cents: int
    quote_diff_threshold_cents: int
    quote_diff_markup_percent: int


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_settings() -> Settings:
    return Settings(
        admin_username=_env("APP_ADMIN_USERNAME", "admin"),
        admin_password=_env("APP_ADMIN_PASSWORD", "admin123"),
        jwt_secret=_env("APP_AUTH_JWT_SECRET", "dev-secret-change-me"),
        db_path=_env(
            "APP_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "app.db")
        ),
        # 良票账号与 OSS 凭证必须通过环境变量提供,代码不内置任何真实凭证。
        liangpiao_user_name=_env("LIANGPIAO_USER_NAME"),
        liangpiao_password=_env("LIANGPIAO_PASSWORD"),
        liangpiao_base_url=_env("LIANGPIAO_BASE_URL", DEFAULT_LIANGPIAO_BASE_URL),
        liangpiao_origin=_env("LIANGPIAO_ORIGIN", DEFAULT_LIANGPIAO_ORIGIN),
        liangpiao_user_agent=_env(
            "LIANGPIAO_USER_AGENT",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36",
        ),
        oss_access_key_id=_env("OSS_ACCESS_KEY_ID"),
        oss_access_key_secret=_env("OSS_ACCESS_KEY_SECRET"),
        oss_bucket=_env("OSS_BUCKET"),
        oss_region=_env("OSS_REGION"),
        oss_upload_dir=_env("OSS_UPLOAD_DIR", "ticket-img"),
        quote_float_cents=_env_int("QUOTE_FLOAT_CENTS", 500),
        quote_diff_threshold_cents=_env_int("QUOTE_DIFF_THRESHOLD_CENTS", 0),
        quote_diff_markup_percent=_env_int("QUOTE_DIFF_MARKUP_PERCENT", 0),
    )


def is_oss_configured(settings: Settings) -> bool:
    return bool(
        settings.oss_access_key_id
        and settings.oss_access_key_secret
        and settings.oss_bucket
        and settings.oss_region
    )
