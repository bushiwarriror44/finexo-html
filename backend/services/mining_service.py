from datetime import datetime, timedelta
from decimal import Decimal

from models import MiningAccrual, MiningContract, MiningPlan, UserBalanceLedger, db
from services.audit_service import write_audit


def _balance_breakdown_usdt(user_id: int) -> tuple[Decimal, Decimal]:
    rows = UserBalanceLedger.query.filter_by(user_id=user_id, asset="USDT", network="USDT").all()
    total = Decimal("0")
    held = Decimal("0")
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
    if held < 0:
        held = Decimal("0")
    return total, held


def get_available_usdt(user_id: int) -> Decimal:
    total, held = _balance_breakdown_usdt(user_id)
    return total - held


def create_contract_from_plan(user_id: int, plan: MiningPlan) -> MiningContract:
    available = get_available_usdt(user_id)
    price = Decimal(str(plan.price_usdt))
    if available < price:
        raise ValueError("insufficient USDT balance")
    if not plan.is_active:
        raise ValueError("plan is inactive")
    now = datetime.utcnow()
    contract = MiningContract(
        user_id=user_id,
        plan_id=plan.id,
        strategy=plan.strategy,
        hashrate_value=plan.hashrate_value,
        hashrate_unit=plan.hashrate_unit,
        duration_days=plan.duration_days,
        invested_usdt=plan.price_usdt,
        started_at=now,
        ends_at=now + timedelta(days=int(plan.duration_days)),
        status="active",
    )
    db.session.add(contract)
    db.session.flush()
    db.session.add(
        UserBalanceLedger(
            user_id=user_id,
            amount=plan.price_usdt,
            entry_type="debit",
            reason=f"Mining plan purchase #{plan.id}",
            asset="USDT",
            network="USDT",
        )
    )
    db.session.commit()
    write_audit("user", user_id, "mining_contract_create", f"contract_id={contract.id}; plan_id={plan.id}")
    return contract


def get_mining_summary(user_id: int) -> dict:
    contracts = MiningContract.query.filter_by(user_id=user_id).all()
    contract_ids = [item.id for item in contracts]
    accruals = []
    if contract_ids:
        accruals = MiningAccrual.query.filter(MiningAccrual.contract_id.in_(contract_ids)).all()
    invested = sum(float(item.invested_usdt) for item in contracts)
    earned = sum(float(item.net_usdt) for item in accruals)
    hashrate = sum(float(item.hashrate_value) for item in contracts if item.status == "active")
    active = sum(1 for item in contracts if item.status == "active")
    return {
        "activeContracts": active,
        "totalInvestedUsdt": round(invested, 8),
        "totalEarnedUsdt": round(earned, 8),
        "activeHashrateValue": round(hashrate, 8),
    }
