from datetime import datetime
import base64
import re
import secrets
import time

from flask import Blueprint, jsonify, request, session
from sqlalchemy.exc import OperationalError
from sqlalchemy import func

from models import PasswordResetToken, User, UserSecurityProfile, UserSessionRecord, UserTrustedDevice, db, init_all_models
from services.audit_service import write_audit
from services.email_service import EmailServiceError, send_password_reset_email
from services.password_policy import validate_password_policy
from services.referral_service import attach_referral_chain, ensure_referral_code
from services.rate_limit import rate_limit
from services.security import create_token, hash_password, token_expiration, token_hash, totp_code, verify_password

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")
_schema_checked = False
CAPTCHA_SESSION_KEY = "auth_captcha_challenges"
CAPTCHA_TTL_SECONDS = 300


def _error(message, code, status, details=None):
    payload = {"error": message, "code": code}
    if details:
        payload["details"] = details
    return jsonify(payload), status


def _current_user():
    _ensure_schema()
    user_id = session.get("user_id")
    if not user_id:
        return None
    session_token = session.get("session_token")
    if session_token:
        row = UserSessionRecord.query.filter_by(session_token=session_token, user_id=user_id).first()
        if row and row.is_revoked:
            session.clear()
            return None
    return User.query.get(user_id)


def _captcha_store():
    payload = session.get(CAPTCHA_SESSION_KEY)
    if not isinstance(payload, dict):
        payload = {}
    return payload


def _cleanup_captcha_store(store: dict) -> dict:
    now = int(time.time())
    cleaned = {}
    for key, item in (store or {}).items():
        if not isinstance(item, dict):
            continue
        expires_at = int(item.get("expiresAt") or 0)
        if expires_at > now:
            cleaned[str(key)] = item
    return cleaned


def _verify_captcha(captcha_id: str, captcha_answer: str) -> bool:
    store = _cleanup_captcha_store(_captcha_store())
    session[CAPTCHA_SESSION_KEY] = store
    payload = store.pop(str(captcha_id or "").strip(), None)
    session[CAPTCHA_SESSION_KEY] = store
    if not payload:
        return False
    expected = str(payload.get("answer") or "").strip()
    provided = str(captcha_answer or "").strip()
    return bool(expected) and provided == expected


def _build_captcha_image_data_url(challenge: str) -> str:
    safe_text = (challenge or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    noise = " ".join(str(secrets.randbelow(10)) for _ in range(8))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56">'
        '<rect width="180" height="56" fill="#f4f7ff"/>'
        '<path d="M0 14 C30 30, 60 0, 90 16 S150 34, 180 16" stroke="#c6d4ff" stroke-width="2" fill="none"/>'
        '<path d="M0 38 C30 20, 60 50, 90 36 S150 18, 180 36" stroke="#d7e2ff" stroke-width="2" fill="none"/>'
        f'<text x="12" y="35" font-family="monospace" font-size="26" font-weight="700" fill="#21366f">{safe_text}</text>'
        f'<text x="10" y="52" font-family="monospace" font-size="10" fill="#7f90c2">{noise}</text>'
        "</svg>"
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def _ensure_schema():
    global _schema_checked
    if _schema_checked:
        return
    try:
        User.query.limit(1).all()
        _schema_checked = True
    except OperationalError as exc:
        if "no such table" not in str(exc).lower():
            raise
        db.session.rollback()
        init_all_models()
        _schema_checked = True


@auth_bp.post("/register")
@rate_limit(20, 300)
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    referral_code = (data.get("referralCode") or "").strip()
    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    country_code = (data.get("countryCode") or "").strip().upper()
    captcha_id = (data.get("captchaId") or "").strip()
    captcha_answer = (data.get("captchaAnswer") or "").strip()

    fields = {}
    if not email:
        fields["email"] = "REQUIRED"
    if not password:
        fields["password"] = "REQUIRED"
    if not first_name:
        fields["firstName"] = "REQUIRED"
    if not last_name:
        fields["lastName"] = "REQUIRED"
    if not country_code:
        fields["countryCode"] = "REQUIRED"
    if fields:
        return _error(
            "email, password, first name, last name and country are required",
            "AUTH_REQUIRED_FIELDS",
            400,
            {"fields": fields},
        )
    if not captcha_id:
        fields["captchaId"] = "REQUIRED"
    if not captcha_answer:
        fields["captchaAnswer"] = "REQUIRED"
    if fields:
        return _error(
            "email, password, first name, last name, country and captcha are required",
            "AUTH_REQUIRED_FIELDS",
            400,
            {"fields": fields},
        )
    if not _verify_captcha(captcha_id, captcha_answer):
        return _error("captcha validation failed", "AUTH_CAPTCHA_INVALID", 400, {"fields": {"captchaAnswer": "INVALID"}})
    is_valid_password, password_code = validate_password_policy(password)
    if not is_valid_password:
        return _error(
            "password policy validation failed",
            "AUTH_WEAK_PASSWORD",
            400,
            {"fields": {"password": password_code}},
        )
    if not re.fullmatch(r"[A-Z]{2}", country_code):
        return _error("country must be a valid ISO code", "AUTH_INVALID_COUNTRY_CODE", 400, {"fields": {"countryCode": "INVALID"}})
    if User.query.filter(func.lower(User.email) == email).first():
        return _error("user already exists", "AUTH_USER_EXISTS", 409, {"fields": {"email": "TAKEN"}})

    user = User(
        email=email,
        password_hash=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        country_code=country_code,
        is_active=True,
    )
    db.session.add(user)
    db.session.commit()
    ensure_referral_code(user.id)
    if referral_code:
        attach_referral_chain(user.id, referral_code)
    write_audit("user", user.id, "register", f"user={email}")
    return jsonify({"success": True}), 201


@auth_bp.post("/login")
@rate_limit(30, 300)
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    remember_me = bool(data.get("rememberMe"))
    captcha_id = (data.get("captchaId") or "").strip()
    captcha_answer = (data.get("captchaAnswer") or "").strip()
    if not email or not password:
        fields = {}
        if not email:
            fields["email"] = "REQUIRED"
        if not password:
            fields["password"] = "REQUIRED"
        return _error("email and password are required", "AUTH_REQUIRED_FIELDS", 400, {"fields": fields})
    if not captcha_id or not captcha_answer:
        fields = {}
        if not captcha_id:
            fields["captchaId"] = "REQUIRED"
        if not captcha_answer:
            fields["captchaAnswer"] = "REQUIRED"
        return _error("captcha is required", "AUTH_REQUIRED_FIELDS", 400, {"fields": fields})
    if not _verify_captcha(captcha_id, captcha_answer):
        return _error("captcha validation failed", "AUTH_CAPTCHA_INVALID", 400, {"fields": {"captchaAnswer": "INVALID"}})

    user = User.query.filter_by(email=email).first()
    if not user or not verify_password(user.password_hash, password):
        return _error("invalid credentials", "AUTH_INVALID_CREDENTIALS", 401, {"fields": {"email": "INVALID", "password": "INVALID"}})
    if not user.is_active:
        return _error("user is inactive", "AUTH_USER_INACTIVE", 403)

    profile = UserSecurityProfile.query.filter_by(user_id=user.id).first()
    if profile and profile.two_factor_enabled:
        provided_code = str(data.get("twoFactorCode") or "").strip()
        if not provided_code:
            return _error("two factor code required", "AUTH_2FA_REQUIRED", 401)
        valid = any(totp_code(profile.two_factor_secret, window=offset) == provided_code for offset in (-1, 0, 1))
        if not valid:
            return _error("invalid two factor code", "AUTH_2FA_INVALID", 401)

    session["user_id"] = user.id
    session["session_token"] = create_token()
    session.permanent = remember_me
    db.session.add(
        UserSessionRecord(
            user_id=user.id,
            session_token=session["session_token"],
            ip_address=request.remote_addr,
            user_agent=(request.headers.get("User-Agent") or "")[:255],
            device_fingerprint=session["session_token"][:64],
            last_seen_at=datetime.utcnow(),
        )
    )
    if profile and profile.trusted_devices_only:
        fingerprint = session["session_token"][:64]
        known = UserTrustedDevice.query.filter_by(user_id=user.id, device_fingerprint=fingerprint).first()
        if not known:
            db.session.rollback()
            return _error("untrusted device", "AUTH_UNTRUSTED_DEVICE", 403)
    db.session.commit()
    write_audit("user", user.id, "login", f"user={email}")
    return jsonify(
        {
            "success": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "country_code": user.country_code,
                "is_admin": user.is_admin,
            },
        }
    )


@auth_bp.get("/captcha")
@rate_limit(60, 300)
def issue_captcha():
    left = secrets.randbelow(9) + 1
    right = secrets.randbelow(9) + 1
    answer = str(left + right)
    captcha_id = secrets.token_urlsafe(12)
    store = _cleanup_captcha_store(_captcha_store())
    store[captcha_id] = {
        "answer": answer,
        "expiresAt": int(time.time()) + CAPTCHA_TTL_SECONDS,
    }
    session[CAPTCHA_SESSION_KEY] = store
    challenge = f"{left} + {right} = ?"
    return jsonify(
        {
            "captchaId": captcha_id,
            "captchaImage": _build_captcha_image_data_url(challenge),
            "ttlSeconds": CAPTCHA_TTL_SECONDS,
        }
    )


@auth_bp.post("/logout")
def logout():
    user_id = session.get("user_id")
    session_token = session.get("session_token")
    if user_id and session_token:
        row = UserSessionRecord.query.filter_by(user_id=user_id, session_token=session_token).first()
        if row:
            row.is_revoked = True
            row.last_seen_at = datetime.utcnow()
            db.session.commit()
    session.pop("user_id", None)
    session.pop("session_token", None)
    if user_id:
        write_audit("user", user_id, "logout")
    return jsonify({"success": True})


@auth_bp.get("/me")
def me():
    user = _current_user()
    if not user:
        return jsonify({"authenticated": False}), 200
    return jsonify(
        {
            "authenticated": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "country_code": user.country_code,
                "is_admin": user.is_admin,
            },
        }
    )


@auth_bp.post("/forgot-password")
@rate_limit(10, 300)
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    frontend_url = (data.get("frontendUrl") or "").strip() or "/reset-password"
    if not email:
        return _error("email is required", "AUTH_REQUIRED_FIELDS", 400, {"fields": {"email": "REQUIRED"}})
    if "@" not in email:
        return _error("invalid email format", "AUTH_INVALID_EMAIL", 400, {"fields": {"email": "INVALID"}})
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"success": True})

    raw_token = create_token()
    prt = PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash(raw_token),
        expires_at=token_expiration(30),
        consumed=False,
    )
    db.session.add(prt)
    db.session.commit()

    reset_url = f"{frontend_url}?token={raw_token}"
    try:
        send_password_reset_email(email, reset_url)
    except EmailServiceError as exc:
        return _error(str(exc), "AUTH_EMAIL_SEND_FAILED", 500)

    write_audit("user", user.id, "forgot_password", "reset email requested")
    return jsonify({"success": True})


@auth_bp.post("/reset-password")
@rate_limit(10, 300)
def reset_password():
    data = request.get_json(silent=True) or {}
    token = data.get("token") or ""
    new_password = data.get("password") or ""
    if not token:
        return _error("token is required", "AUTH_INVALID_TOKEN", 400, {"fields": {"token": "REQUIRED"}})
    if not new_password:
        return _error("password is required", "AUTH_REQUIRED_FIELDS", 400, {"fields": {"password": "REQUIRED"}})
    is_valid_password, password_code = validate_password_policy(new_password)
    if not is_valid_password:
        return _error(
            "password policy validation failed",
            "AUTH_WEAK_PASSWORD",
            400,
            {"fields": {"password": password_code}},
        )

    token_entry = PasswordResetToken.query.filter_by(token_hash=token_hash(token), consumed=False).first()
    if not token_entry:
        return _error("invalid token", "AUTH_INVALID_TOKEN", 400)
    if token_entry.expires_at < datetime.utcnow():
        return _error("token expired", "AUTH_TOKEN_EXPIRED", 400)

    user = User.query.get(token_entry.user_id)
    if not user:
        return _error("user not found", "AUTH_USER_NOT_FOUND", 404)

    user.password_hash = hash_password(new_password)
    token_entry.consumed = True
    db.session.commit()
    write_audit("user", user.id, "reset_password", "password changed")
    return jsonify({"success": True})
