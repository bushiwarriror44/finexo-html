import logging
import os
from functools import wraps

from flask import (
    Blueprint,
    abort,
    make_response,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

from models import (
    ApiCredential,
    KycProfile,
    MiningPlan,
    MiningStrategyParam,
    ReferralRule,
    SupportTicket,
    TeamApplication,
    TopUpTransaction,
    User,
    UserBalanceLedger,
    WalletAddress,
    WithdrawalRequest,
    db,
)
from services.audit_service import write_audit
from services.security import verify_password
from services.withdrawal_service import MANUAL_CREDIT_REASON_PREFIX

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_STATIC_DIR = os.path.join(BASE_DIR, "views", "src")
admin_bp = Blueprint("admin", __name__)
security_logger = logging.getLogger("security")


def is_logged_in():
    admin_id = session.get("admin_user_id")
    if not admin_id:
        return False
    admin = User.query.get(admin_id)
    return bool(admin and admin.is_admin and admin.is_active)


def require_login(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("admin.admin_login"))
        return f(*args, **kwargs)

    return decorated_function


@admin_bp.route("/admin")
@admin_bp.route("/admin/")
def admin_redirect():
    return redirect(url_for("admin.admin_panel"))


@admin_bp.route("/admin-static/<path:filename>")
def admin_static(filename):
    safe_path = os.path.normpath(filename or "")
    if safe_path.startswith("..") or os.path.isabs(safe_path):
        abort(404)
    return send_from_directory(ADMIN_STATIC_DIR, safe_path)


@admin_bp.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if is_logged_in():
        return redirect(url_for("admin.admin_panel"))

    error = None
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        client_ip = request.remote_addr

        admin = User.query.filter_by(email=email, is_admin=True, is_active=True).first() if email else None
        valid_admin = bool(admin and verify_password(admin.password_hash, password))
        if valid_admin:
            session.clear()
            session["admin_user_id"] = admin.id
            write_audit("admin", admin.id, "admin_login", f"ip={client_ip}")
            session.permanent = True
            security_logger.info("Successful admin login from IP: %s", client_ip)
            return redirect(url_for("admin.admin_panel"))

        security_logger.warning("Failed admin login attempt from IP: %s", client_ip)
        error = "Неверный пароль"

    return render_template("admin_login.html", error=error)


@admin_bp.route("/admin/panel")
@require_login
def admin_panel():
    wallets = WalletAddress.query.order_by(WalletAddress.asset.asc(), WalletAddress.network.asc()).all()
    credentials = ApiCredential.query.order_by(ApiCredential.provider.asc()).all()
    topups = TopUpTransaction.query.order_by(TopUpTransaction.created_at.desc()).limit(100).all()
    referral_rules = ReferralRule.query.order_by(ReferralRule.updated_at.desc()).limit(20).all()
    kyc_queue = KycProfile.query.order_by(KycProfile.updated_at.desc()).limit(50).all()
    support_tickets = SupportTicket.query.order_by(SupportTicket.updated_at.desc()).limit(100).all()
    withdrawals = WithdrawalRequest.query.order_by(WithdrawalRequest.created_at.desc()).limit(100).all()
    withdrawal_user_ids = {row.user_id for row in withdrawals}
    purchase_only_by_user = {}
    if withdrawal_user_ids:
        ledger_rows = UserBalanceLedger.query.filter(
            UserBalanceLedger.user_id.in_(withdrawal_user_ids),
            UserBalanceLedger.asset == "USDT",
            UserBalanceLedger.network == "USDT",
            UserBalanceLedger.entry_type == "credit",
        ).all()
        for item in ledger_rows:
            if not str(item.reason or "").startswith(MANUAL_CREDIT_REASON_PREFIX):
                continue
            purchase_only_by_user[item.user_id] = purchase_only_by_user.get(item.user_id, 0.0) + float(item.amount)

    for row in withdrawals:
        row.user_purchase_only_usdt = round(purchase_only_by_user.get(row.user_id, 0.0), 8)
        row.withdraw_source_label = "purchase_only_excluded" if row.user_purchase_only_usdt > 0 else "standard"
    mining_plans = MiningPlan.query.order_by(MiningPlan.price_usdt.asc()).all()
    mining_params = MiningStrategyParam.query.order_by(MiningStrategyParam.strategy.asc()).all()
    team_applications = TeamApplication.query.order_by(TeamApplication.created_at.desc()).limit(100).all()
    response = make_response(
        render_template(
            "admin_panel.html",
            wallets=wallets,
            credentials=credentials,
            topups=topups,
            referral_rules=referral_rules,
            kyc_queue=kyc_queue,
            support_tickets=support_tickets,
            withdrawals=withdrawals,
            mining_plans=mining_plans,
            mining_params=mining_params,
            team_applications=team_applications,
        )
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@admin_bp.route("/admin/logout")
def admin_logout():
    session.pop("admin_user_id", None)
    return redirect(url_for("admin.admin_login"))

