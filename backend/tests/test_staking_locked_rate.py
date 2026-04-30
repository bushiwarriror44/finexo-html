"""Staking accruals must use locked_daily_rate, not the current tier rate."""
import unittest
from datetime import datetime, timedelta
from decimal import Decimal

try:
    from backend.app import app
    from backend.models import StakingAccrual, StakingTier, User, UserStakingPosition, db, init_all_models
    from backend.services.mining_engine import run_hourly_staking_accruals
except ModuleNotFoundError:
    from app import app
    from models import StakingAccrual, StakingTier, User, UserStakingPosition, db, init_all_models
    from services.mining_engine import run_hourly_staking_accruals


class StakingLockedRateTest(unittest.TestCase):
    def test_hourly_accrual_uses_locked_rate_after_tier_change(self):
        app.config["TESTING"] = True
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        with app.app_context():
            db.drop_all()
            db.create_all()
            init_all_models()

            user = User(email="staker@test.local", password_hash="x", is_active=True, is_admin=False)
            db.session.add(user)
            tier = StakingTier(
                asset="USDT",
                min_amount=Decimal("1"),
                max_amount=Decimal("1000000"),
                daily_rate=Decimal("0.01"),
                is_hot_offer=False,
                is_active=True,
            )
            db.session.add(tier)
            db.session.commit()

            lock_until = datetime.utcnow() + timedelta(days=30)
            pos = UserStakingPosition(
                user_id=user.id,
                tier_id=tier.id,
                amount=Decimal("1000"),
                locked_daily_rate=Decimal("0.01"),
                status="active",
                lock_until=lock_until,
            )
            db.session.add(pos)
            db.session.commit()

            tier.daily_rate = Decimal("0.05")
            db.session.commit()

            slot = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
            run_hourly_staking_accruals(slot)

            accrual = StakingAccrual.query.filter_by(position_id=pos.id).first()
            self.assertIsNotNone(accrual)
            # hourly = 1000 * 0.01 / 24
            expected = (Decimal("1000") * Decimal("0.01")) / Decimal("24")
            self.assertEqual(Decimal(str(accrual.amount)).quantize(Decimal("0.00000001")), expected.quantize(Decimal("0.00000001")))


if __name__ == "__main__":
    unittest.main()
