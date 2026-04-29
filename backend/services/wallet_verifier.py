from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import os
from typing import Optional

from models import ApiCredential, TopUpTransaction, UserBalanceLedger, WalletAddress, db
from services.pricing_service import convert_to_usdt, save_conversion_snapshot
from services.referral_service import apply_referral_payouts_for_topup
from services.providers import verify_with_provider


NETWORK_PROVIDER = {
    "TRX": "tron",
    "ERC20": "evm",
    "BEP20": "evm",
    "BTC": "btc",
    "ETH": "evm",
}
SUPPORTED_ASSET = "USDT"
SUPPORTED_NETWORK = "TRX"
MIN_TRON_CONFIRMATIONS = int(os.getenv("TOPUP_MIN_CONFIRMATIONS_TRX", "12"))


def _get_provider_credential(provider: str) -> Optional[ApiCredential]:
    return ApiCredential.query.filter_by(provider=provider, is_active=True).first()


def verify_transaction(topup: TopUpTransaction) -> dict:
    if (topup.asset or "").upper() != SUPPORTED_ASSET:
        return {"confirmed": False, "errorCode": "UNSUPPORTED_ASSET", "message": "Only USDT top-ups are supported"}
    if (topup.network or "").upper() != SUPPORTED_NETWORK:
        return {"confirmed": False, "errorCode": "UNSUPPORTED_NETWORK", "message": "Only TRON network top-ups are supported"}

    provider = NETWORK_PROVIDER.get(topup.network)
    if not provider:
        return {"confirmed": False, "errorCode": "INVALID_NETWORK", "message": "Unsupported network"}

    credential = _get_provider_credential(provider)
    if not credential:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "Provider API key is not configured"}

    provider_url = credential.api_url or ""
    if not provider_url:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "Provider API url is not configured"}

    api_key = (credential.get_api_key() or "").strip()
    if not api_key:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "Provider API key is not configured"}
    try:
        provider_result = verify_with_provider(provider, provider_url, api_key, topup.tx_hash)
    except Exception:
        return {"confirmed": False, "errorCode": "PROVIDER_REQUEST_FAILED", "message": "Provider request failed"}

    if not provider_result.get("confirmed"):
        return provider_result

    wallet = db.session.get(WalletAddress, topup.wallet_id)
    to_address = (provider_result.get("toAddress") or "").strip()
    if not to_address:
        return {"confirmed": False, "errorCode": "ADDRESS_UNAVAILABLE", "message": "Unable to extract destination address"}
    if wallet:
        if (wallet.address or "").strip().lower() != to_address.strip().lower():
            return {"confirmed": False, "errorCode": "ADDRESS_MISMATCH", "message": "Top-up address mismatch"}

    provider_amount = provider_result.get("amount")
    if provider_amount is None:
        return {"confirmed": False, "errorCode": "AMOUNT_UNAVAILABLE", "message": "Unable to extract transfer amount"}
    try:
        provider_decimal = Decimal(str(provider_amount))
        expected_decimal = Decimal(str(topup.amount))
        if provider_decimal < expected_decimal:
            return {"confirmed": False, "errorCode": "AMOUNT_MISMATCH", "message": "On-chain amount is lower than requested"}
    except (InvalidOperation, TypeError):
        return {"confirmed": False, "errorCode": "AMOUNT_PARSE_ERROR", "message": "Unable to validate on-chain amount"}

    confirmations = int(provider_result.get("confirmations") or 0)
    if confirmations < MIN_TRON_CONFIRMATIONS:
        return {
            "confirmed": False,
            "errorCode": "INSUFFICIENT_CONFIRMATIONS",
            "message": f"Confirmations {confirmations}/{MIN_TRON_CONFIRMATIONS}",
        }

    return provider_result


def settle_topup(topup: TopUpTransaction) -> TopUpTransaction:
    if topup.status == "confirmed":
        return topup

    existing_credit = UserBalanceLedger.query.filter_by(topup_id=topup.id, entry_type="credit").first()
    if existing_credit:
        topup.status = "confirmed"
        if not topup.confirmed_at:
            topup.confirmed_at = datetime.utcnow()
        db.session.commit()
        return topup

    topup.status = "confirmed"
    topup.confirmed_at = datetime.utcnow()
    try:
        conversion = convert_to_usdt(topup.asset, topup.amount)
        credit_amount = conversion["convertedAmount"]
    except Exception:
        conversion = {
            "source": "fallback",
            "baseAsset": topup.asset,
            "rate": Decimal("1"),
            "originalAmount": Decimal(str(topup.amount)),
            "convertedAmount": Decimal(str(topup.amount)),
        }
        credit_amount = conversion["convertedAmount"]
    db.session.add(
        UserBalanceLedger(
            user_id=topup.user_id,
            amount=credit_amount,
            entry_type="credit",
            reason=f"Top-up confirmed: {topup.tx_hash} ({topup.asset}->{conversion['convertedAmount']} USDT)",
            topup_id=topup.id,
            asset="USDT",
            network="USDT",
        )
    )
    db.session.commit()
    save_conversion_snapshot(
        source=conversion["source"],
        base_asset=conversion["baseAsset"],
        rate=conversion["rate"],
        original_amount=conversion["originalAmount"],
        converted_amount=conversion["convertedAmount"],
        topup_id=topup.id,
    )
    apply_referral_payouts_for_topup(topup)
    return topup


def process_topup(topup: TopUpTransaction) -> TopUpTransaction:
    if topup.is_dead_letter:
        return topup
    if topup.status == "confirmed":
        topup.verification_status = "done"
        db.session.commit()
        return topup

    max_attempts = 10
    if topup.verification_attempts >= max_attempts:
        topup.verification_status = "failed"
        topup.is_dead_letter = True
        topup.last_error_code = "MAX_ATTEMPTS_EXCEEDED"
        db.session.commit()
        return topup

    topup.verification_status = "running"
    topup.verification_started_at = datetime.utcnow()
    topup.verification_attempts = int(topup.verification_attempts or 0) + 1
    topup.last_checked_at = datetime.utcnow()
    db.session.commit()

    verification = verify_transaction(topup)
    topup.provider_note = verification.get("message")
    topup.last_error_code = verification.get("errorCode")
    if verification.get("confirmed"):
        topup = settle_topup(topup)
        topup.verification_status = "done"
        topup.next_retry_at = None
        topup.is_dead_letter = False
        db.session.commit()
    else:
        topup.verification_status = "failed"
        attempt = int(topup.verification_attempts or 1)
        delay_seconds = min(300, 2 ** min(attempt, 8))
        topup.next_retry_at = datetime.utcnow() + timedelta(seconds=delay_seconds)
        if attempt >= max_attempts:
            topup.is_dead_letter = True
        db.session.commit()
    return topup
