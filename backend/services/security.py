import os
import secrets
import hmac
from datetime import datetime, timedelta
from hashlib import sha256

from werkzeug.security import check_password_hash, generate_password_hash


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def create_token() -> str:
    return secrets.token_urlsafe(48)


def token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def token_expiration(minutes: int = 30) -> datetime:
    return datetime.utcnow() + timedelta(minutes=minutes)


def mask_secret(secret: str) -> str:
    if not secret:
        return ""
    visible = min(4, len(secret))
    return f"{'*' * max(len(secret) - visible, 0)}{secret[-visible:]}"


def get_crypto_key() -> str:
    return os.getenv("CREDENTIALS_ENCRYPTION_KEY", "dev-credentials-key")


def totp_code(secret: str, window: int = 0) -> str:
    step = int(datetime.utcnow().timestamp() // 30) + window
    digest = hmac.new(secret.encode("utf-8"), str(step).encode("utf-8"), "sha1").hexdigest()
    value = int(digest[-8:], 16) % 1000000
    return f"{value:06d}"
