import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _build_fernet() -> Fernet:
    raw_key = os.getenv("CREDENTIALS_ENCRYPTION_KEY", "dev-credentials-key")
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    fernet_key = base64.urlsafe_b64encode(digest)
    return Fernet(fernet_key)


def encrypt_secret(secret: str) -> str:
    if not secret:
        return ""
    token = _build_fernet().encrypt(secret.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(encrypted_secret: str) -> str:
    if not encrypted_secret:
        return ""
    try:
        value = _build_fernet().decrypt(encrypted_secret.encode("utf-8"))
    except InvalidToken:
        return ""
    return value.decode("utf-8")
