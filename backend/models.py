from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
from sqlalchemy import UniqueConstraint
from sqlalchemy import Numeric
from sqlalchemy import text
from werkzeug.security import generate_password_hash
from services.credential_crypto import decrypt_secret, encrypt_secret

db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    first_name = db.Column(db.String(120), nullable=True)
    last_name = db.Column(db.String(120), nullable=True)
    country_code = db.Column(db.String(2), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    is_admin = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class PasswordResetToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    token_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    consumed = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class UserSecurityProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    two_factor_enabled = db.Column(db.Boolean, nullable=False, default=False)
    two_factor_secret = db.Column(db.String(128), nullable=True)
    step_up_required = db.Column(db.Boolean, nullable=False, default=False)
    trusted_devices_only = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserTrustedDevice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    device_label = db.Column(db.String(120), nullable=False)
    device_fingerprint = db.Column(db.String(128), nullable=False, index=True)
    last_seen_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "device_fingerprint", name="uq_user_trusted_device"),)


class UserSessionRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    session_token = db.Column(db.String(128), nullable=False, unique=True, index=True)
    device_fingerprint = db.Column(db.String(128), nullable=True, index=True)
    ip_address = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    is_revoked = db.Column(db.Boolean, nullable=False, default=False, index=True)
    last_seen_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class WalletAddress(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    asset = db.Column(db.String(20), nullable=False, index=True)  # USDT, USDC, BTC, ETH
    network = db.Column(db.String(20), nullable=False, index=True)  # TRX, ERC20, BEP20, BTC, ETH
    address = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("asset", "network", "address", name="uq_wallet_asset_network_address"),)


class TopUpTransaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    wallet_id = db.Column(db.Integer, db.ForeignKey("wallet_address.id"), nullable=False, index=True)
    asset = db.Column(db.String(20), nullable=False)
    network = db.Column(db.String(20), nullable=False)
    tx_hash = db.Column(db.String(255), nullable=False, unique=True, index=True)
    amount = db.Column(Numeric(24, 8), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending/confirmed/rejected
    provider_note = db.Column(db.Text, nullable=True)
    verification_status = db.Column(db.String(20), nullable=False, default="queued")  # queued/running/done/failed
    verification_attempts = db.Column(db.Integer, nullable=False, default=0)
    verification_started_at = db.Column(db.DateTime, nullable=True)
    last_checked_at = db.Column(db.DateTime, nullable=True)
    next_retry_at = db.Column(db.DateTime, nullable=True)
    last_error_code = db.Column(db.String(64), nullable=True)
    is_dead_letter = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    confirmed_at = db.Column(db.DateTime, nullable=True)


class UserBalanceLedger(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    topup_id = db.Column(db.Integer, db.ForeignKey("top_up_transaction.id"), nullable=True)
    withdrawal_id = db.Column(db.Integer, db.ForeignKey("withdrawal_request.id"), nullable=True, index=True)
    amount = db.Column(Numeric(24, 8), nullable=False)
    entry_type = db.Column(db.String(32), nullable=False)  # credit/debit/withdrawal_hold/withdrawal_release/withdrawal_finalize
    reason = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    asset = db.Column(db.String(20), nullable=True)
    network = db.Column(db.String(20), nullable=True)

    __table_args__ = (
        UniqueConstraint("topup_id", "entry_type", name="uq_ledger_topup_entry_type"),
        UniqueConstraint("withdrawal_id", "entry_type", name="uq_ledger_withdrawal_entry_type"),
    )


class ApiCredential(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    provider = db.Column(db.String(50), nullable=False, unique=True, index=True)  # tron/evm/btc
    api_url = db.Column(db.String(500), nullable=True)
    api_key_plain = db.Column(db.String(500), nullable=True)
    api_key_encrypted = db.Column(db.Text, nullable=True)
    version = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def set_api_key(self, value: str) -> None:
        value = (value or "").strip()
        self.api_key_encrypted = encrypt_secret(value) if value else None
        # Keep old column empty to avoid storing plaintext.
        self.api_key_plain = None

    def get_api_key(self) -> str:
        if self.api_key_encrypted:
            return decrypt_secret(self.api_key_encrypted)
        # one-time fallback for old records
        return self.api_key_plain or ""


class ApiCredentialVersion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    credential_id = db.Column(db.Integer, db.ForeignKey("api_credential.id"), nullable=False, index=True)
    provider = db.Column(db.String(50), nullable=False, index=True)
    version = db.Column(db.Integer, nullable=False)
    api_key_encrypted = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    actor_type = db.Column(db.String(30), nullable=False)  # admin/user/system
    actor_id = db.Column(db.Integer, nullable=True)
    event = db.Column(db.String(100), nullable=False, index=True)
    details = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class ReferralCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    code = db.Column(db.String(64), nullable=False, unique=True, index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReferralRelation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    inviter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    invitee_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    level = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class ReferralRule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    level1_percent = db.Column(Numeric(8, 4), nullable=False, default=5)
    level2_percent = db.Column(Numeric(8, 4), nullable=False, default=2)
    level3_percent = db.Column(Numeric(8, 4), nullable=False, default=1)
    min_event_amount = db.Column(Numeric(24, 8), nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReferralPayout(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    inviter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    invitee_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    rule_id = db.Column(db.Integer, db.ForeignKey("referral_rule.id"), nullable=True, index=True)
    topup_id = db.Column(db.Integer, db.ForeignKey("top_up_transaction.id"), nullable=True, index=True)
    level = db.Column(db.Integer, nullable=False)
    percentage = db.Column(Numeric(8, 4), nullable=False)
    base_amount = db.Column(Numeric(24, 8), nullable=False)
    payout_amount = db.Column(Numeric(24, 8), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="credited")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("topup_id", "inviter_id", "level", name="uq_referral_topup_inviter_level"),
    )


class KycProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    status = db.Column(db.String(20), nullable=False, default="not_started")
    country = db.Column(db.String(8), nullable=True)
    verification_requested = db.Column(db.Boolean, nullable=False, default=False)
    review_note = db.Column(db.Text, nullable=True)
    reviewed_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class KycDocument(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("kyc_profile.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    doc_type = db.Column(db.String(50), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    file_hash = db.Column(db.String(128), nullable=True, index=True)
    mime_type = db.Column(db.String(120), nullable=True)
    size_bytes = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class KycReview(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("kyc_profile.id"), nullable=False, index=True)
    reviewer_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    decision = db.Column(db.String(20), nullable=False)
    reason = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class DashboardNotification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    event_type = db.Column(db.String(50), nullable=False, index=True)
    category = db.Column(db.String(30), nullable=False, index=True)
    priority = db.Column(db.String(20), nullable=False, default="medium", index=True)
    title = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=True)
    deep_link = db.Column(db.String(255), nullable=True)
    external_ref = db.Column(db.String(120), nullable=True, index=True)
    is_read = db.Column(db.Boolean, nullable=False, default=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "event_type", "external_ref", name="uq_dashboard_notification_ref"),)


class DashboardFilterPreset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    scope = db.Column(db.String(50), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    payload_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class SupportTicket(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    assignee_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    subject = db.Column(db.String(255), nullable=False)
    priority = db.Column(db.String(20), nullable=False, default="medium")
    status = db.Column(db.String(20), nullable=False, default="open")
    first_response_due_at = db.Column(db.DateTime, nullable=True)
    resolution_due_at = db.Column(db.DateTime, nullable=True)
    first_responded_at = db.Column(db.DateTime, nullable=True)
    resolved_at = db.Column(db.DateTime, nullable=True)
    sla_state = db.Column(db.String(20), nullable=False, default="on_track")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SupportMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    sender_type = db.Column(db.String(20), nullable=False)
    sender_id = db.Column(db.Integer, nullable=True, index=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class SupportSlaRule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    priority = db.Column(db.String(20), nullable=False, unique=True, index=True)
    first_response_minutes = db.Column(db.Integer, nullable=False)
    resolution_minutes = db.Column(db.Integer, nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SupportEventLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    actor_type = db.Column(db.String(20), nullable=False)
    actor_id = db.Column(db.Integer, nullable=True)
    event = db.Column(db.String(80), nullable=False)
    details = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class WithdrawalRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    asset = db.Column(db.String(20), nullable=False, index=True)
    network = db.Column(db.String(20), nullable=False, index=True)
    address = db.Column(db.String(255), nullable=False)
    memo = db.Column(db.String(255), nullable=True)
    amount = db.Column(Numeric(24, 8), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")
    admin_note = db.Column(db.Text, nullable=True)
    external_tx_hash = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)


class WithdrawalEventLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    withdrawal_id = db.Column(db.Integer, db.ForeignKey("withdrawal_request.id"), nullable=False, index=True)
    actor_type = db.Column(db.String(20), nullable=False)
    actor_id = db.Column(db.Integer, nullable=True)
    event = db.Column(db.String(50), nullable=False)
    details = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MiningPlan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    strategy = db.Column(db.String(50), nullable=False, index=True)
    hashrate_value = db.Column(Numeric(24, 8), nullable=False)
    hashrate_unit = db.Column(db.String(20), nullable=False)
    duration_days = db.Column(db.Integer, nullable=False)
    price_usdt = db.Column(Numeric(24, 8), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    is_preset = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MiningContract(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("mining_plan.id"), nullable=False, index=True)
    strategy = db.Column(db.String(50), nullable=False, index=True)
    hashrate_value = db.Column(Numeric(24, 8), nullable=False)
    hashrate_unit = db.Column(db.String(20), nullable=False)
    duration_days = db.Column(db.Integer, nullable=False)
    invested_usdt = db.Column(Numeric(24, 8), nullable=False)
    started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    ends_at = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="active")  # active/completed/cancelled
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MiningAccrual(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    contract_id = db.Column(db.Integer, db.ForeignKey("mining_contract.id"), nullable=False, index=True)
    accrual_date = db.Column(db.Date, nullable=False, index=True)
    accrual_at = db.Column(db.DateTime, nullable=False, index=True, default=datetime.utcnow)
    gross_usdt = db.Column(Numeric(24, 8), nullable=False)
    net_usdt = db.Column(Numeric(24, 8), nullable=False)
    formula_snapshot = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="done")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("contract_id", "accrual_at", name="uq_mining_accrual_contract_hour"),)


class StakingTier(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    asset = db.Column(db.String(20), nullable=False, default="USDT", index=True)
    min_amount = db.Column(Numeric(24, 8), nullable=False)
    max_amount = db.Column(Numeric(24, 8), nullable=False)
    daily_rate = db.Column(Numeric(12, 8), nullable=False)
    is_hot_offer = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("asset", "min_amount", "max_amount", name="uq_staking_tier_range"),
    )


class UserStakingPosition(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    tier_id = db.Column(db.Integer, db.ForeignKey("staking_tier.id"), nullable=False, index=True)
    amount = db.Column(Numeric(24, 8), nullable=False)
    locked_daily_rate = db.Column(Numeric(12, 8), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="active", index=True)
    lock_until = db.Column(db.DateTime, nullable=True, index=True)
    released_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_accrual_at = db.Column(db.DateTime, nullable=True)


class StakingAccrual(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    position_id = db.Column(db.Integer, db.ForeignKey("user_staking_position.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    amount = db.Column(Numeric(24, 8), nullable=False)
    accrual_at = db.Column(db.DateTime, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("position_id", "accrual_at", name="uq_staking_accrual_position_hour"),
    )


class PaymentConversionRate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(50), nullable=False, default="coingecko")
    base_asset = db.Column(db.String(20), nullable=False, index=True)
    quote_asset = db.Column(db.String(20), nullable=False, default="USDT")
    rate = db.Column(Numeric(24, 8), nullable=False)
    original_amount = db.Column(Numeric(24, 8), nullable=True)
    converted_amount = db.Column(Numeric(24, 8), nullable=True)
    topup_id = db.Column(db.Integer, db.ForeignKey("top_up_transaction.id"), nullable=True, index=True)
    contract_id = db.Column(db.Integer, db.ForeignKey("mining_contract.id"), nullable=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MiningStrategyParam(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    strategy = db.Column(db.String(50), nullable=False, unique=True, index=True)
    base_yield_per_hash_per_day = db.Column(Numeric(24, 12), nullable=False)
    difficulty_factor = db.Column(Numeric(12, 6), nullable=False, default=1)
    price_factor = db.Column(Numeric(12, 6), nullable=False, default=1)
    fee_factor = db.Column(Numeric(12, 6), nullable=False, default=0.03)
    volatility_band = db.Column(Numeric(12, 6), nullable=False, default=0.1)
    uptime_factor = db.Column(Numeric(12, 6), nullable=False, default=1)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SiteIcon(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    icon_path = db.Column(db.String(500), nullable=False)


class Link(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(200), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    icon = db.Column(db.String(500), nullable=False)
    order = db.Column(db.Integer, nullable=False, default=0)


class WorkCard(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    icon = db.Column(db.String(500), nullable=False)
    text = db.Column(db.Text, nullable=False)
    link = db.Column(db.String(500), nullable=False)
    order = db.Column(db.Integer, nullable=False, default=0)


class CalculatorSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    courier_products = db.Column(db.Text, nullable=False)
    cities = db.Column(db.Text, nullable=False)
    warehouse_price_per_deposit = db.Column(db.Float, nullable=False)
    warehouse_price_prikop = db.Column(db.Float, nullable=False)
    warehouse_price_magnet = db.Column(db.Float, nullable=False)
    weeks_per_month = db.Column(db.Float, nullable=False, default=4.33)
    packing_bonus = db.Column(db.Float, nullable=False, default=1100.0)
    chemist_kg_price = db.Column(db.Float, nullable=True)
    carrier_with_weight_price_per_step = db.Column(db.Float, nullable=True)
    carrier_without_weight_price_per_step = db.Column(db.Float, nullable=True)


class ChatBotSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    openai_token = db.Column(db.String(500), nullable=True)
    preset = db.Column(db.Text, nullable=True)


class UmamiSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    api_key = db.Column(db.String(500), nullable=True)
    website_id = db.Column(db.String(100), nullable=True)


class SupportRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.Text, nullable=False)
    contact_method = db.Column(db.String(300), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="new")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class TeamApplication(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255), nullable=False, index=True)
    role = db.Column(db.String(255), nullable=False)
    experience = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="new")
    email_delivery_status = db.Column(db.String(20), nullable=False, default="sent")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ContactInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), nullable=True)
    telegram = db.Column(db.String(255), nullable=True)
    partners_email = db.Column(db.String(255), nullable=True)
    extra = db.Column(db.Text, nullable=True)
    email_icon = db.Column(db.String(512), nullable=True)
    telegram_icon = db.Column(db.String(512), nullable=True)
    partners_icon = db.Column(db.String(512), nullable=True)


class ContactCard(db.Model):
    """Карточка контакта на лендинге: заголовок, текст, иконка, ссылка (всё настраивается в админке)."""

    id = db.Column(db.Integer, primary_key=True)
    order = db.Column(db.Integer, nullable=False, default=0)
    label = db.Column(db.String(255), nullable=False)
    value = db.Column(db.String(500), nullable=True)
    icon = db.Column(db.String(512), nullable=True)
    link = db.Column(db.String(1024), nullable=True)
    show_notification = db.Column(db.Boolean, nullable=False, default=False)
    notification_text = db.Column(db.Text, nullable=True)


class CtaSection(db.Model):
    """Секция CTA перед футером: заголовок, текст кнопки, ссылка кнопки, опционально изображение."""

    id = db.Column(db.Integer, primary_key=True)
    heading = db.Column(db.String(500), nullable=False)
    button_text = db.Column(db.String(255), nullable=False)
    button_link = db.Column(db.String(1024), nullable=True)
    image_path = db.Column(db.String(512), nullable=True)


class CareerCtaSection(db.Model):
    """Блок CTA после Контактов: заголовок, описание, кнопка со ссылкой (редактируется в админке)."""

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(500), nullable=False)
    description = db.Column(db.Text, nullable=False)
    button_text = db.Column(db.String(255), nullable=False)
    button_link = db.Column(db.String(1024), nullable=True)


class AboutItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=False)
    order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


def init_work_cards():
    if WorkCard.query.count() == 0:
        default_cards = [
            WorkCard(
                title="Курьер",
                icon="/assets/img/icons/courier-ico.svg",
                text="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took.",
                link=".",
                order=0,
            ),
            WorkCard(
                title="Xимик",
                icon="/assets/img/icons/chemie-ico.svg",
                text="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took.",
                link=".",
                order=1,
            ),
            WorkCard(
                title="Склад",
                icon="/assets/img/icons/sklad-ico.svg",
                text="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took.",
                link=".",
                order=2,
            ),
        ]
        for card in default_cards:
            db.session.add(card)
        db.session.commit()


def init_calculator_settings():
    from sqlalchemy import text

    for col, default in [
        ("chemist_kg_price", 120000.0),
        ("carrier_with_weight_price_per_step", 100000.0),
        ("carrier_without_weight_price_per_step", 2000.0),
    ]:
        try:
            db.session.execute(
                text(
                    f"ALTER TABLE calculator_settings ADD COLUMN {col} REAL DEFAULT {default}"
                )
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
    if CalculatorSettings.query.count() == 0:
        import json

        default_cities = [
            {
                "name": "Москва",
                "products": [
                    {"name": "Яблоки", "price": 900},
                    {"name": "Груши", "price": 900},
                    {"name": "Апельсины", "price": 900},
                ],
            }
        ]
        default_price = 4225.0
        default_settings = CalculatorSettings(
            courier_products=json.dumps([], ensure_ascii=False),
            cities=json.dumps(default_cities, ensure_ascii=False),
            warehouse_price_per_deposit=default_price,
            warehouse_price_prikop=default_price,
            warehouse_price_magnet=default_price,
            weeks_per_month=4.33,
            packing_bonus=1100.0,
            chemist_kg_price=120000.0,
            carrier_with_weight_price_per_step=100000.0,
            carrier_without_weight_price_per_step=2000.0,
        )
        db.session.add(default_settings)
        db.session.commit()


def init_links():
    if Link.query.count() == 0:
        default_links = [
            Link(
                text="Rutor",
                url="https://example.com",
                icon="/assets/img/icons/rutor-ico.svg",
                order=0,
            ),
            Link(
                text="Telegram",
                url="https://example.com",
                icon="/assets/img/icons/telegram-ico.svg",
                order=1,
            ),
            Link(
                text="Магазин",
                url="https://example.com",
                icon="/assets/img/icons/shop-ico.svg",
                order=2,
            ),
        ]
        for link in default_links:
            db.session.add(link)
        db.session.commit()


def init_chatbot_settings():
    if ChatBotSettings.query.count() == 0:
        default_settings = ChatBotSettings(openai_token="", preset="")
        db.session.add(default_settings)
        db.session.commit()


def init_umami_settings():
    try:
        if UmamiSettings.query.count() == 0:
            default_settings = UmamiSettings(
                api_key="", website_id="6ea99ce5-33ba-4d44-809a-76f429b7e221"
            )
            db.session.add(default_settings)
            db.session.commit()
    except Exception as e:
        import logging

        logging.getLogger(__name__).warning("init_umami_settings skipped: %s", e)
        db.session.rollback()


def init_contact_info():
    from sqlalchemy import text

    for col in ("email_icon", "telegram_icon", "partners_icon"):
        try:
            db.session.execute(
                text(f"ALTER TABLE contact_info ADD COLUMN {col} VARCHAR(512)")
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
    if ContactInfo.query.count() == 0:
        default_contact = ContactInfo(
            email="hello@cloud-mining-analytics.io",
            telegram="@cloud-mining_team",
            partners_email="partnerships@cloud-mining-analytics.io",
            extra="Укажите здесь дополнительные каналы связи или служебную информацию.",
        )
        db.session.add(default_contact)
        db.session.commit()


def init_contact_card_notification_columns():
    """Миграция: добавляет колонки show_notification и notification_text в contact_card."""
    from sqlalchemy import text

    for col, col_def in [
        ("show_notification", "BOOLEAN DEFAULT 0"),
        ("notification_text", "TEXT"),
    ]:
        try:
            db.session.execute(
                text(f"ALTER TABLE contact_card ADD COLUMN {col} {col_def}")
            )
            db.session.commit()
        except Exception:
            db.session.rollback()


def init_contact_cards():
    """Создаёт карточки контактов: при первом запуске — из ContactInfo или дефолтные."""
    init_contact_card_notification_columns()
    if ContactCard.query.count() > 0:
        return
    contact = ContactInfo.query.first()
    if contact:

        def make_link(val, kind):
            if not val:
                return None
            val = (val or "").strip()
            if kind == "email":
                return f"mailto:{val}" if val else None
            if kind == "telegram":
                u = val.lstrip("@")
                return f"https://t.me/{u}" if u else None
            if kind == "partners":
                return f"mailto:{val}" if val else None
            return None

        for order, (label, value, icon_attr) in enumerate(
            [
                ("Email", contact.email, contact.email_icon),
                ("Telegram", contact.telegram, contact.telegram_icon),
                ("Связь для партнёров", contact.partners_email, contact.partners_icon),
            ]
        ):
            kind = (
                "email"
                if "mail" in label.lower() or "Email" in label
                else ("telegram" if "Telegram" in label else "partners")
            )
            link = make_link(value, kind)
            db.session.add(
                ContactCard(
                    order=order,
                    label=label or "",
                    value=value or "",
                    icon=icon_attr,
                    link=link,
                )
            )
    else:
        for order, (label, value, link) in enumerate(
            [
                (
                    "Email",
                    "hello@cloud-mining-analytics.io",
                    "mailto:hello@cloud-mining-analytics.io",
                ),
                ("Telegram", "@cloud-mining_team", "https://t.me/cloud-mining_team"),
                (
                    "Связь для партнёров",
                    "partnerships@cloud-mining-analytics.io",
                    "mailto:partnerships@cloud-mining-analytics.io",
                ),
            ]
        ):
            db.session.add(
                ContactCard(order=order, label=label, value=value, link=link)
            )
    db.session.commit()


def init_about_items():
    if AboutItem.query.count() == 0:
        default_items = [
            AboutItem(
                order=0,
                title="Стабильно работаем с 2020-го года",
                description="За несколько лет мы выстроили устойчивые процессы, обкатали десятки гипотез и довели продукт до состояния, когда он спокойно переживает пики нагрузки без потери качества.",
            ),
            AboutItem(
                order=1,
                title="Полная анонимность",
                description="Мы принципиально не собираем лишние данные о пользователях и сотрудниках, используем анонимную аналитику и минимизируем точки, где могут появиться персональные данные.",
            ),
            AboutItem(
                order=2,
                title="Приоритет на безопасности для сотрудников и покупателей",
                description="Инфраструктура, процессы и регламенты строятся с прицелом на безопасность: от шифрования и раздельного доступа до регулярных проверок и понятных внутренних правил.",
            ),
        ]
        for item in default_items:
            db.session.add(item)
        db.session.commit()


def init_cta_section():
    if CtaSection.query.count() == 0:
        db.session.add(
            CtaSection(
                heading="Присоединйся к нашей алхимической команде!",
                button_text="Присоединиться",
                button_link="#",
            )
        )
        db.session.commit()


def init_career_cta_section():
    if CareerCtaSection.query.count() == 0:
        db.session.add(
            CareerCtaSection(
                title="Начни зарабатывать и профессионально рости вместе с нашей командой",
                description="Рости вместе с нами, зарабатывай больше. Мы ценим твое время и готовы предложить одни из наивысших компенсаций на рынке за твою работу.",
                button_text="Присоединиться",
                button_link="#",
            )
        )
        db.session.commit()


def init_all_models():
    db.create_all()
    # lightweight in-app migration for legacy installations
    try:
        db.session.execute(text("ALTER TABLE api_credential ADD COLUMN api_key_encrypted TEXT"))
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(text("ALTER TABLE api_credential ADD COLUMN version INTEGER DEFAULT 0"))
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text("ALTER TABLE top_up_transaction ADD COLUMN verification_status VARCHAR(20) DEFAULT 'queued'")
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    for sql in [
        "ALTER TABLE user ADD COLUMN first_name VARCHAR(120)",
        "ALTER TABLE user ADD COLUMN last_name VARCHAR(120)",
        "ALTER TABLE user ADD COLUMN country_code VARCHAR(2)",
        "ALTER TABLE top_up_transaction ADD COLUMN verification_attempts INTEGER DEFAULT 0",
        "ALTER TABLE top_up_transaction ADD COLUMN verification_started_at DATETIME",
        "ALTER TABLE top_up_transaction ADD COLUMN last_checked_at DATETIME",
        "ALTER TABLE top_up_transaction ADD COLUMN next_retry_at DATETIME",
        "ALTER TABLE top_up_transaction ADD COLUMN last_error_code VARCHAR(64)",
        "ALTER TABLE top_up_transaction ADD COLUMN is_dead_letter BOOLEAN DEFAULT 0",
        "ALTER TABLE user_balance_ledger ADD COLUMN asset VARCHAR(20)",
        "ALTER TABLE user_balance_ledger ADD COLUMN network VARCHAR(20)",
        "ALTER TABLE user_balance_ledger ADD COLUMN withdrawal_id INTEGER",
        "ALTER TABLE mining_accrual ADD COLUMN accrual_at DATETIME",
        "ALTER TABLE kyc_profile ADD COLUMN verification_requested BOOLEAN DEFAULT 0",
        "ALTER TABLE dashboard_notification ADD COLUMN deep_link VARCHAR(255)",
        "ALTER TABLE dashboard_notification ADD COLUMN external_ref VARCHAR(120)",
        "ALTER TABLE dashboard_notification ADD COLUMN updated_at DATETIME",
        "ALTER TABLE dashboard_filter_preset ADD COLUMN updated_at DATETIME",
        "ALTER TABLE user_security_profile ADD COLUMN step_up_required BOOLEAN DEFAULT 0",
        "ALTER TABLE user_security_profile ADD COLUMN trusted_devices_only BOOLEAN DEFAULT 0",
        "ALTER TABLE user_session_record ADD COLUMN device_fingerprint VARCHAR(128)",
        "ALTER TABLE user_session_record ADD COLUMN ip_address VARCHAR(64)",
        "ALTER TABLE user_session_record ADD COLUMN user_agent VARCHAR(255)",
        "ALTER TABLE user_session_record ADD COLUMN is_revoked BOOLEAN DEFAULT 0",
        "ALTER TABLE user_session_record ADD COLUMN last_seen_at DATETIME",
        "ALTER TABLE staking_tier ADD COLUMN updated_at DATETIME",
        "ALTER TABLE user_staking_position ADD COLUMN updated_at DATETIME",
        "ALTER TABLE user_staking_position ADD COLUMN last_accrual_at DATETIME",
        "ALTER TABLE user_staking_position ADD COLUMN lock_until DATETIME",
        "ALTER TABLE user_staking_position ADD COLUMN released_at DATETIME",
        "ALTER TABLE user_staking_position ADD COLUMN locked_daily_rate NUMERIC(12,8)",
    ]:
        try:
            db.session.execute(text(sql))
            db.session.commit()
        except Exception:
            db.session.rollback()
    try:
        db.session.execute(
            text(
                "UPDATE user_staking_position SET locked_daily_rate = "
                "(SELECT daily_rate FROM staking_tier WHERE staking_tier.id = user_staking_position.tier_id) "
                "WHERE locked_daily_rate IS NULL"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "UPDATE mining_accrual SET accrual_at = COALESCE(accrual_at, datetime(accrual_date || ' 00:00:00')) "
                "WHERE accrual_at IS NULL"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "UPDATE user_staking_position "
                "SET lock_until = COALESCE(lock_until, datetime(created_at, '+30 days')) "
                "WHERE lock_until IS NULL"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_staking_tier_range "
                "ON staking_tier (asset, min_amount, max_amount)"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_staking_accrual_position_hour "
                "ON staking_accrual (position_id, accrual_at)"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_mining_accrual_contract_hour ON mining_accrual (contract_id, accrual_at)")
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_notification_ref "
                "ON dashboard_notification (user_id, event_type, external_ref)"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
    try:
        db.session.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_trusted_device "
                "ON user_trusted_device (user_id, device_fingerprint)"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()

    credentials = ApiCredential.query.filter(ApiCredential.api_key_plain.isnot(None)).all()
    for item in credentials:
        if item.api_key_plain and not item.api_key_encrypted:
            item.set_api_key(item.api_key_plain)
    if credentials:
        db.session.commit()

    default_tron_provider = "tron"
    default_tron_api_url = os.getenv("DEFAULT_TRON_API_URL", "https://api.trongrid.io")
    default_tron_api_key = os.getenv(
        "DEFAULT_TRON_API_KEY",
        "a4e0fc35-61dc-420f-ae45-259e1be12f5c",
    )
    tron_credential = ApiCredential.query.filter_by(provider=default_tron_provider).first()
    if not tron_credential:
        tron_credential = ApiCredential(
            provider=default_tron_provider,
            api_url=default_tron_api_url,
            is_active=True,
        )
        if default_tron_api_key:
            tron_credential.set_api_key(default_tron_api_key)
            tron_credential.version = 1
            db.session.add(tron_credential)
            db.session.flush()
            db.session.add(
                ApiCredentialVersion(
                    credential_id=tron_credential.id,
                    provider=default_tron_provider,
                    version=tron_credential.version,
                    api_key_encrypted=tron_credential.api_key_encrypted,
                )
            )
        else:
            db.session.add(tron_credential)
        db.session.commit()

    default_wallet_asset = "USDT"
    default_wallet_network = "TRX"
    default_wallet_address = os.getenv(
        "DEFAULT_USDT_TRC20_WALLET",
        "TQq2xFNkcEhAhzVPhY3y1EifaRNgtwthAd",
    )
    existing_default_wallet = WalletAddress.query.filter_by(
        asset=default_wallet_asset,
        network=default_wallet_network,
        address=default_wallet_address,
    ).first()
    if not existing_default_wallet and default_wallet_address:
        db.session.add(
            WalletAddress(
                asset=default_wallet_asset,
                network=default_wallet_network,
                address=default_wallet_address,
                is_active=True,
            )
        )
        db.session.commit()

    if ReferralRule.query.count() == 0:
        db.session.add(
            ReferralRule(
                name="Default referral campaign",
                level1_percent=5,
                level2_percent=2,
                level3_percent=1,
                min_event_amount=0,
                is_active=True,
            )
        )
        db.session.commit()

    if SupportSlaRule.query.count() == 0:
        for priority, first_minutes, resolution_minutes in [
            ("low", 240, 4320),
            ("medium", 120, 1440),
            ("high", 30, 240),
        ]:
            db.session.add(
                SupportSlaRule(
                    priority=priority,
                    first_response_minutes=first_minutes,
                    resolution_minutes=resolution_minutes,
                    is_active=True,
                )
            )
        db.session.commit()

    if MiningPlan.query.count() == 0:
        for row in [
            {
                "name": "BTC Starter 120T",
                "strategy": "btc_sha256",
                "hashrate_value": 120,
                "hashrate_unit": "TH/s",
                "duration_days": 180,
                "price_usdt": 450,
            },
            {
                "name": "LTC+DOGE Hybrid 2.5G",
                "strategy": "ltc_doge_scrypt",
                "hashrate_value": 2.5,
                "hashrate_unit": "GH/s",
                "duration_days": 210,
                "price_usdt": 780,
            },
            {
                "name": "KAS Accel 8T",
                "strategy": "kas_kheavyhash",
                "hashrate_value": 8,
                "hashrate_unit": "TH/s",
                "duration_days": 160,
                "price_usdt": 620,
            },
        ]:
            db.session.add(MiningPlan(is_active=True, is_preset=True, **row))
        db.session.commit()

    if MiningStrategyParam.query.count() == 0:
        defaults = [
            ("btc_sha256", 0.000095, 1, 1, 0.03, 0.12, 0.98),
            ("ltc_doge_scrypt", 0.0000048, 1, 1, 0.03, 0.15, 0.98),
            ("kas_kheavyhash", 0.0000065, 1, 1, 0.035, 0.2, 0.98),
        ]
        for strategy, base_yield, difficulty, price, fee, vol, uptime in defaults:
            db.session.add(
                MiningStrategyParam(
                    strategy=strategy,
                    base_yield_per_hash_per_day=base_yield,
                    difficulty_factor=difficulty,
                    price_factor=price,
                    fee_factor=fee,
                    volatility_band=vol,
                    uptime_factor=uptime,
                    is_active=True,
                )
            )
        db.session.commit()

    if StakingTier.query.count() == 0:
        defaults = [
            {"asset": "USDT", "min_amount": 900, "max_amount": 9900, "daily_rate": 0.01, "is_hot_offer": True, "is_active": True},
            {"asset": "USDT", "min_amount": 10000, "max_amount": 19900, "daily_rate": 0.013, "is_hot_offer": True, "is_active": True},
            {"asset": "USDT", "min_amount": 20000, "max_amount": 29900, "daily_rate": 0.015, "is_hot_offer": True, "is_active": True},
            {"asset": "USDT", "min_amount": 30000, "max_amount": 39990, "daily_rate": 0.016, "is_hot_offer": True, "is_active": True},
        ]
        for row in defaults:
            db.session.add(StakingTier(**row))
        db.session.commit()

    admin_email = os.getenv("ADMIN_EMAIL", "admin@cloudmine.local")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")
    admin_user = User.query.filter_by(email=admin_email).first()
    if not admin_user:
        db.session.add(
            User(
                email=admin_email,
                password_hash=generate_password_hash(admin_password),
                is_active=True,
                is_admin=True,
            )
        )
        db.session.commit()
