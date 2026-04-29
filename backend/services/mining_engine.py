import json
import random
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from models import (
    MiningAccrual,
    MiningContract,
    MiningStrategyParam,
    StakingAccrual,
    StakingTier,
    UserBalanceLedger,
    UserStakingPosition,
    db,
)
from services.audit_service import write_audit


def normalize_hashrate(value, unit: str) -> Decimal:
    value = Decimal(str(value or "0"))
    unit = (unit or "").strip().upper()
    if unit == "TH/S":
        return value
    if unit == "GH/S":
        return value / Decimal("1000")
    if unit == "MH/S":
        return value / Decimal("1000000")
    if unit == "PH/S":
        return value * Decimal("1000")
    return value


def calculate_daily_payout(contract: MiningContract, strategy_params: MiningStrategyParam, seed: Optional[int] = None) -> dict:
    if seed is not None:
        random.seed(seed)
    hashrate_norm = normalize_hashrate(contract.hashrate_value, contract.hashrate_unit)
    base = Decimal(str(strategy_params.base_yield_per_hash_per_day or 0))
    difficulty_adj = Decimal(str(strategy_params.difficulty_factor or 1))
    price_adj = Decimal(str(strategy_params.price_factor or 1))
    fee = Decimal(str(strategy_params.fee_factor or 0))
    uptime = Decimal(str(strategy_params.uptime_factor or 1))
    vol = Decimal(str(strategy_params.volatility_band or 0))
    drift = Decimal(str(random.uniform(float(-vol), float(vol))))
    gross = hashrate_norm * base * difficulty_adj * price_adj * uptime * (Decimal("1") + drift)
    if gross < 0:
        gross = Decimal("0")
    net = gross * (Decimal("1") - fee)
    snapshot = {
        "hashrateNormTHs": float(hashrate_norm),
        "baseYieldPerHashPerDay": float(base),
        "difficultyAdj": float(difficulty_adj),
        "priceAdj": float(price_adj),
        "uptime": float(uptime),
        "volatilityApplied": float(drift),
        "feeFactor": float(fee),
    }
    return {"gross": gross, "net": net, "snapshot": snapshot}


def run_hourly_mining_accruals(now: Optional[datetime] = None) -> int:
    now = now or datetime.utcnow()
    slot = now.replace(minute=0, second=0, microsecond=0)
    today = date(year=now.year, month=now.month, day=now.day)
    contracts = (
        MiningContract.query.filter(
            MiningContract.status == "active",
            MiningContract.started_at <= now,
            MiningContract.ends_at >= now,
        )
        .order_by(MiningContract.created_at.asc())
        .all()
    )
    count = 0
    for contract in contracts:
        exists = MiningAccrual.query.filter_by(contract_id=contract.id, accrual_at=slot).first()
        if exists:
            continue
        params = MiningStrategyParam.query.filter_by(strategy=contract.strategy, is_active=True).first()
        if not params:
            continue
        calc = calculate_daily_payout(contract, params, seed=contract.id + int(now.timestamp()) // 86400)
        hourly_gross = Decimal(str(calc["gross"])) / Decimal("24")
        hourly_net = Decimal(str(calc["net"])) / Decimal("24")
        accrual = MiningAccrual(
            contract_id=contract.id,
            accrual_date=today,
            accrual_at=slot,
            gross_usdt=hourly_gross,
            net_usdt=hourly_net,
            formula_snapshot=json.dumps(calc["snapshot"]),
            status="done",
        )
        db.session.add(accrual)
        db.session.flush()
        db.session.add(
            UserBalanceLedger(
                user_id=contract.user_id,
                amount=hourly_net,
                entry_type="credit",
                reason=f"Mining accrual contract #{contract.id} {slot.isoformat()}",
                asset="USDT",
                network="USDT",
            )
        )
        if now + timedelta(days=1) > contract.ends_at:
            contract.status = "completed"
        db.session.commit()
        write_audit("system", None, "mining_accrual", f"contract_id={contract.id}; slot={slot.isoformat()}; net={float(hourly_net)}")
        count += 1
    return count


def run_daily_mining_accruals(now: Optional[datetime] = None) -> int:
    # Backward-compatible alias used by legacy callers/tests.
    return run_hourly_mining_accruals(now)


def run_hourly_staking_accruals(now: Optional[datetime] = None) -> int:
    now = now or datetime.utcnow()
    slot = now.replace(minute=0, second=0, microsecond=0)
    positions = (
        UserStakingPosition.query.filter(UserStakingPosition.status == "active")
        .order_by(UserStakingPosition.created_at.asc())
        .all()
    )
    count = 0
    for position in positions:
        exists = StakingAccrual.query.filter_by(position_id=position.id, accrual_at=slot).first()
        if exists:
            continue
        tier = StakingTier.query.get(position.tier_id)
        if not tier or not tier.is_active:
            continue
        hourly_amount = (Decimal(str(position.amount)) * Decimal(str(tier.daily_rate or 0))) / Decimal("24")
        if hourly_amount <= 0:
            continue
        accrual = StakingAccrual(
            position_id=position.id,
            user_id=position.user_id,
            amount=hourly_amount,
            accrual_at=slot,
        )
        db.session.add(accrual)
        db.session.add(
            UserBalanceLedger(
                user_id=position.user_id,
                amount=hourly_amount,
                entry_type="credit",
                reason=f"Staking accrual position #{position.id} {slot.isoformat()}",
                asset="USDT",
                network="USDT",
            )
        )
        position.last_accrual_at = slot
        db.session.commit()
        write_audit(
            "system",
            None,
            "staking_accrual",
            f"position_id={position.id}; slot={slot.isoformat()}; amount={float(hourly_amount)}",
        )
        count += 1
    return count
