"""认证:管理员登录 + JWT 签发与校验。

首版单账号(环境变量 APP_ADMIN_USERNAME/PASSWORD);
JWT 用 PyJWT HS256,payload 含 user_id/username。Bearer 依赖注入用于保护
/api/v1/plugin/* 路由。
"""
from __future__ import annotations

import time

import jwt
from fastapi import Depends, HTTPException, status as http_status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings

_bearer = HTTPBearer(auto_error=False)

JWT_ALGORITHM = "HS256"
JWT_TTL_SECONDS = 7 * 24 * 3600  # 7 天


def issue_token(settings: Settings, user_id: int, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_token(settings: Settings, token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as error:
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        ) from error


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(lambda: None),  # replaced by app dependency
) -> int:
    raise NotImplementedError("replaced in main.py")


def make_current_user_id(settings: Settings):
    """构造 FastAPI 依赖:从 Bearer Token 解析用户 id。"""

    def dependency(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> int:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=http_status.HTTP_401_UNAUTHORIZED,
                detail="missing bearer token",
            )
        payload = decode_token(settings, credentials.credentials)
        try:
            return int(payload["sub"])
        except (KeyError, ValueError) as error:
            raise HTTPException(
                status_code=http_status.HTTP_401_UNAUTHORIZED,
                detail="invalid token subject",
            ) from error

    return dependency
