import secrets
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, session

from models import TopUpTransaction, User, WalletAddress, db
from services.audit_service import write_audit
from services.dashboard_contract import api_error, iso_or_none, map_topup_status, map_topup_verification_status
from services.wallet_verifier import process_topup

wallet_bp = Blueprint("wallet", __name__, url_prefix="/api/wallet")
TOPUP_SUFFIX_SCALE = Decimal("0.0001")
TOPUP_RESERVATION_MINUTES = 60


def _require_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return User.query.get(user_id)


def _err(message: str, code: str, status: int):
    payload, status_code = api_error(message, code, status)
    return jsonify(payload), status_code


def _generate_expected_amount(base_amount: Decimal, wallet_id: int) -> tuple[Decimal, int]:
    now = datetime.utcnow()
    active = TopUpTransaction.query.filter(
        TopUpTransaction.wallet_id == wallet_id,
        TopUpTransaction.status == "pending",
        TopUpTransaction.expires_at.isnot(None),
        TopUpTransaction.expires_at > now,
    ).all()
    busy_suffixes = {int(row.unique_suffix) for row in active if row.unique_suffix is not None}
    for _ in range(100):
        suffix = secrets.randbelow(9999) + 1
        if suffix in busy_suffixes:
            continue
        expected = (base_amount + (Decimal(suffix) * TOPUP_SUFFIX_SCALE)).quantize(Decimal("0.00000001"))
        return expected, suffix
    raise ValueError("no unique suffix available")


@wallet_bp.get("/addresses")
def addresses():
    user = _require_user()
    if not user:
        return _err("unauthorized", "UNAUTHORIZED", 401)

    asset = request.args.get("asset")
    network = request.args.get("network")
    query = WalletAddress.query.filter_by(is_active=True)
    if asset:
        query = query.filter_by(asset=asset)
    if network:
        query = query.filter_by(network=network)
    wallets = query.order_by(WalletAddress.asset.asc(), WalletAddress.network.asc()).all()
    return jsonify(
        [
            {"id": w.id, "asset": w.asset, "network": w.network, "address": w.address}
            for w in wallets
        ]
    )


@wallet_bp.post("/topup")
def create_topup():
    user = _require_user()
    if not user:
        return _err("unauthorized", "UNAUTHORIZED", 401)

    data = request.get_json(silent=True) or {}
    wallet_id = data.get("walletId")
    amount = data.get("amount")
    try:
        amount = Decimal(str(amount or "0"))
    except (InvalidOperation, TypeError):
        return _err("amount must be numeric", "INVALID_AMOUNT", 400)
    if not wallet_id or amount <= 0:
        payload, status = api_error(
            "walletId and positive amount are required",
            "INVALID_TOPUP_REQUEST",
            400,
            {"fields": {"walletId": "REQUIRED", "amount": "INVALID"}},
        )
        return jsonify(payload), status

    wallet = WalletAddress.query.get(wallet_id)
    if not wallet or not wallet.is_active:
        return _err("wallet is not available", "WALLET_INACTIVE", 404)
    if (wallet.asset or "").upper() != "USDT":
        return _err("only USDT top-ups are supported", "UNSUPPORTED_ASSET", 400)
    if (wallet.network or "").upper() != "TRX":
        return _err("only TRON network is supported", "UNSUPPORTED_NETWORK", 400)
    try:
        expected_amount, unique_suffix = _generate_expected_amount(amount, wallet.id)
    except ValueError:
        return _err("failed to reserve unique topup amount", "TOPUP_RESERVATION_FAILED", 409)
    pending_marker = f"PENDING:{secrets.token_urlsafe(16)}"

    topup = TopUpTransaction(
        user_id=user.id,
        wallet_id=wallet.id,
        asset=wallet.asset,
        network=wallet.network,
        tx_hash=pending_marker,
        amount=expected_amount,
        base_amount=amount,
        unique_suffix=unique_suffix,
        expected_amount=expected_amount,
        expires_at=datetime.utcnow() + timedelta(minutes=TOPUP_RESERVATION_MINUTES),
        status="pending",
        verification_status="queued",
    )
    db.session.add(topup)
    db.session.commit()
    write_audit("user", user.id, "topup_create", f"topup_id={topup.id}; expected_amount={expected_amount}")
    return (
        jsonify(
            {
                "success": True,
                "topup": {
                    "id": topup.id,
                    "asset": topup.asset,
                    "network": topup.network,
                    "txHash": None,
                    "amount": str(Decimal(str(topup.amount)).quantize(Decimal("0.00000001"))),
                    "baseAmount": str(Decimal(str(topup.base_amount or amount)).quantize(Decimal("0.00000001"))),
                    "expectedAmount": str(Decimal(str(topup.expected_amount or topup.amount)).quantize(Decimal("0.00000001"))),
                    "uniqueSuffix": topup.unique_suffix,
                    "expiresAt": iso_or_none(topup.expires_at),
                    "status": map_topup_status(topup.status),
                    "rawStatus": topup.status,
                    "verificationStatus": map_topup_verification_status(topup.verification_status),
                    "rawVerificationStatus": topup.verification_status,
                    "createdAt": topup.created_at.isoformat(),
                },
            }
        ),
        201,
    )


@wallet_bp.post("/topup/<int:topup_id>/verify")
def verify_topup(topup_id: int):
    user = _require_user()
    if not user:
        return _err("unauthorized", "UNAUTHORIZED", 401)

    topup = TopUpTransaction.query.filter_by(id=topup_id, user_id=user.id).first()
    if not topup:
        return _err("topup not found", "TOPUP_NOT_FOUND", 404)

    topup.verification_status = "queued"
    topup.next_retry_at = datetime.utcnow()
    topup.is_dead_letter = False
    db.session.commit()
    return jsonify({"success": True, "status": topup.status, "verificationStatus": topup.verification_status, "code": "QUEUED"})


@wallet_bp.get("/topups")
def topups():
    user = _require_user()
    if not user:
        return _err("unauthorized", "UNAUTHORIZED", 401)

    status_filter = (request.args.get("status") or "").strip().lower()
    amount_min = (request.args.get("amountMin") or "").strip()
    amount_max = (request.args.get("amountMax") or "").strip()
    date_from = (request.args.get("dateFrom") or "").strip()
    date_to = (request.args.get("dateTo") or "").strip()
    query = TopUpTransaction.query.filter_by(user_id=user.id)
    if status_filter and status_filter != "all":
        query = query.filter(TopUpTransaction.status == status_filter)
    if amount_min:
        try:
            query = query.filter(TopUpTransaction.amount >= float(amount_min))
        except ValueError:
            pass
    if amount_max:
        try:
            query = query.filter(TopUpTransaction.amount <= float(amount_max))
        except ValueError:
            pass
    if date_from:
        try:
            query = query.filter(TopUpTransaction.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(TopUpTransaction.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = query.order_by(TopUpTransaction.created_at.desc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "asset": row.asset,
                "network": row.network,
                "amount": float(row.amount),
                "baseAmount": float(row.base_amount) if row.base_amount is not None else float(row.amount),
                "expectedAmount": float(row.expected_amount) if row.expected_amount is not None else float(row.amount),
                "uniqueSuffix": row.unique_suffix,
                "expiresAt": iso_or_none(row.expires_at),
                "status": map_topup_status(row.status),
                "rawStatus": row.status,
                "verificationStatus": map_topup_verification_status(row.verification_status),
                "rawVerificationStatus": row.verification_status,
                "providerNote": row.provider_note,
                "lastErrorCode": row.last_error_code,
                "feeAmount": None,
                "attempts": row.verification_attempts,
                "nextRetryAt": iso_or_none(row.next_retry_at),
                "isDeadLetter": bool(row.is_dead_letter),
                "createdAt": iso_or_none(row.created_at),
                "confirmedAt": iso_or_none(row.confirmed_at),
                "txHash": None if str(row.tx_hash or "").startswith("PENDING:") else row.tx_hash,
            }
            for row in rows
        ]
    )


@wallet_bp.post("/topup/<int:topup_id>/process-now")
def process_topup_now(topup_id: int):
    user = _require_user()
    if not user:
        return _err("unauthorized", "UNAUTHORIZED", 401)
    topup = TopUpTransaction.query.filter_by(id=topup_id, user_id=user.id).first()
    if not topup:
        return _err("topup not found", "TOPUP_NOT_FOUND", 404)
    process_topup(topup)
    return jsonify(
        {
            "success": True,
            "status": map_topup_status(topup.status),
            "rawStatus": topup.status,
            "verificationStatus": map_topup_verification_status(topup.verification_status),
            "rawVerificationStatus": topup.verification_status,
        }
    )
