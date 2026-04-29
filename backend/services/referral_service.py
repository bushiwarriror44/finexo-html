import secrets
from decimal import Decimal

from sqlalchemy.exc import IntegrityError

from models import ReferralCode, ReferralPayout, ReferralRelation, ReferralRule, TopUpTransaction, UserBalanceLedger, db
from services.audit_service import write_audit


def ensure_referral_code(user_id: int) -> ReferralCode:
    row = ReferralCode.query.filter_by(user_id=user_id).first()
    if row:
        return row

    for _ in range(10):
        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")
        candidate = ReferralCode(user_id=user_id, code=code[:12], is_active=True)
        db.session.add(candidate)
        try:
            db.session.commit()
            return candidate
        except IntegrityError:
            db.session.rollback()
            continue
    raise RuntimeError("Unable to generate unique referral code")


def attach_referral_chain(invitee_id: int, referral_code: str) -> None:
    code = (referral_code or "").strip()
    if not code:
        return
    if ReferralRelation.query.filter_by(invitee_id=invitee_id).first():
        return

    owner_code = ReferralCode.query.filter_by(code=code, is_active=True).first()
    if not owner_code or owner_code.user_id == invitee_id:
        return

    relations = [ReferralRelation(inviter_id=owner_code.user_id, invitee_id=invitee_id, level=1)]
    parent = owner_code.user_id
    next_level = 2
    while next_level <= 3:
        parent_rel = ReferralRelation.query.filter_by(invitee_id=parent, level=1).first()
        if not parent_rel:
            break
        relations.append(
            ReferralRelation(inviter_id=parent_rel.inviter_id, invitee_id=invitee_id, level=next_level)
        )
        parent = parent_rel.inviter_id
        next_level += 1

    for relation in relations:
        db.session.add(relation)
    db.session.commit()
    write_audit("system", None, "referral_chain_attached", f"invitee_id={invitee_id}; levels={len(relations)}")


def apply_referral_payouts_for_topup(topup: TopUpTransaction) -> None:
    active_rule = ReferralRule.query.filter_by(is_active=True).order_by(ReferralRule.updated_at.desc()).first()
    if not active_rule:
        return

    amount = Decimal(str(topup.amount))
    min_amount = Decimal(str(active_rule.min_event_amount or 0))
    if amount < min_amount:
        return

    relations = (
        ReferralRelation.query.filter(
            ReferralRelation.invitee_id == topup.user_id,
            ReferralRelation.level.in_([1, 2, 3]),
        )
        .order_by(ReferralRelation.level.asc())
        .all()
    )
    if not relations:
        return

    level_map = {
        1: Decimal(str(active_rule.level1_percent or 0)),
        2: Decimal(str(active_rule.level2_percent or 0)),
        3: Decimal(str(active_rule.level3_percent or 0)),
    }

    for relation in relations:
        percent = level_map.get(int(relation.level), Decimal("0"))
        if percent <= 0:
            continue
        payout_amount = (amount * percent) / Decimal("100")
        if payout_amount <= 0:
            continue

        payout = ReferralPayout(
            inviter_id=relation.inviter_id,
            invitee_id=topup.user_id,
            rule_id=active_rule.id,
            topup_id=topup.id,
            level=relation.level,
            percentage=percent,
            base_amount=amount,
            payout_amount=payout_amount,
            status="credited",
        )
        db.session.add(payout)
        db.session.add(
            UserBalanceLedger(
                user_id=relation.inviter_id,
                amount=payout_amount,
                entry_type="credit",
                reason=f"Referral L{relation.level} reward from user #{topup.user_id}",
                topup_id=None,
                asset=topup.asset,
                network=topup.network,
            )
        )
        try:
            db.session.commit()
            write_audit(
                "system",
                None,
                "referral_payout_created",
                f"topup_id={topup.id}; inviter_id={relation.inviter_id}; level={relation.level}; amount={float(payout_amount)}",
            )
        except IntegrityError:
            db.session.rollback()
