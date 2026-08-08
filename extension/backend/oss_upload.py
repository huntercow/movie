"""阿里云 OSS 预签名 PUT 直传(标准库实现,与旧插件 ossUpload.ts 同方案)。

    StringToSign = "PUT\\n\\n{ContentType}\\n{Expires}\\n/{bucket}/{uploadDir}/{objectName}"

上传成功后返回公网 URL,供良票 /film/identify/filmIdentify 的 imgUrl 使用。
凭证来自环境变量(OSS_ACCESS_KEY_ID 等),仓库不保存任何密钥。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
import uuid
from urllib.parse import quote

import requests

from .config import Settings

logger = logging.getLogger("backend.oss")

ALLOWED_IMAGE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class OssUploadError(Exception):
    """OSS 上传失败。kind: NETWORK / HTTP / PROTOCOL。"""

    def __init__(self, kind: str, message: str, status: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.status = status


def _hmac_sha1_base64(secret: str, message: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


def build_presigned_put_url(
    settings: Settings,
    object_name: str,
    content_type: str,
    expires_unix_seconds: int,
) -> str:
    string_to_sign = (
        f"PUT\n\n{content_type}\n{expires_unix_seconds}\n"
        f"/{settings.oss_bucket}/{settings.oss_upload_dir}/{object_name}"
    )
    signature = _hmac_sha1_base64(settings.oss_access_key_secret, string_to_sign)
    base = (
        f"https://{settings.oss_bucket}.{settings.oss_region}.aliyuncs.com/"
        f"{settings.oss_upload_dir}/{object_name}"
    )
    query = (
        f"OSSAccessKeyId={quote(settings.oss_access_key_id, safe='')}"
        f"&Expires={expires_unix_seconds}"
        f"&Signature={quote(signature, safe='')}"
    )
    return f"{base}?{query}"


def object_name_for(content_type: str) -> str:
    extension = ALLOWED_IMAGE_EXTENSIONS.get(content_type)
    if extension is None:
        raise OssUploadError(
            "PROTOCOL",
            f"unsupported image type {content_type}, "
            "expected image/jpeg, image/png or image/webp",
        )
    return f"{uuid.uuid4().hex}.{extension}"


def upload_image(
    settings: Settings, data: bytes, content_type: str, timeout: float = 30.0
) -> str:
    """上传图片字节到 OSS,返回公网 URL。content_type 空时默认 image/jpeg。"""
    if not settings.oss_access_key_id:
        raise OssUploadError("PROTOCOL", "OSS credentials are not configured")
    content_type = content_type or "image/jpeg"
    object_name = object_name_for(content_type)
    expires = int(time.time()) + 300
    url = build_presigned_put_url(settings, object_name, content_type, expires)
    try:
        response = requests.put(
            url, data=data, headers={"Content-Type": content_type}, timeout=timeout
        )
    except requests.RequestException as error:
        raise OssUploadError("NETWORK", f"OSS upload failed: {error}") from error
    if not (200 <= response.status_code < 300):
        raise OssUploadError(
            "HTTP", f"OSS upload returned HTTP {response.status_code}",
            response.status_code,
        )
    if response.headers.get("x-oss-request-id") is None:
        raise OssUploadError(
            "PROTOCOL", "OSS upload response is missing x-oss-request-id"
        )
    public_url = (
        f"https://{settings.oss_bucket}.{settings.oss_region}.aliyuncs.com/"
        f"{settings.oss_upload_dir}/{object_name}"
    )
    logger.info("[OSS] 上传成功: %s", public_url)
    return public_url
