import hashlib
import json
import os
import secrets
import uuid
import re
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta
from typing import Optional, Tuple

from flask import Blueprint, Response, jsonify, request, send_file, session
from sqlalchemy.exc import OperationalError

from models import (
    MiningAccrual,
    MiningContract,
    MiningPlan,
    StakingAccrual,
    StakingTier,
    UserStakingPosition,
    KycDocument,
    KycProfile,
    DashboardFilterPreset,
    DashboardNotification,
    TopUpTransaction,
    UserSecurityProfile,
    UserSessionRecord,
    UserTrustedDevice,
    ReferralCode,
    ReferralPayout,
    ReferralRelation,
    SupportEventLog,
    SupportMessage,
    SupportSlaRule,
    SupportTicket,
    TeamApplication,
    User,
    UserBalanceLedger,
    WithdrawalRequest,
    WithdrawalEventLog,
    KycReview,
    db,
    init_all_models,
)
from services.audit_service import write_audit
from services.dashboard_contract import (
    api_error,
    iso_or_none,
    map_kyc_status,
    map_ticket_status,
    map_withdrawal_status,
)
from services.referral_service import ensure_referral_code
from services.password_policy import validate_password_policy
from services.security import create_token, hash_password, totp_code, verify_password
from services.mining_service import create_contract_from_plan, get_available_usdt, get_mining_summary
from services.withdrawal_service import (
    MANUAL_CREDIT_REASON_PREFIX,
    cancel_withdrawal_by_user,
    create_withdrawal_request,
    get_available_balance,
)
from services.email_service import EmailServiceError, send_team_application_email
from services.rate_limit import rate_limit

user_bp = Blueprint("user", __name__, url_prefix="/api/user")
_schema_checked = False
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
KYC_STORAGE_ROOT = os.path.join(PROJECT_ROOT, "data", "kyc-private")
os.makedirs(KYC_STORAGE_ROOT, exist_ok=True)
ALLOWED_KYC_MIME = {"image/jpeg", "image/png", "application/pdf"}
MAX_KYC_FILE_SIZE = 8 * 1024 * 1024
EMAIL_RE = re.compile(r"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$", re.IGNORECASE)


def _require_user():
    _ensure_schema()
    user_id = session.get("user_id")
    if not user_id:
        return None
    session_token = session.get("session_token")
    if session_token:
        row = UserSessionRecord.query.filter_by(user_id=user_id, session_token=session_token).first()
        if row and row.is_revoked:
            session.clear()
            return None
        if row:
            row.last_seen_at = datetime.utcnow()
            db.session.commit()
    return User.query.get(user_id)


def _require_support_actor():
    _ensure_schema()
    user = _require_user()
    if user:
        return user
    guest_id = session.get("guest_user_id")
    if not guest_id:
        return None
    return User.query.get(guest_id)


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


def _kyc_required(country: Optional[str]) -> bool:
    countries = os.getenv("KYC_REQUIRED_COUNTRIES", "")
    required = {item.strip().upper() for item in countries.split(",") if item.strip()}
    if not required:
        return False
    return (country or "").strip().upper() in required


def _ticket_sla(priority: str) -> Tuple[Optional[datetime], Optional[datetime]]:
    rule = SupportSlaRule.query.filter_by(priority=priority.lower(), is_active=True).first()
    if not rule:
        return None, None
    now = datetime.utcnow()
    return now + timedelta(minutes=int(rule.first_response_minutes)), now + timedelta(
        minutes=int(rule.resolution_minutes)
    )


def _ticket_sla_state(ticket: SupportTicket) -> str:
    now = datetime.utcnow()
    if ticket.status in {"closed", "resolved"}:
        return "closed"
    if ticket.resolution_due_at and ticket.resolution_due_at < now:
        return "breached"
    if ticket.resolution_due_at and ticket.resolution_due_at < now + timedelta(minutes=30):
        return "at_risk"
    return "on_track"


def _is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match((email or "").strip()))


def _client_fingerprint() -> str:
    base = f"{request.headers.get('User-Agent', '')}|{request.remote_addr or ''}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _evaluate_withdrawal_risk(user: User, amount: float, address: str) -> dict:
    reasons = []
    score = 5
    profile = UserSecurityProfile.query.filter_by(user_id=user.id).first()
    kyc = KycProfile.query.filter_by(user_id=user.id).first()
    if not kyc or str(kyc.status or "").lower() != "approved":
        score += 45
        reasons.append("KYC is not approved.")
    if amount >= 1000:
        score += 25
        reasons.append("High withdrawal amount.")
    if len(str(address or "").strip()) < 24:
        score += 20
        reasons.append("Destination address format looks unusual.")
    if profile and profile.step_up_required:
        score += 10
        reasons.append("Step-up verification policy is active.")
    if not reasons:
        reasons.append("No elevated risk signals were detected.")
    tier = "low" if score < 30 else "medium" if score < 60 else "high"
    return {"score": min(100, score), "tier": tier, "reasons": reasons}


def _to_decimal(value, field_name: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ValueError(f"{field_name}:invalid")
    return result


def _notification_payload(row: DashboardNotification) -> dict:
    return {
        "id": row.id,
        "eventType": row.event_type,
        "category": row.category,
        "priority": row.priority,
        "title": row.title,
        "message": row.message,
        "deepLink": row.deep_link,
        "isRead": bool(row.is_read),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def _upsert_notification(user_id: int, event_type: str, external_ref: str, **kwargs) -> None:
    row = DashboardNotification.query.filter_by(
        user_id=user_id,
        event_type=event_type,
        external_ref=external_ref,
    ).first()
    if not row:
        row = DashboardNotification(
            user_id=user_id,
            event_type=event_type,
            external_ref=external_ref,
            category=kwargs.get("category", "system"),
            priority=kwargs.get("priority", "medium"),
            title=kwargs.get("title", event_type),
            message=kwargs.get("message", ""),
            deep_link=kwargs.get("deep_link"),
            is_read=False,
        )
        db.session.add(row)
        return
    row.category = kwargs.get("category", row.category)
    row.priority = kwargs.get("priority", row.priority)
    row.title = kwargs.get("title", row.title)
    row.message = kwargs.get("message", row.message)
    row.deep_link = kwargs.get("deep_link", row.deep_link)
    row.updated_at = datetime.utcnow()


def _sync_dashboard_notifications(user: User) -> None:
    pending_topups = (
        TopUpTransaction.query.filter_by(user_id=user.id)
        .filter(TopUpTransaction.status.in_(["pending"]))
        .order_by(TopUpTransaction.created_at.desc())
        .limit(10)
        .all()
    )
    for row in pending_topups:
        _upsert_notification(
            user.id,
            "topup_pending",
            f"topup:{row.id}",
            category="payments",
            priority="medium",
            title="Top-up pending",
            message=f"Top-up #{row.id} is pending confirmation.",
            deep_link="/dashboard/topups",
        )
    pending_withdrawals = (
        WithdrawalRequest.query.filter_by(user_id=user.id)
        .filter(WithdrawalRequest.status.in_(["pending", "approved", "processing"]))
        .order_by(WithdrawalRequest.created_at.desc())
        .limit(10)
        .all()
    )
    for row in pending_withdrawals:
        _upsert_notification(
            user.id,
            "withdrawal_processing",
            f"withdrawal:{row.id}",
            category="withdrawals",
            priority="high" if row.status == "processing" else "medium",
            title="Withdrawal update",
            message=f"Withdrawal #{row.id} status: {row.status}.",
            deep_link="/dashboard/withdrawals",
        )
    open_tickets = (
        SupportTicket.query.filter_by(requester_id=user.id)
        .filter(SupportTicket.status.notin_(["closed", "resolved"]))
        .order_by(SupportTicket.updated_at.desc())
        .limit(10)
        .all()
    )
    for row in open_tickets:
        _upsert_notification(
            user.id,
            "support_open",
            f"support:{row.id}",
            category="support",
            priority="medium",
            title="Open support ticket",
            message=f"Ticket #{row.id} is {row.status}.",
            deep_link="/dashboard/support",
        )
    profile = KycProfile.query.filter_by(user_id=user.id).first()
    if profile and profile.status in {"pending", "rejected"}:
        _upsert_notification(
            user.id,
            "kyc_status",
            f"kyc:{profile.id}:{profile.status}",
            category="compliance",
            priority="high" if profile.status == "rejected" else "medium",
            title="KYC update",
            message=f"KYC status: {profile.status}.",
            deep_link="/dashboard/overview",
        )
    db.session.commit()


@user_bp.get("/profile")
def profile():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    return jsonify({"id": user.id, "email": user.email, "is_active": user.is_active})


@user_bp.post("/change-password")
def change_password():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status

    data = request.get_json(silent=True) or {}
    old_password = data.get("oldPassword") or ""
    new_password = data.get("newPassword") or ""
    if not verify_password(user.password_hash, old_password):
        payload, status = api_error(
            "invalid current password",
            "INVALID_CURRENT_PASSWORD",
            400,
            {"fields": {"oldPassword": "INVALID"}},
        )
        return jsonify(payload), status
    is_valid_password, password_code = validate_password_policy(new_password)
    if not is_valid_password:
        payload, status = api_error(
            "password policy validation failed",
            "PASSWORD_POLICY_FAILED",
            400,
            {"fields": {"newPassword": password_code}},
        )
        return jsonify(payload), status

    user.password_hash = hash_password(new_password)
    db.session.commit()
    write_audit("user", user.id, "change_password")
    return jsonify({"success": True})


@user_bp.get("/balance")
def balance():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status

    positive_entries = {"credit", "withdrawal_release"}
    page = max(1, int(request.args.get("page", 1) or 1))
    page_size = min(200, max(1, int(request.args.get("pageSize", 50) or 50)))
    query = UserBalanceLedger.query.filter_by(user_id=user.id).order_by(UserBalanceLedger.created_at.desc())
    entries = query.offset((page - 1) * page_size).limit(page_size).all()
    all_entries = UserBalanceLedger.query.filter_by(user_id=user.id).all()
    total = 0.0
    breakdown = {}
    for entry in all_entries:
        sign = float(entry.amount) if entry.entry_type in positive_entries else -float(entry.amount)
        total += sign
        key = f"{entry.asset or 'ALL'}:{entry.network or 'ALL'}"
        breakdown[key] = round(breakdown.get(key, 0.0) + sign, 8)

    total = 0.0
    payload = []
    for entry in entries:
        signed = float(entry.amount) if entry.entry_type in positive_entries else -float(entry.amount)
        total += signed
        payload.append(
            {
                "id": entry.id,
                "amount": float(entry.amount),
                "entryType": entry.entry_type,
                "reason": entry.reason,
                "asset": entry.asset,
                "network": entry.network,
                "createdAt": entry.created_at.isoformat(),
            }
        )
    held_breakdown = {}
    available_breakdown = {}
    withdrawable_breakdown = {}
    purchase_only_breakdown = {}
    for key, value in breakdown.items():
        asset, network = key.split(":", 1)
        if asset == "ALL" or network == "ALL":
            continue
        wallet_balance = get_available_balance(user.id, asset, network)
        withdrawable_balance = get_available_balance(user.id, asset, network, include_purchase_only=False)
        held_breakdown[key] = round(float(wallet_balance["held"]), 8)
        available_breakdown[key] = round(float(wallet_balance["available"]), 8)
        withdrawable_breakdown[key] = round(float(withdrawable_balance["available"]), 8)
        purchase_only_amount = 0.0
        for entry in all_entries:
            if (
                str(entry.asset or "") == asset
                and str(entry.network or "") == network
                and entry.entry_type == "credit"
                and str(entry.reason or "").startswith(MANUAL_CREDIT_REASON_PREFIX)
            ):
                purchase_only_amount += float(entry.amount)
        purchase_only_breakdown[key] = round(purchase_only_amount, 8)
    return jsonify(
        {
            "balance": round(sum(breakdown.values()), 8),
            "breakdown": breakdown,
            "availableBreakdown": available_breakdown,
            "withdrawableBreakdown": withdrawable_breakdown,
            "purchaseOnlyBreakdown": purchase_only_breakdown,
            "heldBreakdown": held_breakdown,
            "availableBalance": round(sum(available_breakdown.values()), 8),
            "withdrawableBalance": round(sum(withdrawable_breakdown.values()), 8),
            "profitWithdrawableBalance": round(sum(withdrawable_breakdown.values()), 8),
            "purchaseOnlyBalance": round(sum(purchase_only_breakdown.values()), 8),
            "heldBalance": round(sum(held_breakdown.values()), 8),
            "entries": payload,
            "page": page,
            "pageSize": page_size,
        }
    )


@user_bp.post("/withdrawals")
def create_withdrawal():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    try:
        row = create_withdrawal_request(
            user_id=user.id,
            asset=data.get("asset"),
            network=data.get("network"),
            address=data.get("address"),
            memo=data.get("memo"),
            amount_raw=data.get("amount"),
        )
    except ValueError as exc:
        message = str(exc)
        if message == "invalid amount":
            payload, status = api_error(
                "invalid amount",
                "WITHDRAWAL_INVALID_AMOUNT",
                400,
                {"fields": {"amount": "INVALID"}},
            )
            return jsonify(payload), status
        if message == "amount must be positive":
            payload, status = api_error(
                "amount must be positive",
                "WITHDRAWAL_INVALID_AMOUNT",
                400,
                {"fields": {"amount": "INVALID"}},
            )
            return jsonify(payload), status
        if message == "asset, network and address are required":
            payload, status = api_error(
                "asset, network and address are required",
                "WITHDRAWAL_REQUIRED_FIELDS",
                400,
                {"fields": {"asset": "REQUIRED", "network": "REQUIRED", "address": "REQUIRED"}},
            )
            return jsonify(payload), status
        if message == "insufficient available balance":
            payload, status = api_error("insufficient balance", "INSUFFICIENT_BALANCE", 400)
            return jsonify(payload), status
        if message == "kyc_verification_required":
            payload, status = api_error(
                "kyc verification is required before withdrawals",
                "KYC_VERIFICATION_REQUIRED",
                403,
            )
            return jsonify(payload), status
        payload, status = api_error(message, "WITHDRAWAL_CREATE_FAILED", 400)
        return jsonify(payload), status
    return (
        jsonify(
            {
                "success": True,
                "withdrawal": {
                    "id": row.id,
                    "asset": row.asset,
                    "network": row.network,
                    "address": row.address,
                    "memo": row.memo,
                    "amount": float(row.amount),
                    "status": map_withdrawal_status(row.status),
                    "rawStatus": row.status,
                    "createdAt": row.created_at.isoformat(),
                },
            }
        ),
        201,
    )


@user_bp.get("/dashboard/notifications")
def dashboard_notifications():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    _sync_dashboard_notifications(user)
    category = (request.args.get("category") or "").strip().lower()
    priority = (request.args.get("priority") or "").strip().lower()
    read_state = (request.args.get("read") or "").strip().lower()
    date_from = (request.args.get("dateFrom") or "").strip()
    date_to = (request.args.get("dateTo") or "").strip()
    page = max(1, int(request.args.get("page", 1) or 1))
    page_size = min(200, max(1, int(request.args.get("pageSize", 50) or 50)))

    query = DashboardNotification.query.filter_by(user_id=user.id)
    if category and category != "all":
        query = query.filter_by(category=category)
    if priority and priority != "all":
        query = query.filter_by(priority=priority)
    if read_state in {"read", "unread"}:
        query = query.filter_by(is_read=(read_state == "read"))
    if date_from:
        try:
            query = query.filter(DashboardNotification.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(DashboardNotification.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    total = query.count()
    rows = query.order_by(DashboardNotification.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return jsonify({"items": [_notification_payload(row) for row in rows], "page": page, "pageSize": page_size, "total": total})


@user_bp.post("/dashboard/notifications/<int:notification_id>/read")
def dashboard_notification_mark_read(notification_id: int):
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    row = DashboardNotification.query.get(notification_id)
    if not row or row.user_id != user.id:
        payload, status = api_error("not found", "NOTIFICATION_NOT_FOUND", 404)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    row.is_read = bool(data.get("isRead", True))
    db.session.commit()
    return jsonify({"success": True, "notification": _notification_payload(row)})


@user_bp.post("/dashboard/notifications/mark-all-read")
def dashboard_notifications_mark_all_read():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    DashboardNotification.query.filter_by(user_id=user.id, is_read=False).update({"is_read": True})
    db.session.commit()
    return jsonify({"success": True})


@user_bp.get("/dashboard/filter-presets")
def dashboard_filter_presets():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    scope = (request.args.get("scope") or "").strip().lower()
    query = DashboardFilterPreset.query.filter_by(user_id=user.id)
    if scope:
        query = query.filter_by(scope=scope)
    rows = query.order_by(DashboardFilterPreset.updated_at.desc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "scope": row.scope,
                "name": row.name,
                "payload": json.loads(row.payload_json or "{}"),
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]
    )


@user_bp.post("/dashboard/filter-presets")
def dashboard_filter_preset_upsert():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    scope = (data.get("scope") or "").strip().lower()
    name = (data.get("name") or "").strip()
    payload_value = data.get("payload") or {}
    if not scope or not name:
        payload, status = api_error("scope and name are required", "PRESET_REQUIRED_FIELDS", 400)
        return jsonify(payload), status
    row = DashboardFilterPreset.query.filter_by(user_id=user.id, scope=scope, name=name).first()
    if not row:
        row = DashboardFilterPreset(user_id=user.id, scope=scope, name=name, payload_json=json.dumps(payload_value))
        db.session.add(row)
    else:
        row.payload_json = json.dumps(payload_value)
        row.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True, "id": row.id})


@user_bp.delete("/dashboard/filter-presets/<int:preset_id>")
def dashboard_filter_preset_delete(preset_id: int):
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    row = DashboardFilterPreset.query.get(preset_id)
    if not row or row.user_id != user.id:
        payload, status = api_error("not found", "PRESET_NOT_FOUND", 404)
        return jsonify(payload), status
    db.session.delete(row)
    db.session.commit()
    return jsonify({"success": True})


@user_bp.get("/dashboard/onboarding-checklist")
def dashboard_onboarding_checklist():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    kyc = KycProfile.query.filter_by(user_id=user.id).first()
    topup_done = TopUpTransaction.query.filter_by(user_id=user.id, status="confirmed").count() > 0
    contract_done = MiningContract.query.filter_by(user_id=user.id).count() > 0
    withdrawal_done = WithdrawalRequest.query.filter_by(user_id=user.id).count() > 0
    items = [
        {"id": "kyc", "label": "Complete KYC", "done": bool(kyc and kyc.status == "approved"), "deepLink": "/dashboard/overview"},
        {"id": "topup", "label": "Submit top-up", "done": bool(topup_done), "deepLink": "/dashboard/topups"},
        {"id": "buy_power", "label": "Buy power", "done": bool(contract_done), "deepLink": "/dashboard/buy-power"},
        {"id": "first_withdrawal", "label": "First withdrawal", "done": bool(withdrawal_done), "deepLink": "/dashboard/withdrawals"},
    ]
    completed = len([item for item in items if item["done"]])
    next_item = next((item for item in items if not item["done"]), items[-1] if items else None)
    return jsonify({"items": items, "completed": completed, "total": len(items), "completionPct": int(round((completed / max(1, len(items))) * 100)), "next": next_item})


@user_bp.get("/dashboard/workflow")
def dashboard_workflow():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    kyc = KycProfile.query.filter_by(user_id=user.id).first()
    kyc_ok = bool(kyc and str(kyc.status or "").lower() == "approved")
    topup_ok = TopUpTransaction.query.filter_by(user_id=user.id, status="confirmed").count() > 0
    contracts_ok = MiningContract.query.filter_by(user_id=user.id).count() > 0
    withdrawals_ok = WithdrawalRequest.query.filter_by(user_id=user.id).count() > 0
    if not kyc_ok:
        next_action = {"key": "kyc", "label": "Complete KYC", "deepLink": "/dashboard/overview"}
    elif not topup_ok:
        next_action = {"key": "topup", "label": "Submit top-up", "deepLink": "/dashboard/topups"}
    elif not contracts_ok:
        next_action = {"key": "buy_power", "label": "Buy mining power", "deepLink": "/dashboard/buy-power"}
    elif not withdrawals_ok:
        next_action = {"key": "first_withdrawal", "label": "Create first withdrawal", "deepLink": "/dashboard/withdrawals"}
    else:
        next_action = {"key": "monitor", "label": "Monitor portfolio", "deepLink": "/dashboard/overview"}
    restrictions = {
        "withdrawalsFrozenByKyc": bool(kyc and kyc.verification_requested and not kyc_ok),
        "buyPowerDisabled": False,
    }
    return jsonify({"nextAction": next_action, "restrictions": restrictions})


@user_bp.get("/dashboard/audit-traces")
def dashboard_audit_traces():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    scope = (request.args.get("scope") or "").strip().lower()
    if scope == "withdrawals":
        withdrawal_ids = [row.id for row in WithdrawalRequest.query.filter_by(user_id=user.id).all()]
        rows = (
            WithdrawalEventLog.query.filter(WithdrawalEventLog.withdrawal_id.in_(withdrawal_ids) if withdrawal_ids else False)
            .order_by(WithdrawalEventLog.created_at.desc())
            .limit(300)
            .all()
        )
        return jsonify(
            [
                {
                    "id": row.id,
                    "entityId": row.withdrawal_id,
                    "actorType": row.actor_type,
                    "actorId": row.actor_id,
                    "event": row.event,
                    "details": row.details,
                    "createdAt": iso_or_none(row.created_at),
                }
                for row in rows
            ]
        )
    if scope == "support":
        ticket_ids = [row.id for row in SupportTicket.query.filter_by(requester_id=user.id).all()]
        rows = (
            SupportEventLog.query.filter(SupportEventLog.ticket_id.in_(ticket_ids) if ticket_ids else False)
            .order_by(SupportEventLog.created_at.desc())
            .limit(300)
            .all()
        )
        return jsonify(
            [
                {
                    "id": row.id,
                    "entityId": row.ticket_id,
                    "actorType": row.actor_type,
                    "actorId": row.actor_id,
                    "event": row.event,
                    "details": row.details,
                    "createdAt": iso_or_none(row.created_at),
                }
                for row in rows
            ]
        )
    if scope == "kyc":
        profile = KycProfile.query.filter_by(user_id=user.id).first()
        if not profile:
            return jsonify([])
        reviews = (
            KycReview.query.filter_by(profile_id=profile.id)
            .order_by(KycReview.created_at.desc())
            .limit(100)
            .all()
        )
        return jsonify(
            [
                {
                    "id": row.id,
                    "entityId": profile.id,
                    "actorType": "admin",
                    "actorId": row.reviewer_id,
                    "event": row.decision,
                    "details": row.reason,
                    "createdAt": iso_or_none(row.created_at),
                }
                for row in reviews
            ]
        )
    payload, status = api_error("unsupported scope", "UNSUPPORTED_SCOPE", 400)
    return jsonify(payload), status


@user_bp.get("/realtime/stream")
def user_realtime_stream():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status

    def stream():
        last_payload = None
        for _ in range(60):
            db.session.expire_all()
            payload = {
                "ts": datetime.utcnow().isoformat(),
                "kyc": (KycProfile.query.filter_by(user_id=user.id).first().status if KycProfile.query.filter_by(user_id=user.id).first() else "not_started"),
                "topupsPending": TopUpTransaction.query.filter_by(user_id=user.id, status="pending").count(),
                "withdrawalsPending": WithdrawalRequest.query.filter_by(user_id=user.id, status="pending").count(),
                "supportOpen": SupportTicket.query.filter_by(requester_id=user.id).filter(SupportTicket.status.notin_(["closed", "resolved"])).count(),
            }
            body = json.dumps(payload, ensure_ascii=True)
            if body != last_payload:
                yield f"event: dashboard\ndata: {body}\n\n"
                last_payload = body
            else:
                yield "event: ping\ndata: {}\n\n"
            import time
            time.sleep(2)

    return Response(stream(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@user_bp.get("/security/settings")
def security_settings():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    profile = UserSecurityProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        profile = UserSecurityProfile(user_id=user.id)
        db.session.add(profile)
        db.session.commit()
    active_sessions = UserSessionRecord.query.filter_by(user_id=user.id, is_revoked=False).count()
    trusted_devices = UserTrustedDevice.query.filter_by(user_id=user.id).count()
    return jsonify(
        {
            "twoFactorEnabled": bool(profile.two_factor_enabled),
            "stepUpRequired": bool(profile.step_up_required),
            "trustedDevicesOnly": bool(profile.trusted_devices_only),
            "activeSessions": active_sessions,
            "trustedDevices": trusted_devices,
        }
    )


@user_bp.post("/security/2fa/enroll")
def security_2fa_enroll():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    profile = UserSecurityProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        profile = UserSecurityProfile(user_id=user.id)
        db.session.add(profile)
    secret = secrets.token_hex(16)
    profile.two_factor_secret = secret
    profile.two_factor_enabled = False
    db.session.commit()
    return jsonify({"secret": secret, "otpauth": f"otpauth://totp/CloudMine:{user.email}?secret={secret}&issuer=CloudMine"})


@user_bp.post("/security/2fa/verify")
def security_2fa_verify():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    code = str(data.get("code") or "").strip()
    profile = UserSecurityProfile.query.filter_by(user_id=user.id).first()
    if not profile or not profile.two_factor_secret:
        payload, status = api_error("2fa not enrolled", "SECURITY_2FA_NOT_ENROLLED", 400)
        return jsonify(payload), status
    valid = any(totp_code(profile.two_factor_secret, window=offset) == code for offset in (-1, 0, 1))
    if not valid:
        payload, status = api_error("invalid 2fa code", "SECURITY_2FA_INVALID_CODE", 400)
        return jsonify(payload), status
    profile.two_factor_enabled = True
    db.session.commit()
    return jsonify({"success": True})


@user_bp.post("/security/trusted-devices")
def security_trusted_device_add():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    label = (data.get("label") or "Current device").strip()[:120]
    fp = _client_fingerprint()
    row = UserTrustedDevice.query.filter_by(user_id=user.id, device_fingerprint=fp).first()
    if not row:
        row = UserTrustedDevice(user_id=user.id, device_label=label, device_fingerprint=fp, last_seen_at=datetime.utcnow())
        db.session.add(row)
    else:
        row.device_label = label
        row.last_seen_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True})


@user_bp.get("/security/sessions")
def security_sessions():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    rows = UserSessionRecord.query.filter_by(user_id=user.id).order_by(UserSessionRecord.created_at.desc()).limit(50).all()
    return jsonify(
        [
            {
                "id": row.id,
                "isRevoked": bool(row.is_revoked),
                "ipAddress": row.ip_address,
                "userAgent": row.user_agent,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
                "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else None,
            }
            for row in rows
        ]
    )


@user_bp.post("/security/sessions/revoke")
def security_sessions_revoke():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    session_id = data.get("sessionId")
    revoke_all = bool(data.get("revokeAll"))
    query = UserSessionRecord.query.filter_by(user_id=user.id, is_revoked=False)
    if revoke_all:
        query.update({"is_revoked": True, "last_seen_at": datetime.utcnow()})
        db.session.commit()
        return jsonify({"success": True})
    row = UserSessionRecord.query.filter_by(user_id=user.id, id=session_id).first()
    if not row:
        payload, status = api_error("session not found", "SECURITY_SESSION_NOT_FOUND", 404)
        return jsonify(payload), status
    row.is_revoked = True
    row.last_seen_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True})


@user_bp.post("/withdrawals/risk-evaluate")
def evaluate_withdrawal_risk():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount") or 0)
    address = str(data.get("address") or "").strip()
    return jsonify(_evaluate_withdrawal_risk(user, amount, address))


@user_bp.get("/withdrawals")
def list_withdrawals():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    status_filter = (request.args.get("status") or "").strip().lower()
    amount_min = (request.args.get("amountMin") or "").strip()
    amount_max = (request.args.get("amountMax") or "").strip()
    date_from = (request.args.get("dateFrom") or "").strip()
    date_to = (request.args.get("dateTo") or "").strip()
    query = WithdrawalRequest.query.filter_by(user_id=user.id)
    if status_filter and status_filter != "all":
        query = query.filter(WithdrawalRequest.status == status_filter)
    if amount_min:
        try:
            query = query.filter(WithdrawalRequest.amount >= float(amount_min))
        except ValueError:
            pass
    if amount_max:
        try:
            query = query.filter(WithdrawalRequest.amount <= float(amount_max))
        except ValueError:
            pass
    if date_from:
        try:
            query = query.filter(WithdrawalRequest.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(WithdrawalRequest.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = query.order_by(WithdrawalRequest.created_at.desc()).limit(200).all()
    return jsonify(
        [
            {
                "id": row.id,
                "asset": row.asset,
                "network": row.network,
                "address": row.address,
                "memo": row.memo,
                "amount": float(row.amount),
                "status": map_withdrawal_status(row.status),
                "rawStatus": row.status,
                "adminNote": row.admin_note,
                "externalTxHash": row.external_tx_hash,
                "createdAt": iso_or_none(row.created_at),
                "updatedAt": iso_or_none(row.updated_at),
                "processedAt": iso_or_none(row.processed_at),
            }
            for row in rows
        ]
    )


@user_bp.post("/withdrawals/<int:withdrawal_id>/cancel")
def cancel_withdrawal(withdrawal_id: int):
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    row = WithdrawalRequest.query.get(withdrawal_id)
    if not row or row.user_id != user.id:
        payload, status = api_error("not found", "WITHDRAWAL_NOT_FOUND", 404)
        return jsonify(payload), status
    try:
        row = cancel_withdrawal_by_user(row, user.id)
    except ValueError as exc:
        message = str(exc)
        if message == "forbidden":
            payload, status = api_error("forbidden", "FORBIDDEN", 403)
            return jsonify(payload), status
        if message == "only pending withdrawals can be cancelled":
            payload, status = api_error(
                "only pending withdrawals can be cancelled",
                "WITHDRAWAL_INVALID_TRANSITION",
                400,
            )
            return jsonify(payload), status
        payload, status = api_error(message, "WITHDRAWAL_CANCEL_FAILED", 400)
        return jsonify(payload), status
    return jsonify({"success": True, "status": map_withdrawal_status(row.status), "rawStatus": row.status})


@user_bp.get("/mining/plans")
def list_mining_plans():
    rows = MiningPlan.query.filter_by(is_active=True).order_by(MiningPlan.price_usdt.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "name": row.name,
                "strategy": row.strategy,
                "hashrateValue": float(row.hashrate_value),
                "hashrateUnit": row.hashrate_unit,
                "durationDays": row.duration_days,
                "priceUsdt": float(row.price_usdt),
                "isPreset": row.is_preset,
            }
            for row in rows
        ]
    )


@user_bp.post("/mining/contracts")
def buy_mining_contract():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    plan_id = int(data.get("planId") or 0)
    plan = MiningPlan.query.get(plan_id)
    if not plan:
        return jsonify({"error": "plan not found"}), 404
    try:
        contract = create_contract_from_plan(user.id, plan)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return (
        jsonify(
            {
                "success": True,
                "contract": {
                    "id": contract.id,
                    "planId": contract.plan_id,
                    "strategy": contract.strategy,
                    "hashrateValue": float(contract.hashrate_value),
                    "hashrateUnit": contract.hashrate_unit,
                    "durationDays": contract.duration_days,
                    "investedUsdt": float(contract.invested_usdt),
                    "status": contract.status,
                    "startedAt": contract.started_at.isoformat(),
                    "endsAt": contract.ends_at.isoformat(),
                },
            }
        ),
        201,
    )


@user_bp.get("/mining/contracts")
def mining_contracts():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    rows = MiningContract.query.filter_by(user_id=user.id).order_by(MiningContract.created_at.desc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "planId": row.plan_id,
                "strategy": row.strategy,
                "hashrateValue": float(row.hashrate_value),
                "hashrateUnit": row.hashrate_unit,
                "durationDays": row.duration_days,
                "investedUsdt": float(row.invested_usdt),
                "status": row.status,
                "startedAt": row.started_at.isoformat(),
                "endsAt": row.ends_at.isoformat(),
            }
            for row in rows
        ]
    )


@user_bp.get("/mining/accruals")
def mining_accruals():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    contract_ids = [item.id for item in MiningContract.query.filter_by(user_id=user.id).all()]
    if not contract_ids:
        return jsonify([])
    rows = (
        MiningAccrual.query.filter(MiningAccrual.contract_id.in_(contract_ids))
        .order_by(MiningAccrual.accrual_at.desc(), MiningAccrual.accrual_date.desc())
        .limit(24 * 30)
        .all()
    )
    return jsonify(
        [
            {
                "id": row.id,
                "contractId": row.contract_id,
                "accrualDate": row.accrual_date.isoformat(),
                "accrualAt": row.accrual_at.isoformat() if row.accrual_at else None,
                "grossUsdt": float(row.gross_usdt),
                "netUsdt": float(row.net_usdt),
                "status": row.status,
                "formulaSnapshot": row.formula_snapshot,
            }
            for row in rows
        ]
    )


@user_bp.get("/mining/summary")
def mining_summary():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    summary = get_mining_summary(user.id)
    summary["availableUsdt"] = float(get_available_usdt(user.id))
    return jsonify(summary)


@user_bp.get("/staking/tiers")
def staking_tiers():
    rows = StakingTier.query.filter_by(asset="USDT", is_active=True).order_by(StakingTier.min_amount.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "asset": row.asset,
                "minAmount": float(row.min_amount),
                "maxAmount": float(row.max_amount),
                "dailyRate": float(row.daily_rate),
                "hourlyRate": float(Decimal(str(row.daily_rate)) / Decimal("24")),
                "isHotOffer": bool(row.is_hot_offer),
            }
            for row in rows
        ]
    )


@user_bp.get("/staking/positions")
def staking_positions():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    positions = (
        UserStakingPosition.query.filter_by(user_id=user.id)
        .order_by(UserStakingPosition.created_at.desc())
        .all()
    )
    payload = []
    for position in positions:
        tier = StakingTier.query.get(position.tier_id)
        total_earned = (
            db.session.query(db.func.coalesce(db.func.sum(StakingAccrual.amount), 0))
            .filter(StakingAccrual.position_id == position.id)
            .scalar()
        )
        payload.append(
            {
                "id": position.id,
                "tierId": position.tier_id,
                "amount": float(position.amount),
                "status": position.status,
                "dailyRate": float(tier.daily_rate) if tier else 0.0,
                "hourlyRate": float(Decimal(str(tier.daily_rate)) / Decimal("24")) if tier else 0.0,
                "earned": float(total_earned or 0),
                "createdAt": iso_or_none(position.created_at),
                "lastAccrualAt": iso_or_none(position.last_accrual_at),
            }
        )
    return jsonify(payload)


@user_bp.get("/staking/summary")
def staking_summary():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    invested = (
        db.session.query(db.func.coalesce(db.func.sum(UserStakingPosition.amount), 0))
        .filter(UserStakingPosition.user_id == user.id)
        .scalar()
    )
    earned = (
        db.session.query(db.func.coalesce(db.func.sum(StakingAccrual.amount), 0))
        .filter(StakingAccrual.user_id == user.id)
        .scalar()
    )
    active = UserStakingPosition.query.filter_by(user_id=user.id, status="active").count()
    return jsonify(
        {
            "totalInvestedUsdt": float(invested or 0),
            "totalEarnedUsdt": float(earned or 0),
            "activePositions": active,
        }
    )


@user_bp.post("/staking/invest")
def staking_invest():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    amount_raw = data.get("amount")
    try:
        amount = _to_decimal(amount_raw, "amount")
    except ValueError:
        payload, status = api_error("invalid amount", "STAKING_INVALID_AMOUNT", 400, {"fields": {"amount": "INVALID"}})
        return jsonify(payload), status
    if amount <= 0:
        payload, status = api_error("amount must be positive", "STAKING_INVALID_AMOUNT", 400, {"fields": {"amount": "INVALID"}})
        return jsonify(payload), status
    tier = (
        StakingTier.query.filter_by(asset="USDT", is_active=True)
        .filter(StakingTier.min_amount <= amount, StakingTier.max_amount >= amount)
        .order_by(StakingTier.min_amount.asc())
        .first()
    )
    if not tier:
        payload, status = api_error("amount is outside staking tiers", "STAKING_AMOUNT_OUT_OF_RANGE", 400, {"fields": {"amount": "OUT_OF_RANGE"}})
        return jsonify(payload), status
    available = get_available_usdt(user.id)
    if available < amount:
        payload, status = api_error("insufficient balance", "INSUFFICIENT_BALANCE", 400, {"fields": {"amount": "INSUFFICIENT"}})
        return jsonify(payload), status
    position = UserStakingPosition(
        user_id=user.id,
        tier_id=tier.id,
        amount=amount,
        status="active",
    )
    db.session.add(position)
    db.session.flush()
    db.session.add(
        UserBalanceLedger(
            user_id=user.id,
            amount=amount,
            entry_type="debit",
            reason=f"Staking invest #{position.id}",
            asset="USDT",
            network="USDT",
        )
    )
    db.session.commit()
    write_audit("user", user.id, "staking_invest", f"position_id={position.id}; amount={float(amount)}")
    return (
        jsonify(
            {
                "success": True,
                "position": {
                    "id": position.id,
                    "tierId": position.tier_id,
                    "amount": float(position.amount),
                    "status": position.status,
                    "createdAt": iso_or_none(position.created_at),
                },
            }
        ),
        201,
    )


@user_bp.get("/referral")
def referral_summary():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    code = ensure_referral_code(user.id)
    relations = ReferralRelation.query.filter_by(inviter_id=user.id).all()
    payouts = (
        ReferralPayout.query.filter_by(inviter_id=user.id)
        .order_by(ReferralPayout.created_at.desc())
        .limit(200)
        .all()
    )
    level_counts = {"1": 0, "2": 0, "3": 0}
    income_by_level = {"1": 0.0, "2": 0.0, "3": 0.0}
    for row in relations:
        key = str(row.level)
        if key in level_counts:
            level_counts[key] += 1
    for row in payouts:
        key = str(row.level)
        if key in income_by_level:
            income_by_level[key] += float(row.payout_amount)
    return jsonify(
        {
            "code": code.code,
            "link": f"/register?ref={code.code}",
            "invitesByLevel": level_counts,
            "incomeByLevel": {k: round(v, 8) for k, v in income_by_level.items()},
            "history": [
                {
                    "id": row.id,
                    "inviteeId": row.invitee_id,
                    "topupId": row.topup_id,
                    "level": row.level,
                    "percentage": float(row.percentage),
                    "baseAmount": float(row.base_amount),
                    "payoutAmount": float(row.payout_amount),
                    "status": row.status,
                    "createdAt": row.created_at.isoformat(),
                }
                for row in payouts
            ],
        }
    )


@user_bp.post("/referral/regenerate")
def referral_regenerate():
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    code = ensure_referral_code(user.id)
    code.code = uuid.uuid4().hex[:12]
    db.session.commit()
    write_audit("user", user.id, "referral_regenerate", code.code)
    return jsonify({"success": True, "code": code.code, "link": f"/register?ref={code.code}"})


@user_bp.get("/kyc")
def get_kyc_status():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    profile = KycProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        return jsonify(
            {
                "enabled": True,
                "required": False,
                "verificationRequested": False,
                "status": "not_started",
                "rawStatus": "not_started",
                "documents": [],
            }
        )

    docs = KycDocument.query.filter_by(profile_id=profile.id).order_by(KycDocument.created_at.desc()).all()
    return jsonify(
        {
            "enabled": True,
            "required": _kyc_required(profile.country),
            "verificationRequested": bool(profile.verification_requested),
            "status": map_kyc_status(profile.status),
            "rawStatus": profile.status,
            "country": profile.country,
            "reviewNote": profile.review_note,
            "documents": [
                {
                    "id": d.id,
                    "docType": d.doc_type,
                    "mimeType": d.mime_type,
                    "sizeBytes": d.size_bytes,
                    "createdAt": d.created_at.isoformat(),
                }
                for d in docs
            ],
        }
    )


@user_bp.post("/kyc/submit")
def submit_kyc():
    user = _require_user()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    country = (request.form.get("country") or "").strip().upper()
    doc_type = (request.form.get("docType") or "").strip().lower() or "id_card"
    file = request.files.get("document")
    if not file:
        payload, status = api_error("document is required", "KYC_DOCUMENT_REQUIRED", 400, {"fields": {"document": "REQUIRED"}})
        return jsonify(payload), status
    if file.mimetype not in ALLOWED_KYC_MIME:
        payload, status = api_error("unsupported file type", "KYC_UNSUPPORTED_FILE_TYPE", 400, {"fields": {"document": "INVALID"}})
        return jsonify(payload), status
    file_bytes = file.read()
    if len(file_bytes) > MAX_KYC_FILE_SIZE:
        payload, status = api_error("file too large", "KYC_FILE_TOO_LARGE", 400, {"fields": {"document": "TOO_LARGE"}})
        return jsonify(payload), status
    profile = KycProfile.query.filter_by(user_id=user.id).first()
    if not profile:
        profile = KycProfile(user_id=user.id)
        db.session.add(profile)
        db.session.flush()
    profile.country = country or profile.country
    profile.status = "pending"
    profile.verification_requested = True
    profile.review_note = ""
    user_dir = os.path.join(KYC_STORAGE_ROOT, str(user.id))
    os.makedirs(user_dir, exist_ok=True)
    ext = ".bin"
    if file.mimetype == "application/pdf":
        ext = ".pdf"
    elif file.mimetype == "image/png":
        ext = ".png"
    elif file.mimetype == "image/jpeg":
        ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(user_dir, filename)
    with open(file_path, "wb") as out:
        out.write(file_bytes)
    doc = KycDocument(
        profile_id=profile.id,
        user_id=user.id,
        doc_type=doc_type,
        file_path=file_path,
        file_hash=hashlib.sha256(file_bytes).hexdigest(),
        mime_type=file.mimetype,
        size_bytes=len(file_bytes),
    )
    db.session.add(doc)
    db.session.commit()
    write_audit("user", user.id, "kyc_submit", f"doc_id={doc.id}; doc_type={doc_type}")
    return jsonify({"success": True, "status": map_kyc_status(profile.status), "rawStatus": profile.status, "required": _kyc_required(country)})


@user_bp.get("/kyc/document/<int:doc_id>")
def download_kyc_document(doc_id: int):
    user = _require_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    doc = KycDocument.query.get(doc_id)
    if not doc or doc.user_id != user.id:
        return jsonify({"error": "not found"}), 404
    return send_file(doc.file_path, mimetype=doc.mime_type or "application/octet-stream")


@user_bp.get("/support/tickets")
def support_tickets():
    user = _require_support_actor()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    status_filter = (request.args.get("status") or "").strip().lower()
    priority_filter = (request.args.get("priority") or "").strip().lower()
    date_from = (request.args.get("dateFrom") or "").strip()
    date_to = (request.args.get("dateTo") or "").strip()
    query = SupportTicket.query.filter_by(requester_id=user.id)
    if status_filter and status_filter != "all":
        query = query.filter(SupportTicket.status == status_filter)
    if priority_filter and priority_filter != "all":
        query = query.filter(SupportTicket.priority == priority_filter)
    if date_from:
        try:
            query = query.filter(SupportTicket.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(SupportTicket.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = query.order_by(SupportTicket.updated_at.desc()).limit(100).all()
    payload = []
    for row in rows:
        row.sla_state = _ticket_sla_state(row)
        payload.append(
            {
                "id": row.id,
                "subject": row.subject,
                "priority": row.priority,
                "status": map_ticket_status(row.status),
                "rawStatus": row.status,
                "category": "general",
                "slaState": row.sla_state,
                "firstResponseDueAt": row.first_response_due_at.isoformat() if row.first_response_due_at else None,
                "resolutionDueAt": row.resolution_due_at.isoformat() if row.resolution_due_at else None,
                "updatedAt": row.updated_at.isoformat(),
                "createdAt": row.created_at.isoformat(),
            }
        )
    db.session.commit()
    return jsonify(payload)


@user_bp.post("/support/tickets")
def create_support_ticket():
    user = _require_support_actor()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    subject = (data.get("subject") or "").strip()
    priority = (data.get("priority") or "medium").strip().lower()
    message = (data.get("message") or "").strip()
    category = (data.get("category") or "general").strip().lower() or "general"
    if priority not in {"low", "medium", "high"}:
        payload, status = api_error("invalid priority", "SUPPORT_INVALID_PRIORITY", 400, {"fields": {"priority": "INVALID"}})
        return jsonify(payload), status
    if not subject or not message:
        payload, status = api_error(
            "subject and message are required",
            "SUPPORT_REQUIRED_FIELDS",
            400,
            {"fields": {"subject": "REQUIRED", "message": "REQUIRED"}},
        )
        return jsonify(payload), status
    first_due, resolution_due = _ticket_sla(priority)
    ticket = SupportTicket(
        requester_id=user.id,
        subject=subject,
        priority=priority,
        status="open",
        first_response_due_at=first_due,
        resolution_due_at=resolution_due,
        sla_state="on_track",
    )
    db.session.add(ticket)
    db.session.flush()
    db.session.add(
        SupportMessage(ticket_id=ticket.id, sender_type="user", sender_id=user.id, body=message)
    )
    db.session.add(
        SupportEventLog(
            ticket_id=ticket.id,
            actor_type="user",
            actor_id=user.id,
            event="ticket_created",
            details=f"priority={priority}",
        )
    )
    db.session.commit()
    write_audit("user", user.id, "support_ticket_create", f"ticket_id={ticket.id}")
    return jsonify({"success": True, "ticketId": ticket.id, "category": category}), 201


@user_bp.get("/support/tickets/<int:ticket_id>/messages")
def support_messages(ticket_id: int):
    user = _require_support_actor()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket or ticket.requester_id != user.id:
        payload, status = api_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
        return jsonify(payload), status
    after_id = max(0, int(request.args.get("afterId", 0) or 0))
    query = SupportMessage.query.filter_by(ticket_id=ticket_id).order_by(SupportMessage.id.asc())
    if after_id:
        query = query.filter(SupportMessage.id > after_id)
    rows = query.limit(200).all()
    return jsonify(
        {
            "ticket": {
                "id": ticket.id,
                "status": ticket.status,
                "priority": ticket.priority,
                "slaState": _ticket_sla_state(ticket),
            },
            "messages": [
                {
                    "id": row.id,
                    "senderType": row.sender_type,
                    "senderId": row.sender_id,
                    "body": row.body,
                    "eventType": "message",
                    "createdAt": row.created_at.isoformat(),
                }
                for row in rows
            ],
            "serverTime": datetime.utcnow().isoformat(),
        }
    )


@user_bp.post("/support/tickets/<int:ticket_id>/messages")
def send_support_message(ticket_id: int):
    user = _require_support_actor()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket or ticket.requester_id != user.id:
        payload, status = api_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
        return jsonify(payload), status
    data = request.get_json(silent=True) or {}
    body = (data.get("message") or "").strip()
    if not body:
        payload, status = api_error("message is required", "SUPPORT_MESSAGE_REQUIRED", 400, {"fields": {"message": "REQUIRED"}})
        return jsonify(payload), status
    if ticket.status in {"closed", "resolved"}:
        payload, status = api_error("ticket is closed", "SUPPORT_TICKET_CLOSED", 400)
        return jsonify(payload), status
    message = SupportMessage(ticket_id=ticket.id, sender_type="user", sender_id=user.id, body=body)
    ticket.updated_at = datetime.utcnow()
    db.session.add(message)
    db.session.commit()
    return jsonify({"success": True, "messageId": message.id})


@user_bp.post("/support/tickets/<int:ticket_id>/close")
def close_support_ticket(ticket_id: int):
    user = _require_support_actor()
    if not user:
        payload, status = api_error("unauthorized", "AUTH_UNAUTHORIZED", 401)
        return jsonify(payload), status
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket or ticket.requester_id != user.id:
        payload, status = api_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
        return jsonify(payload), status
    if ticket.status == "closed":
        return jsonify({"success": True, "status": "closed", "rawStatus": "closed"})

    ticket.status = "closed"
    ticket.resolved_at = datetime.utcnow()
    ticket.updated_at = datetime.utcnow()
    db.session.add(
        SupportEventLog(
            ticket_id=ticket.id,
            actor_type="user",
            actor_id=user.id,
            event="ticket_closed",
            details=f"ticket_id={ticket.id}",
        )
    )
    db.session.add(
        SupportMessage(
            ticket_id=ticket.id,
            sender_type="system",
            sender_id=user.id,
            body="Ticket closed by requester.",
        )
    )
    db.session.commit()
    write_audit("user", user.id, "support_ticket_close", f"ticket_id={ticket.id}")
    return jsonify({"success": True, "status": "closed", "rawStatus": "closed"})


@user_bp.post("/support/guest-session")
@rate_limit(20, 300)
def open_guest_support_session():
    current = _require_user()
    if current:
        return jsonify({"success": True, "mode": "user", "userId": current.id})
    guest_id = session.get("guest_user_id")
    if guest_id:
        row = User.query.get(guest_id)
        if row and not row.is_admin:
            return jsonify({"success": True, "mode": "guest", "userId": row.id})

    guest_email = f"guest_{uuid.uuid4().hex[:12]}@guest.cloudmine.local"
    guest_password = create_token()
    row = User(
        email=guest_email,
        password_hash=hash_password(guest_password),
        is_active=True,
        is_admin=False,
    )
    db.session.add(row)
    db.session.commit()
    session["guest_user_id"] = row.id
    return jsonify({"success": True, "mode": "guest", "userId": row.id}), 201


@user_bp.post("/team-applications")
@rate_limit(8, 300)
def submit_team_application():
    data = request.get_json(silent=True) or {}
    full_name = (data.get("fullName") or "").strip()
    email = (data.get("email") or "").strip().lower()
    role = (data.get("role") or "").strip()
    experience = (data.get("experience") or "").strip()
    message = (data.get("message") or "").strip()

    if not full_name or not email or not role or not experience:
        return jsonify({"error": "fullName, email, role, experience are required"}), 400
    if len(full_name) > 255 or len(role) > 255:
        return jsonify({"error": "fullName/role are too long"}), 400
    if len(experience) > 100:
        return jsonify({"error": "experience is too long"}), 400
    if len(message) > 4000:
        return jsonify({"error": "message is too long"}), 400
    if not _is_valid_email(email):
        return jsonify({"error": "invalid email format"}), 400

    row = TeamApplication(
        full_name=full_name,
        email=email,
        role=role,
        experience=experience,
        message=message,
        status="new",
        email_delivery_status="failed",
    )
    db.session.add(row)
    db.session.flush()
    try:
        send_team_application_email(full_name, email, role, experience, message)
        row.email_delivery_status = "sent"
        db.session.commit()
    except EmailServiceError as exc:
        db.session.commit()
        return jsonify({"error": str(exc), "applicationId": row.id}), 500

    return jsonify({"success": True, "applicationId": row.id}), 201
