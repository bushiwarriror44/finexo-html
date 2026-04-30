from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from models import KycProfile, UserBalanceLedger, WithdrawalEventLog, WithdrawalRequest, db
from services.audit_service import write_audit

MANUAL_CREDIT_REASON_PREFIX = "MANUAL_CREDIT_PURCHASE_ONLY:"


ADMIN_TRANSITIONS = {
    "approve": {"pending"},
    "start_processing": {"approved"},
    "complete": {"processing"},
    "reject": {"pending", "approved"},
}


def _entry_sign(entry_type: str) -> int:
    if entry_type in {"credit", "withdrawal_release"}:
        return 1
    return -1


def _event(withdrawal_id: int, actor_type: str, actor_id: Optional[int], event: str, details: str = "") -> None:
    db.session.add(
        WithdrawalEventLog(
            withdrawal_id=withdrawal_id,
            actor_type=actor_type,
            actor_id=actor_id,
            event=event,
            details=details,
        )
    )


def get_available_balance(user_id: int, asset: str, network: str, include_purchase_only: bool = True) -> dict:
    rows = UserBalanceLedger.query.filter_by(user_id=user_id, asset=asset, network=network).all()
    total = Decimal("0")
    held = Decimal("0")
    for row in rows:
        # Bonus/purchase-only credits are withdrawable by current business rules.
        # The include_purchase_only flag is kept for backward compatibility but no longer excludes entries.
        amount = Decimal(str(row.amount))
        total += amount * _entry_sign(row.entry_type)
        if row.entry_type == "withdrawal_hold":
            held += amount
        if row.entry_type == "withdrawal_release":
            held -= amount
    if held < 0:
        held = Decimal("0")
    available = total - held
    # Available/withdrawable balance should never be negative in UI/API.
    if available < 0:
        available = Decimal("0")
    return {
        "total": total,
        "held": held,
        "available": available,
    }


def create_withdrawal_request(user_id: int, asset: str, network: str, address: str, memo: str, amount_raw) -> WithdrawalRequest:
    try:
        amount = Decimal(str(amount_raw))
    except (InvalidOperation, TypeError):
        raise ValueError("invalid amount")
    if amount <= 0:
        raise ValueError("amount must be positive")
    asset = (asset or "").strip().upper()
    network = (network or "").strip().upper()
    address = (address or "").strip()
    memo = (memo or "").strip() or None
    if not asset or not network or not address:
        raise ValueError("asset, network and address are required")
    profile = KycProfile.query.filter_by(user_id=user_id).first()
    if profile and bool(profile.verification_requested) and str(profile.status or "").lower() != "approved":
        raise ValueError("kyc_verification_required")

    balances = get_available_balance(user_id, asset, network, include_purchase_only=False)
    if balances["available"] < amount:
        raise ValueError("insufficient available balance")

    request_row = WithdrawalRequest(
        user_id=user_id,
        asset=asset,
        network=network,
        address=address,
        memo=memo,
        amount=amount,
        status="pending",
    )
    db.session.add(request_row)
    db.session.flush()
    db.session.add(
        UserBalanceLedger(
            user_id=user_id,
            withdrawal_id=request_row.id,
            amount=amount,
            entry_type="withdrawal_hold",
            reason=f"Withdrawal hold #{request_row.id}",
            asset=asset,
            network=network,
        )
    )
    _event(request_row.id, "user", user_id, "created", f"amount={float(amount)}")
    db.session.commit()
    write_audit("user", user_id, "withdrawal_create", f"withdrawal_id={request_row.id}; amount={float(amount)}")
    return request_row


def release_withdrawal(request_row: WithdrawalRequest, actor_type: str, actor_id: Optional[int], note: str = "") -> WithdrawalRequest:
    already_released = UserBalanceLedger.query.filter_by(
        withdrawal_id=request_row.id, entry_type="withdrawal_release"
    ).first()
    if not already_released:
        db.session.add(
            UserBalanceLedger(
                user_id=request_row.user_id,
                withdrawal_id=request_row.id,
                amount=request_row.amount,
                entry_type="withdrawal_release",
                reason=f"Withdrawal release #{request_row.id}",
                asset=request_row.asset,
                network=request_row.network,
            )
        )
    _event(request_row.id, actor_type, actor_id, "release", note)
    return request_row


def finalize_withdrawal(request_row: WithdrawalRequest, actor_type: str, actor_id: Optional[int], note: str = "") -> WithdrawalRequest:
    already_finalized = UserBalanceLedger.query.filter_by(
        withdrawal_id=request_row.id, entry_type="withdrawal_finalize"
    ).first()
    if not already_finalized:
        db.session.add(
            UserBalanceLedger(
                user_id=request_row.user_id,
                withdrawal_id=request_row.id,
                amount=request_row.amount,
                entry_type="withdrawal_finalize",
                reason=f"Withdrawal finalized #{request_row.id}",
                asset=request_row.asset,
                network=request_row.network,
            )
        )
    _event(request_row.id, actor_type, actor_id, "finalize", note)
    return request_row


def transition_withdrawal_status(
    request_row: WithdrawalRequest,
    action: str,
    actor_type: str,
    actor_id: Optional[int],
    admin_note: str = "",
    external_tx_hash: str = "",
) -> WithdrawalRequest:
    action = (action or "").strip().lower()
    allowed_from = ADMIN_TRANSITIONS.get(action)
    if not allowed_from:
        raise ValueError("unsupported action")
    if request_row.status not in allowed_from:
        raise ValueError("invalid status transition")

    if action == "approve":
        request_row.status = "approved"
    elif action == "start_processing":
        request_row.status = "processing"
    elif action == "complete":
        if not external_tx_hash:
            raise ValueError("externalTxHash is required")
        request_row.external_tx_hash = external_tx_hash.strip()
        request_row.status = "completed"
        request_row.processed_at = datetime.utcnow()
        finalize_withdrawal(request_row, actor_type, actor_id, admin_note)
    elif action == "reject":
        request_row.status = "rejected"
        request_row.processed_at = datetime.utcnow()
        release_withdrawal(request_row, actor_type, actor_id, admin_note)

    if admin_note:
        request_row.admin_note = admin_note.strip()
    _event(request_row.id, actor_type, actor_id, f"status_{request_row.status}", admin_note)
    db.session.commit()
    write_audit(
        actor_type,
        actor_id,
        "withdrawal_status_change",
        f"withdrawal_id={request_row.id}; status={request_row.status}; action={action}",
    )
    return request_row


def cancel_withdrawal_by_user(request_row: WithdrawalRequest, user_id: int) -> WithdrawalRequest:
    if request_row.user_id != user_id:
        raise ValueError("forbidden")
    if request_row.status != "pending":
        raise ValueError("only pending withdrawals can be cancelled")
    request_row.status = "cancelled"
    request_row.processed_at = datetime.utcnow()
    release_withdrawal(request_row, "user", user_id, "cancelled by user")
    _event(request_row.id, "user", user_id, "status_cancelled", "")
    db.session.commit()
    write_audit("user", user_id, "withdrawal_cancel", f"withdrawal_id={request_row.id}")
    return request_row
