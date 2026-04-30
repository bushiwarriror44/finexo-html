from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import os
from typing import Optional

from models import ApiCredential, TelegramBotSettings, TopUpTransaction, User, UserBalanceLedger, WalletAddress, db
from services.pricing_service import convert_to_usdt, save_conversion_snapshot
from services.referral_service import apply_referral_payouts_for_topup
from services.providers import verify_with_provider
from services.providers.tron_provider import TronProviderError, list_tron_usdt_incoming_transfers
from services.telegram_service import send_topup_confirmed_notification


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
TOPUP_MAX_PROCESSING_HOURS = int(os.getenv("TOPUP_MAX_PROCESSING_HOURS", "72"))


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
    expected_amount = topup.expected_amount if topup.expected_amount is not None else topup.amount
    if topup.expires_at and topup.expires_at <= datetime.utcnow():
        return {"confirmed": False, "errorCode": "TOPUP_EXPIRED", "message": "Top-up request expired"}

    tx_hash = (topup.tx_hash or "").strip()
    if tx_hash.startswith("PENDING:"):
        wallet = db.session.get(WalletAddress, topup.wallet_id)
        if not wallet:
            return {"confirmed": False, "errorCode": "WALLET_INACTIVE", "message": "Wallet is not available"}
        min_ts_ms = 0
        if topup.created_at:
            min_ts_ms = int(topup.created_at.timestamp() * 1000)
        try:
            transfers = list_tron_usdt_incoming_transfers(provider_url, api_key, wallet.address, min_timestamp_ms=min_ts_ms)
        except TronProviderError as exc:
            return {"confirmed": False, "errorCode": exc.error_code, "message": exc.message}
        expected_decimal = Decimal(str(expected_amount or 0)).quantize(Decimal("0.00000001"))
        for item in transfers:
            try:
                candidate_amount = Decimal(str(item.get("amount") or "0")).quantize(Decimal("0.00000001"))
            except Exception:
                continue
            if candidate_amount != expected_decimal:
                continue
            candidate_hash = (item.get("txHash") or "").strip()
            if not candidate_hash:
                continue
            used_by_other = TopUpTransaction.query.filter(
                TopUpTransaction.id != topup.id,
                TopUpTransaction.tx_hash == candidate_hash,
                TopUpTransaction.status == "confirmed",
            ).first()
            if used_by_other:
                continue
            topup.tx_hash = candidate_hash
            db.session.commit()
            provider_result = {
                "confirmed": True,
                "toAddress": item.get("toAddress"),
                "amount": str(candidate_amount),
                "confirmations": int(item.get("confirmations") or 0),
                "message": "matched by expected unique amount",
                "errorCode": None,
            }
            break
        else:
            return {"confirmed": False, "errorCode": "PAYMENT_NOT_FOUND", "message": "Matching payment not found yet"}
    else:
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
        expected_decimal = Decimal(str(expected_amount))
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
    try:
        bot_settings = TelegramBotSettings.query.filter_by(is_active=True).order_by(TelegramBotSettings.id.asc()).first()
        if bot_settings and bot_settings.last_chat_id:
            bot_token = bot_settings.get_bot_token()
            if bot_token:
                user = User.query.get(topup.user_id)
                send_topup_confirmed_notification(
                    bot_token,
                    bot_settings.last_chat_id,
                    topup_id=topup.id,
                    user_id=topup.user_id,
                    user_email=(user.email if user else f"user_{topup.user_id}"),
                    amount=topup.amount,
                    asset=topup.asset,
                    network=topup.network,
                    tx_hash=topup.tx_hash,
                    confirmed_at=topup.confirmed_at,
                )
    except Exception:
        pass
    return topup


def process_topup(topup: TopUpTransaction) -> TopUpTransaction:
    if topup.is_dead_letter:
        return topup
    if topup.status == "confirmed":
        topup.verification_status = "done"
        db.session.commit()
        return topup

    created_at = topup.created_at or datetime.utcnow()
    processing_deadline = created_at + timedelta(hours=max(TOPUP_MAX_PROCESSING_HOURS, 1))
    if datetime.utcnow() >= processing_deadline:
        topup.status = "rejected"
        topup.verification_status = "failed"
        topup.is_dead_letter = True
        topup.last_error_code = "TOPUP_TIMEOUT_72H"
        topup.provider_note = f"Top-up was not confirmed within {TOPUP_MAX_PROCESSING_HOURS} hours"
        topup.next_retry_at = None
        topup.last_checked_at = datetime.utcnow()
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
        if topup.last_error_code == "TOPUP_EXPIRED":
            topup.status = "rejected"
            topup.is_dead_letter = True
            topup.next_retry_at = None
            db.session.commit()
            return topup
        attempt = int(topup.verification_attempts or 1)
        delay_seconds = min(300, 2 ** min(attempt, 8))
        topup.next_retry_at = datetime.utcnow() + timedelta(seconds=delay_seconds)
        transient_provider_errors = {"PROVIDER_REQUEST_FAILED", "PROVIDER_HTTP_ERROR", "PROVIDER_RATE_LIMIT"}
        if attempt >= max_attempts and topup.last_error_code not in transient_provider_errors:
            topup.is_dead_letter = True
        elif topup.last_error_code in transient_provider_errors:
            topup.is_dead_letter = False
            topup.next_retry_at = datetime.utcnow() + timedelta(seconds=300)
        db.session.commit()
    return topup
