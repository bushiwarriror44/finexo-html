from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, jsonify, request, send_file, session

from sqlalchemy import func, or_

from models import (
    MiningAccrual,
    MiningContract,
    MiningPlan,
    MiningStrategyParam,
    ApiCredential,
    ApiCredentialVersion,
    KycProfile,
    KycDocument,
    KycReview,
    ReferralPayout,
    ReferralRule,
    StakingAccrual,
    StakingTier,
    SupportEventLog,
    SupportMessage,
    SupportSlaRule,
    SupportTicket,
    TopUpTransaction,
    User,
    UserBalanceLedger,
    UserStakingPosition,
    WalletAddress,
    WithdrawalEventLog,
    WithdrawalRequest,
    db,
)
from services.audit_service import write_audit
from services.dashboard_contract import api_error, map_kyc_status, map_ticket_status, map_topup_status, map_topup_verification_status, map_withdrawal_status
from services.withdrawal_service import transition_withdrawal_status
from services.wallet_verifier import process_topup
from services.providers.tron_provider import get_tron_usdt_wallet_balance

admin_api_bp = Blueprint("admin_api", __name__, url_prefix="/admin/api")
MANUAL_CREDIT_REASON_PREFIX = "MANUAL_CREDIT_PURCHASE_ONLY:"


def _require_admin():
    user_id = session.get("admin_user_id")
    if not user_id:
        return None
    user = User.query.get(user_id)
    if not user or not user.is_admin or not user.is_active:
        return None
    return user


def _json_error(message: str, code: str, status: int, details=None):
    payload, status_code = api_error(message, code, status, details)
    return jsonify(payload), status_code


def _parse_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return None


def _ledger_breakdown(user_id: int) -> dict:
    rows = UserBalanceLedger.query.filter_by(user_id=user_id, asset="USDT", network="USDT").all()
    total = Decimal("0")
    held = Decimal("0")
    purchase_only = Decimal("0")
    for row in rows:
        amount = Decimal(str(row.amount))
        if row.entry_type in {"credit", "withdrawal_release"}:
            total += amount
        else:
            total -= amount
        if row.entry_type == "withdrawal_hold":
            held += amount
        elif row.entry_type == "withdrawal_release":
            held -= amount
        if row.entry_type == "credit" and str(row.reason or "").startswith(MANUAL_CREDIT_REASON_PREFIX):
            purchase_only += amount
    if held < 0:
        held = Decimal("0")
    available = total - held
    withdrawable = available - purchase_only
    if withdrawable < 0:
        withdrawable = Decimal("0")
    return {
        "total": total,
        "held": held,
        "available": available,
        "withdrawable": withdrawable,
        "purchaseOnly": purchase_only,
    }


@admin_api_bp.get("/users")
def admin_users():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    q = (request.args.get("q") or "").strip().lower()
    is_active = (request.args.get("isActive") or "").strip().lower()
    role = (request.args.get("role") or "").strip().lower()
    page = _parse_int(request.args.get("page", 1), 1)
    page_size = _parse_int(request.args.get("pageSize", 50), 50)
    if page is None or page_size is None:
        return _json_error("invalid pagination params", "INVALID_PAGINATION", 400)
    page = max(1, page)
    page_size = min(200, max(1, page_size))

    query = User.query
    if q:
        if q.isdigit():
            query = query.filter((User.email.ilike(f"%{q}%")) | (User.id == int(q)))
        else:
            query = query.filter(User.email.ilike(f"%{q}%"))
    if is_active in {"true", "false"}:
        query = query.filter(User.is_active.is_(is_active == "true"))
    if role == "admin":
        query = query.filter(User.is_admin.is_(True))
    elif role == "user":
        query = query.filter(User.is_admin.is_(False))

    total_count = query.count()
    rows = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    payload = []
    for row in rows:
        ledger = _ledger_breakdown(row.id)
        payload.append(
            {
                "id": row.id,
                "email": row.email,
                "isAdmin": row.is_admin,
                "isActive": row.is_active,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
                "availableBalanceUsdt": str(ledger["available"].quantize(Decimal("0.00000001"))),
                "heldBalanceUsdt": str(ledger["held"].quantize(Decimal("0.00000001"))),
                "withdrawableBalanceUsdt": str(ledger["withdrawable"].quantize(Decimal("0.00000001"))),
                "purchaseOnlyBalanceUsdt": str(ledger["purchaseOnly"].quantize(Decimal("0.00000001"))),
            }
        )
    return jsonify({"items": payload, "page": page, "pageSize": page_size, "total": total_count})


@admin_api_bp.get("/users/<int:user_id>")
def admin_user_detail(user_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    row = User.query.get(user_id)
    if not row:
        return _json_error("user not found", "USER_NOT_FOUND", 404)
    ledger = _ledger_breakdown(row.id)
    return jsonify(
        {
            "id": row.id,
            "email": row.email,
            "isAdmin": row.is_admin,
            "isActive": row.is_active,
            "createdAt": row.created_at.isoformat() if row.created_at else None,
            "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            "balances": {
                "availableUsdt": str(ledger["available"].quantize(Decimal("0.00000001"))),
                "heldUsdt": str(ledger["held"].quantize(Decimal("0.00000001"))),
                "withdrawableUsdt": str(ledger["withdrawable"].quantize(Decimal("0.00000001"))),
                "purchaseOnlyUsdt": str(ledger["purchaseOnly"].quantize(Decimal("0.00000001"))),
            },
        }
    )


@admin_api_bp.get("/credentials")
def get_credentials():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    rows = ApiCredential.query.order_by(ApiCredential.provider.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "provider": row.provider,
                "apiUrl": row.api_url,
                "apiKeyConfigured": bool(row.get_api_key()),
                "version": row.version,
                "isActive": row.is_active,
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/credentials")
def upsert_credentials():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    provider = (data.get("provider") or "").strip().lower()
    api_url = (data.get("apiUrl") or "").strip()
    api_key = (data.get("apiKey") or "").strip()
    is_active = bool(data.get("isActive", True))
    if not provider:
        return jsonify({"error": "provider is required"}), 400

    row = ApiCredential.query.filter_by(provider=provider).first()
    if not row:
        row = ApiCredential(provider=provider)
        db.session.add(row)
        db.session.flush()
    row.api_url = api_url
    if api_key:
        row.set_api_key(api_key)
        encrypted_key = row.api_key_encrypted
        next_version = int(row.version or 0) + 1
        db.session.add(
            ApiCredentialVersion(
                credential_id=row.id,
                provider=provider,
                version=next_version,
                api_key_encrypted=encrypted_key,
            )
        )
        row.version = next_version
    row.is_active = is_active
    db.session.commit()
    write_audit("admin", admin.id, "credential_upsert", f"provider={provider}")
    return jsonify({"success": True})


@admin_api_bp.get("/credentials/<int:credential_id>/versions")
def get_credential_versions(credential_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    rows = (
        ApiCredentialVersion.query.filter_by(credential_id=credential_id)
        .order_by(ApiCredentialVersion.version.desc())
        .all()
    )
    return jsonify(
        [{"id": row.id, "provider": row.provider, "version": row.version, "createdAt": row.created_at.isoformat()} for row in rows]
    )


@admin_api_bp.get("/wallets")
def get_wallets():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    rows = WalletAddress.query.order_by(WalletAddress.asset.asc(), WalletAddress.network.asc()).all()
    tron_credential = ApiCredential.query.filter_by(provider="tron", is_active=True).first()
    tron_url = (tron_credential.api_url or "").strip() if tron_credential else ""
    tron_key = (tron_credential.get_api_key() or "").strip() if tron_credential else ""
    payload = []
    for row in rows:
        onchain_balance = None
        if str(row.asset or "").upper() == "USDT" and str(row.network or "").upper() == "TRX":
            resolved = get_tron_usdt_wallet_balance(tron_url, tron_key, row.address)
            if resolved is not None:
                onchain_balance = str(resolved.quantize(Decimal("0.000001")))
        payload.append(
            {
                "id": row.id,
                "asset": row.asset,
                "network": row.network,
                "address": row.address,
                "isActive": row.is_active,
                "onchainUsdtBalance": onchain_balance,
            }
        )
    return jsonify(payload)


@admin_api_bp.post("/wallets")
def create_wallet():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    asset = (data.get("asset") or "").strip().upper()
    network = (data.get("network") or "").strip().upper()
    address = (data.get("address") or "").strip()
    if not asset or not network or not address:
        return jsonify({"error": "asset, network and address are required"}), 400
    if asset != "USDT":
        return jsonify({"error": "only USDT wallets are supported"}), 400
    if network != "TRX":
        return jsonify({"error": "only TRX network wallets are supported"}), 400

    wallet = WalletAddress(asset=asset, network=network, address=address, is_active=True)
    db.session.add(wallet)
    db.session.commit()
    write_audit("admin", admin.id, "wallet_create", f"{asset}:{network}")
    return jsonify({"success": True, "id": wallet.id}), 201


@admin_api_bp.patch("/wallets/<int:wallet_id>")
def update_wallet(wallet_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    wallet = WalletAddress.query.get(wallet_id)
    if not wallet:
        return jsonify({"error": "wallet not found"}), 404
    data = request.get_json(silent=True) or {}
    wallet.is_active = bool(data.get("isActive", wallet.is_active))
    db.session.commit()
    write_audit("admin", admin.id, "wallet_update", f"wallet_id={wallet_id}")
    return jsonify({"success": True})


@admin_api_bp.get("/topups")
def admin_topups():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    query = TopUpTransaction.query
    asset = request.args.get("asset")
    network = request.args.get("network")
    user_id = request.args.get("userId")
    status = request.args.get("status")
    verification_status = request.args.get("verificationStatus")
    if asset:
        query = query.filter_by(asset=asset)
    if network:
        query = query.filter_by(network=network)
    if user_id:
        try:
            query = query.filter_by(user_id=int(user_id))
        except ValueError:
            return _json_error("invalid userId", "INVALID_USER_ID", 400)
    if status:
        query = query.filter_by(status=status)
    if verification_status:
        query = query.filter_by(verification_status=verification_status)
    rows = query.order_by(TopUpTransaction.created_at.desc()).limit(200).all()
    return jsonify(
        [
            {
                "id": row.id,
                "userId": row.user_id,
                "asset": row.asset,
                "network": row.network,
                "txHash": row.tx_hash,
                "amount": float(row.amount),
                "status": map_topup_status(row.status),
                "rawStatus": row.status,
                "verificationStatus": map_topup_verification_status(row.verification_status),
                "rawVerificationStatus": row.verification_status,
                "providerNote": row.provider_note,
                "lastErrorCode": row.last_error_code,
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/topups/<int:topup_id>/retry")
def admin_retry_topup(topup_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    row = TopUpTransaction.query.get(topup_id)
    if not row:
        return _json_error("topup not found", "TOPUP_NOT_FOUND", 404)
    if row.status == "confirmed":
        return _json_error("topup already confirmed", "TOPUP_ALREADY_CONFIRMED", 400)
    row.verification_status = "queued"
    row.is_dead_letter = False
    row.next_retry_at = datetime.utcnow()
    db.session.commit()
    process_topup(row)
    write_audit("admin", admin.id, "topup_retry", f"topup_id={topup_id}")
    return jsonify({"success": True, "status": row.status, "verificationStatus": row.verification_status})


@admin_api_bp.post("/users/<int:user_id>/balance-adjustment")
def adjust_balance(user_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "user not found"}), 404
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount") or 0)
    reason = (data.get("reason") or "").strip() or "Admin balance adjustment"
    if amount == 0:
        return jsonify({"error": "amount must not be zero"}), 400

    entry_type = "credit" if amount > 0 else "debit"
    db.session.add(
        UserBalanceLedger(
            user_id=user.id,
            amount=abs(amount),
            entry_type=entry_type,
            reason=reason,
        )
    )
    db.session.commit()
    write_audit("admin", admin.id, "balance_adjustment", f"user_id={user.id}; amount={amount}")
    return jsonify({"success": True})


@admin_api_bp.post("/users/<int:user_id>/manual-credit")
def manual_credit(user_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    user = User.query.get(user_id)
    if not user:
        return _json_error("user not found", "USER_NOT_FOUND", 404)
    data = request.get_json(silent=True) or {}
    try:
        amount = Decimal(str(data.get("amount") or "0"))
    except Exception:
        return _json_error("amount must be numeric", "INVALID_AMOUNT", 400)
    reason = (data.get("reason") or "").strip()
    if amount <= 0:
        return _json_error("amount must be positive", "INVALID_AMOUNT", 400)
    if not reason:
        return _json_error(
            "reason is required",
            "REASON_REQUIRED",
            400,
            {"fields": {"reason": "REQUIRED"}},
        )
    db.session.add(
        UserBalanceLedger(
            user_id=user.id,
            amount=amount,
            entry_type="credit",
            reason=f"{MANUAL_CREDIT_REASON_PREFIX}{reason}",
            asset="USDT",
            network="USDT",
        )
    )
    db.session.commit()
    write_audit("admin", admin.id, "manual_credit", f"user_id={user.id}; amount={amount}")
    ledger = _ledger_breakdown(user.id)
    return jsonify(
        {
            "success": True,
            "balances": {
                "availableUsdt": str(ledger["available"].quantize(Decimal("0.00000001"))),
                "withdrawableUsdt": str(ledger["withdrawable"].quantize(Decimal("0.00000001"))),
                "purchaseOnlyUsdt": str(ledger["purchaseOnly"].quantize(Decimal("0.00000001"))),
            },
        }
    )


@admin_api_bp.get("/referral/rules")
def referral_rules():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    rows = ReferralRule.query.order_by(ReferralRule.updated_at.desc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "name": row.name,
                "level1Percent": float(row.level1_percent),
                "level2Percent": float(row.level2_percent),
                "level3Percent": float(row.level3_percent),
                "minEventAmount": float(row.min_event_amount),
                "isActive": row.is_active,
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/referral/rules")
def upsert_referral_rule():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    row = ReferralRule.query.get(row_id) if row_id else ReferralRule()
    if not row:
        return jsonify({"error": "rule not found"}), 404
    row.name = (data.get("name") or row.name or "Referral campaign").strip()
    row.level1_percent = float(data.get("level1Percent", row.level1_percent or 0))
    row.level2_percent = float(data.get("level2Percent", row.level2_percent or 0))
    row.level3_percent = float(data.get("level3Percent", row.level3_percent or 0))
    row.min_event_amount = float(data.get("minEventAmount", row.min_event_amount or 0))
    row.is_active = bool(data.get("isActive", row.is_active))
    if row.is_active:
        ReferralRule.query.update({"is_active": False})
    db.session.add(row)
    db.session.commit()
    write_audit("admin", admin.id, "referral_rule_upsert", f"rule_id={row.id}")
    return jsonify({"success": True, "id": row.id})


@admin_api_bp.get("/referral/stats")
def referral_stats():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    payouts = ReferralPayout.query.order_by(ReferralPayout.created_at.desc()).limit(500).all()
    totals = {"level1": 0.0, "level2": 0.0, "level3": 0.0}
    for row in payouts:
        key = f"level{row.level}"
        if key in totals:
            totals[key] += float(row.payout_amount)
    return jsonify(
        {
            "totals": {k: round(v, 8) for k, v in totals.items()},
            "recent": [
                {
                    "id": row.id,
                    "inviterId": row.inviter_id,
                    "inviteeId": row.invitee_id,
                    "level": row.level,
                    "amount": float(row.payout_amount),
                    "status": row.status,
                    "createdAt": row.created_at.isoformat(),
                }
                for row in payouts[:100]
            ],
        }
    )


@admin_api_bp.get("/kyc/queue")
def kyc_queue():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    status = (request.args.get("status") or "").strip().lower()
    q = (request.args.get("q") or "").strip().lower()
    has_docs = (request.args.get("hasDocs") or "").strip().lower()
    query = KycProfile.query
    if status and status != "all":
        query = query.filter_by(status=status)
    if q:
        if q.isdigit():
            query = query.join(User, User.id == KycProfile.user_id).filter((User.email.ilike(f"%{q}%")) | (User.id == int(q)))
        else:
            query = query.join(User, User.id == KycProfile.user_id).filter(User.email.ilike(f"%{q}%"))
    if has_docs in {"true", "false"}:
        with_docs = has_docs == "true"
        sub = db.session.query(KycDocument.profile_id).distinct()
        query = query.filter(KycProfile.id.in_(sub) if with_docs else ~KycProfile.id.in_(sub))
    rows = query.order_by(KycProfile.updated_at.asc()).limit(200).all()
    docs_count = {
        row.profile_id: row.count
        for row in db.session.query(KycDocument.profile_id, db.func.count(KycDocument.id).label("count"))
        .group_by(KycDocument.profile_id)
        .all()
    }
    users = {u.id: u for u in User.query.filter(User.id.in_([row.user_id for row in rows])).all()} if rows else {}
    return jsonify(
        [
            {
                "id": row.id,
                "userId": row.user_id,
                "userEmail": (users.get(row.user_id).email if users.get(row.user_id) else None),
                "country": row.country,
                "status": map_kyc_status(row.status),
                "rawStatus": row.status,
                "verificationRequested": bool(row.verification_requested),
                "documentsCount": int(docs_count.get(row.id, 0)),
                "reviewNote": row.review_note,
                "updatedAt": row.updated_at.isoformat(),
            }
            for row in rows
        ]
    )


@admin_api_bp.get("/kyc/profiles")
def kyc_profiles():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    status = (request.args.get("status") or "all").strip().lower()
    q = (request.args.get("q") or "").strip().lower()
    page = _parse_int(request.args.get("page", 1), 1)
    page_size = _parse_int(request.args.get("pageSize", 50), 50)
    if page is None or page_size is None:
        return _json_error("invalid pagination params", "INVALID_PAGINATION", 400)
    page = max(1, page)
    page_size = min(200, max(1, page_size))

    query = User.query.filter(User.is_admin.is_(False))
    if q:
        if q.isdigit():
            query = query.filter((User.email.ilike(f"%{q}%")) | (User.id == int(q)))
        else:
            query = query.filter(User.email.ilike(f"%{q}%"))
    filtered_query = query
    if status != "all":
        filtered_query = filtered_query.join(KycProfile, KycProfile.user_id == User.id, isouter=True).filter(
            db.func.lower(db.func.coalesce(KycProfile.status, "not_started")) == status
        )
    total_count = filtered_query.count()
    users = filtered_query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    user_ids = [u.id for u in users]
    profiles = KycProfile.query.filter(KycProfile.user_id.in_(user_ids)).all() if user_ids else []
    profile_by_user = {p.user_id: p for p in profiles}
    docs_count = {
        row.user_id: row.count
        for row in db.session.query(KycDocument.user_id, db.func.count(KycDocument.id).label("count"))
        .filter(KycDocument.user_id.in_(user_ids))
        .group_by(KycDocument.user_id)
        .all()
    } if user_ids else {}
    items = []
    for user in users:
        profile = profile_by_user.get(user.id)
        raw_status = str(profile.status if profile else "not_started").lower()
        items.append(
            {
                "profileId": profile.id if profile else None,
                "userId": user.id,
                "userEmail": user.email,
                "country": profile.country if profile else None,
                "status": map_kyc_status(raw_status),
                "rawStatus": raw_status,
                "verificationRequested": bool(profile.verification_requested) if profile else False,
                "documentsCount": int(docs_count.get(user.id, 0)),
                "reviewNote": profile.review_note if profile else "",
                "updatedAt": profile.updated_at.isoformat() if profile and profile.updated_at else (user.updated_at.isoformat() if user.updated_at else None),
            }
        )
    return jsonify({"items": items, "page": page, "pageSize": page_size, "total": total_count})


@admin_api_bp.get("/kyc/<int:profile_id>")
def kyc_profile_detail(profile_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    row = KycProfile.query.get(profile_id)
    if not row:
        return _json_error("profile not found", "KYC_PROFILE_NOT_FOUND", 404)
    docs = KycDocument.query.filter_by(profile_id=row.id).order_by(KycDocument.created_at.desc()).all()
    user = User.query.get(row.user_id)
    return jsonify(
        {
            "id": row.id,
            "userId": row.user_id,
            "userEmail": user.email if user else None,
            "country": row.country,
            "status": map_kyc_status(row.status),
            "rawStatus": row.status,
            "verificationRequested": bool(row.verification_requested),
            "reviewNote": row.review_note,
            "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            "documents": [
                {
                    "id": doc.id,
                    "docType": doc.doc_type,
                    "mimeType": doc.mime_type,
                    "sizeBytes": doc.size_bytes,
                    "createdAt": doc.created_at.isoformat() if doc.created_at else None,
                }
                for doc in docs
            ],
        }
    )


@admin_api_bp.get("/kyc/document/<int:doc_id>")
def admin_download_kyc_document(doc_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    doc = KycDocument.query.get(doc_id)
    if not doc:
        return _json_error("document not found", "KYC_DOCUMENT_NOT_FOUND", 404)
    return send_file(doc.file_path, mimetype=doc.mime_type or "application/octet-stream")


@admin_api_bp.post("/kyc/request-verification")
def admin_request_verification():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    data = request.get_json(silent=True) or {}
    user_id = _parse_int(data.get("userId"), 0)
    if user_id <= 0:
        return _json_error("userId is required", "KYC_USER_REQUIRED", 400)
    user = User.query.get(user_id)
    if not user:
        return _json_error("user not found", "USER_NOT_FOUND", 404)
    row = KycProfile.query.filter_by(user_id=user.id).first()
    if not row:
        row = KycProfile(user_id=user.id, status="not_started")
        db.session.add(row)
        db.session.flush()
    row.verification_requested = True
    if str(row.status or "").lower() == "approved":
        row.review_note = data.get("reason") or row.review_note
    else:
        row.review_note = (data.get("reason") or "").strip() or row.review_note
    db.session.commit()
    write_audit("admin", admin.id, "kyc_request_verification", f"profile_id={row.id}; user_id={user.id}")
    return jsonify({"success": True, "profileId": row.id, "status": map_kyc_status(row.status), "rawStatus": row.status, "verificationRequested": True})


@admin_api_bp.post("/kyc/<int:profile_id>/review")
def kyc_review(profile_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    row = KycProfile.query.get(profile_id)
    if not row:
        return _json_error("profile not found", "KYC_PROFILE_NOT_FOUND", 404)
    data = request.get_json(silent=True) or {}
    decision = (data.get("decision") or "").strip().lower()
    reason = (data.get("reason") or "").strip()
    if decision not in {"approved", "rejected"}:
        return _json_error("decision must be approved or rejected", "KYC_INVALID_DECISION", 400)
    row.status = decision
    row.verification_requested = decision != "approved"
    row.review_note = reason
    row.reviewed_by = admin.id
    db.session.add(KycReview(profile_id=row.id, reviewer_id=admin.id, decision=decision, reason=reason))
    db.session.commit()
    write_audit("admin", admin.id, "kyc_review", f"profile_id={row.id}; decision={decision}")
    return jsonify(
        {
            "success": True,
            "status": map_kyc_status(row.status),
            "rawStatus": row.status,
            "verificationRequested": bool(row.verification_requested),
        }
    )


@admin_api_bp.get("/support/sla-rules")
def support_sla_rules():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    rows = SupportSlaRule.query.order_by(SupportSlaRule.priority.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "priority": row.priority,
                "firstResponseMinutes": row.first_response_minutes,
                "resolutionMinutes": row.resolution_minutes,
                "isActive": row.is_active,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/support/sla-rules")
def support_sla_upsert():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    priority = (data.get("priority") or "").strip().lower()
    if priority not in {"low", "medium", "high"}:
        return jsonify({"error": "invalid priority"}), 400
    row = SupportSlaRule.query.filter_by(priority=priority).first()
    if not row:
        row = SupportSlaRule(priority=priority, first_response_minutes=120, resolution_minutes=1440, is_active=True)
    row.first_response_minutes = int(data.get("firstResponseMinutes", row.first_response_minutes))
    row.resolution_minutes = int(data.get("resolutionMinutes", row.resolution_minutes))
    row.is_active = bool(data.get("isActive", row.is_active))
    db.session.add(row)
    db.session.commit()
    write_audit("admin", admin.id, "support_sla_upsert", f"priority={priority}")
    return jsonify({"success": True})


@admin_api_bp.get("/support/tickets")
def admin_support_tickets():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    status = (request.args.get("status") or "").strip().lower()
    priority = (request.args.get("priority") or "").strip().lower()
    query = SupportTicket.query
    if status:
        query = query.filter_by(status=status)
    if priority:
        query = query.filter_by(priority=priority)
    rows = query.order_by(SupportTicket.updated_at.desc()).limit(300).all()
    now = datetime.utcnow()
    payload = []
    for row in rows:
        sla_state = "on_track"
        if row.status in {"closed", "resolved"}:
            sla_state = "closed"
        elif row.resolution_due_at and row.resolution_due_at < now:
            sla_state = "breached"
        elif row.resolution_due_at and row.resolution_due_at < now + timedelta(minutes=30):
            sla_state = "at_risk"
        payload.append(
            {
                "id": row.id,
                "requesterId": row.requester_id,
                "assigneeId": row.assignee_id,
                "subject": row.subject,
                "priority": row.priority,
                "status": map_ticket_status(row.status),
                "rawStatus": row.status,
                "category": "general",
                "slaState": sla_state,
                "firstResponseDueAt": row.first_response_due_at.isoformat() if row.first_response_due_at else None,
                "resolutionDueAt": row.resolution_due_at.isoformat() if row.resolution_due_at else None,
                "updatedAt": row.updated_at.isoformat(),
                "createdAt": row.created_at.isoformat(),
            }
        )
    return jsonify(payload)


@admin_api_bp.get("/support/tickets/<int:ticket_id>/messages")
def admin_ticket_messages(ticket_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket:
        return _json_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
    rows = SupportMessage.query.filter_by(ticket_id=ticket_id).order_by(SupportMessage.id.asc()).limit(500).all()
    return jsonify(
        [
            {
                "id": row.id,
                "senderType": row.sender_type,
                "senderId": row.sender_id,
                "body": row.body,
                "eventType": "message" if row.sender_type != "system" else "system",
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/support/tickets/<int:ticket_id>/messages")
def admin_send_ticket_message(ticket_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket:
        return _json_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
    data = request.get_json(silent=True) or {}
    body = (data.get("message") or "").strip()
    if not body:
        return _json_error("message is required", "SUPPORT_MESSAGE_REQUIRED", 400, {"fields": {"message": "REQUIRED"}})
    row = SupportMessage(ticket_id=ticket.id, sender_type="admin", sender_id=admin.id, body=body)
    if not ticket.first_responded_at:
        ticket.first_responded_at = datetime.utcnow()
    ticket.updated_at = datetime.utcnow()
    db.session.add(row)
    db.session.commit()
    return jsonify({"success": True, "messageId": row.id})


@admin_api_bp.post("/support/tickets/<int:ticket_id>/action")
def admin_ticket_action(ticket_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    ticket = SupportTicket.query.get(ticket_id)
    if not ticket:
        return _json_error("not found", "SUPPORT_TICKET_NOT_FOUND", 404)
    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action == "assign":
        assignee_id = _parse_int(data.get("assigneeId"), admin.id)
        if assignee_id is None:
            return _json_error("invalid assigneeId", "INVALID_ASSIGNEE_ID", 400, {"fields": {"assigneeId": "INVALID"}})
        ticket.assignee_id = assignee_id
        ticket.status = "in_progress"
    elif action == "waiting_user":
        ticket.status = "waiting_user"
    elif action == "resolve":
        ticket.status = "resolved"
        ticket.resolved_at = datetime.utcnow()
    elif action == "close":
        ticket.status = "closed"
        ticket.resolved_at = datetime.utcnow()
    elif action == "escalate":
        ticket.priority = "high"
        rule = SupportSlaRule.query.filter_by(priority="high", is_active=True).first()
        if rule:
            now = datetime.utcnow()
            ticket.first_response_due_at = now + timedelta(minutes=int(rule.first_response_minutes))
            ticket.resolution_due_at = now + timedelta(minutes=int(rule.resolution_minutes))
    else:
        return _json_error("unsupported action", "SUPPORT_UNSUPPORTED_ACTION", 400)
    ticket.updated_at = datetime.utcnow()
    db.session.add(
        SupportEventLog(
            ticket_id=ticket.id,
            actor_type="admin",
            actor_id=admin.id,
            event=f"ticket_{action}",
            details=f"ticket_id={ticket.id}",
        )
    )
    db.session.commit()
    write_audit("admin", admin.id, "support_ticket_action", f"ticket_id={ticket.id}; action={action}")
    return jsonify({"success": True, "status": map_ticket_status(ticket.status), "rawStatus": ticket.status})


@admin_api_bp.get("/withdrawals")
def admin_withdrawals():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    query = WithdrawalRequest.query
    status = (request.args.get("status") or "").strip().lower()
    asset = (request.args.get("asset") or "").strip().upper()
    network = (request.args.get("network") or "").strip().upper()
    user_id = request.args.get("userId")
    if status:
        query = query.filter_by(status=status)
    if asset:
        query = query.filter_by(asset=asset)
    if network:
        query = query.filter_by(network=network)
    if user_id:
        parsed_user_id = _parse_int(user_id)
        if parsed_user_id is None:
            return _json_error("invalid userId", "INVALID_USER_ID", 400, {"fields": {"userId": "INVALID"}})
        query = query.filter_by(user_id=parsed_user_id)
    rows = query.order_by(WithdrawalRequest.created_at.desc()).limit(500).all()
    return jsonify(
        [
            {
                "id": row.id,
                "userId": row.user_id,
                "asset": row.asset,
                "network": row.network,
                "address": row.address,
                "memo": row.memo,
                "amount": float(row.amount),
                "status": map_withdrawal_status(row.status),
                "rawStatus": row.status,
                "adminNote": row.admin_note,
                "externalTxHash": row.external_tx_hash,
                "createdAt": row.created_at.isoformat(),
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
                "processedAt": row.processed_at.isoformat() if row.processed_at else None,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/withdrawals/<int:withdrawal_id>/action")
def admin_withdrawal_action(withdrawal_id: int):
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    row = WithdrawalRequest.query.get(withdrawal_id)
    if not row:
        return _json_error("withdrawal not found", "WITHDRAWAL_NOT_FOUND", 404)
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    admin_note = (data.get("adminNote") or "").strip()
    external_tx_hash = (data.get("externalTxHash") or "").strip()
    try:
        updated = transition_withdrawal_status(
            request_row=row,
            action=action,
            actor_type="admin",
            actor_id=admin.id,
            admin_note=admin_note,
            external_tx_hash=external_tx_hash,
        )
    except ValueError as exc:
        message = str(exc)
        if message == "invalid status transition":
            return _json_error(message, "WITHDRAWAL_INVALID_TRANSITION", 400)
        if message == "externalTxHash is required":
            return _json_error(message, "WITHDRAWAL_EXTERNAL_HASH_REQUIRED", 400, {"fields": {"externalTxHash": "REQUIRED"}})
        return _json_error(message, "WITHDRAWAL_ACTION_FAILED", 400)
    return jsonify(
        {
            "success": True,
            "status": map_withdrawal_status(updated.status),
            "rawStatus": updated.status,
            "externalTxHash": updated.external_tx_hash,
            "processedAt": updated.processed_at.isoformat() if updated.processed_at else None,
        }
    )


@admin_api_bp.get("/withdrawals/<int:withdrawal_id>/events")
def admin_withdrawal_events(withdrawal_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    row = WithdrawalRequest.query.get(withdrawal_id)
    if not row:
        return jsonify({"error": "withdrawal not found"}), 404
    events = (
        WithdrawalEventLog.query.filter_by(withdrawal_id=withdrawal_id)
        .order_by(WithdrawalEventLog.created_at.asc())
        .all()
    )
    return jsonify(
        [
            {
                "id": event.id,
                "event": event.event,
                "actorType": event.actor_type,
                "actorId": event.actor_id,
                "details": event.details,
                "createdAt": event.created_at.isoformat(),
            }
            for event in events
        ]
    )


@admin_api_bp.get("/mining/plans")
def admin_mining_plans():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    rows = MiningPlan.query.order_by(MiningPlan.price_usdt.asc()).all()
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
                "isActive": row.is_active,
                "isPreset": row.is_preset,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/mining/plans")
def admin_upsert_mining_plan():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    row = MiningPlan.query.get(row_id) if row_id else MiningPlan()
    if row_id and not row:
        return jsonify({"error": "plan not found"}), 404
    row.name = (data.get("name") or row.name or "").strip()
    row.strategy = (data.get("strategy") or row.strategy or "").strip()
    row.hashrate_value = float(data.get("hashrateValue", row.hashrate_value or 0))
    row.hashrate_unit = (data.get("hashrateUnit") or row.hashrate_unit or "").strip()
    row.duration_days = int(data.get("durationDays", row.duration_days or 0))
    row.price_usdt = float(data.get("priceUsdt", row.price_usdt or 0))
    row.is_active = bool(data.get("isActive", row.is_active if row.id else True))
    row.is_preset = bool(data.get("isPreset", row.is_preset if row.id else False))
    if not row.name or not row.strategy or not row.hashrate_unit or row.hashrate_value <= 0 or row.duration_days <= 0 or row.price_usdt <= 0:
        return jsonify({"error": "invalid mining plan payload"}), 400
    db.session.add(row)
    db.session.commit()
    write_audit("admin", admin.id, "mining_plan_upsert", f"plan_id={row.id}")
    return jsonify({"success": True, "id": row.id})


@admin_api_bp.post("/mining/plans/<int:plan_id>/toggle")
def admin_toggle_mining_plan(plan_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    row = MiningPlan.query.get(plan_id)
    if not row:
        return jsonify({"error": "plan not found"}), 404
    row.is_active = not row.is_active
    db.session.commit()
    write_audit("admin", admin.id, "mining_plan_toggle", f"plan_id={row.id}; active={row.is_active}")
    return jsonify({"success": True, "isActive": row.is_active})


@admin_api_bp.get("/mining/strategy-params")
def admin_mining_strategy_params():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    rows = MiningStrategyParam.query.order_by(MiningStrategyParam.strategy.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "strategy": row.strategy,
                "baseYieldPerHashPerDay": float(row.base_yield_per_hash_per_day),
                "difficultyFactor": float(row.difficulty_factor),
                "priceFactor": float(row.price_factor),
                "feeFactor": float(row.fee_factor),
                "volatilityBand": float(row.volatility_band),
                "uptimeFactor": float(row.uptime_factor),
                "isActive": row.is_active,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/mining/strategy-params")
def admin_upsert_mining_strategy_params():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    strategy = (data.get("strategy") or "").strip()
    if not strategy:
        return jsonify({"error": "strategy is required"}), 400
    row = MiningStrategyParam.query.filter_by(strategy=strategy).first()
    if not row:
        row = MiningStrategyParam(strategy=strategy, base_yield_per_hash_per_day=0.000001)
    row.base_yield_per_hash_per_day = float(data.get("baseYieldPerHashPerDay", row.base_yield_per_hash_per_day))
    row.difficulty_factor = float(data.get("difficultyFactor", row.difficulty_factor))
    row.price_factor = float(data.get("priceFactor", row.price_factor))
    row.fee_factor = float(data.get("feeFactor", row.fee_factor))
    row.volatility_band = float(data.get("volatilityBand", row.volatility_band))
    row.uptime_factor = float(data.get("uptimeFactor", row.uptime_factor))
    row.is_active = bool(data.get("isActive", row.is_active))
    db.session.add(row)
    db.session.commit()
    write_audit("admin", admin.id, "mining_strategy_param_upsert", f"strategy={strategy}")
    return jsonify({"success": True})


@admin_api_bp.get("/mining/metrics")
def admin_mining_metrics():
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    contracts = MiningContract.query.all()
    accruals = MiningAccrual.query.all()
    return jsonify(
        {
            "totalContracts": len(contracts),
            "activeContracts": sum(1 for item in contracts if item.status == "active"),
            "totalInvestedUsdt": round(sum(float(item.invested_usdt) for item in contracts), 8),
            "totalAccruedUsdt": round(sum(float(item.net_usdt) for item in accruals), 8),
            "lastAccrualDate": max((item.accrual_date.isoformat() for item in accruals), default=None),
        }
    )


@admin_api_bp.get("/staking/metrics")
def admin_staking_metrics():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    total_staked = (
        db.session.query(func.coalesce(func.sum(UserStakingPosition.amount), 0))
        .filter(UserStakingPosition.status == "active")
        .scalar()
    )
    total_accrued = db.session.query(func.coalesce(func.sum(StakingAccrual.amount), 0)).scalar()
    active_positions = UserStakingPosition.query.filter_by(status="active").count()
    total_positions = UserStakingPosition.query.count()
    return jsonify(
        {
            "totalStakedUsdt": float(total_staked or 0),
            "totalAccruedUsdt": float(total_accrued or 0),
            "activePositions": active_positions,
            "totalPositions": total_positions,
        }
    )


@admin_api_bp.get("/staking/users")
def admin_staking_users():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    page = max(1, _parse_int(request.args.get("page", 1), 1) or 1)
    page_size = min(200, max(1, _parse_int(request.args.get("pageSize", 50), 50) or 50))
    q = (request.args.get("q") or "").strip().lower()

    query = User.query.join(UserStakingPosition, User.id == UserStakingPosition.user_id)
    if q:
        if q.isdigit():
            query = query.filter(or_(User.email.ilike(f"%{q}%"), User.id == int(q)))
        else:
            query = query.filter(User.email.ilike(f"%{q}%"))
    query = query.distinct()
    total = query.count()
    users = query.order_by(User.id.asc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for user in users:
        all_pos = UserStakingPosition.query.filter_by(user_id=user.id).all()
        active_pos = [p for p in all_pos if p.status == "active"]
        total_staked = sum(float(p.amount) for p in active_pos)
        accrued = (
            db.session.query(func.coalesce(func.sum(StakingAccrual.amount), 0))
            .filter(StakingAccrual.user_id == user.id)
            .scalar()
        )
        last_opened = None
        for p in all_pos:
            if p.created_at and (last_opened is None or p.created_at > last_opened):
                last_opened = p.created_at
        items.append(
            {
                "userId": user.id,
                "email": user.email,
                "totalStakedUsdt": round(total_staked, 8),
                "activePositions": len(active_pos),
                "positionsCount": len(all_pos),
                "totalAccruedUsdt": float(accrued or 0),
                "lastOpenedAt": last_opened.isoformat() if last_opened else None,
            }
        )
    return jsonify({"items": items, "total": total, "page": page, "pageSize": page_size})


@admin_api_bp.get("/staking/tiers")
def admin_staking_tiers_list():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    rows = StakingTier.query.order_by(StakingTier.min_amount.asc()).all()
    return jsonify(
        [
            {
                "id": row.id,
                "asset": row.asset,
                "minAmount": float(row.min_amount),
                "maxAmount": float(row.max_amount),
                "dailyRate": float(row.daily_rate),
                "isHotOffer": bool(row.is_hot_offer),
                "isActive": bool(row.is_active),
                "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]
    )


@admin_api_bp.post("/staking/tiers")
def admin_staking_tier_update():
    admin = _require_admin()
    if not admin:
        return _json_error("forbidden", "FORBIDDEN", 403)
    data = request.get_json(silent=True) or {}
    tier_id = _parse_int(data.get("tierId") if data.get("tierId") is not None else data.get("id"))
    if not tier_id:
        return _json_error("tierId is required", "STAKING_TIER_ID_REQUIRED", 400)
    tier = StakingTier.query.get(tier_id)
    if not tier:
        return _json_error("tier not found", "STAKING_TIER_NOT_FOUND", 404)
    if "dailyRate" in data and data.get("dailyRate") is not None:
        try:
            dr = Decimal(str(data.get("dailyRate")))
        except Exception:
            return _json_error("invalid dailyRate", "STAKING_INVALID_RATE", 400)
        if dr < Decimal("0") or dr > Decimal("0.5"):
            return _json_error("dailyRate out of allowed range (0 - 0.5)", "STAKING_RATE_RANGE", 400)
        tier.daily_rate = dr
    next_min = tier.min_amount
    next_max = tier.max_amount
    if "minAmount" in data and data.get("minAmount") is not None:
        try:
            next_min = Decimal(str(data.get("minAmount")))
        except Exception:
            return _json_error("invalid minAmount", "STAKING_INVALID_MIN_AMOUNT", 400)
    if "maxAmount" in data and data.get("maxAmount") is not None:
        try:
            next_max = Decimal(str(data.get("maxAmount")))
        except Exception:
            return _json_error("invalid maxAmount", "STAKING_INVALID_MAX_AMOUNT", 400)
    if next_min < Decimal("0"):
        return _json_error("minAmount must be >= 0", "STAKING_MIN_AMOUNT_RANGE", 400)
    if next_max <= next_min:
        return _json_error("maxAmount must be greater than minAmount", "STAKING_INVALID_RANGE", 400)
    overlap = (
        StakingTier.query.filter(
            StakingTier.id != tier.id,
            StakingTier.asset == tier.asset,
            StakingTier.is_active.is_(True),
            StakingTier.max_amount >= next_min,
            StakingTier.min_amount <= next_max,
        )
        .first()
    )
    if overlap:
        return _json_error(
            "staking range overlaps an existing active tier",
            "STAKING_RANGE_OVERLAP",
            400,
        )
    tier.min_amount = next_min
    tier.max_amount = next_max
    if "isActive" in data:
        tier.is_active = bool(data.get("isActive"))
    if "isHotOffer" in data:
        tier.is_hot_offer = bool(data.get("isHotOffer"))
    db.session.commit()
    write_audit(
        "admin",
        admin.id,
        "staking_tier_update",
        f"tier_id={tier.id}; min={float(tier.min_amount)}; max={float(tier.max_amount)}; daily_rate={float(tier.daily_rate)}; active={tier.is_active}",
    )
    return jsonify(
        {
            "success": True,
            "tier": {
                "id": tier.id,
                "asset": tier.asset,
                "minAmount": float(tier.min_amount),
                "maxAmount": float(tier.max_amount),
                "dailyRate": float(tier.daily_rate),
                "isHotOffer": bool(tier.is_hot_offer),
                "isActive": bool(tier.is_active),
                "updatedAt": tier.updated_at.isoformat() if tier.updated_at else None,
            },
        }
    )
