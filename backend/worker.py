import os
import time
from datetime import datetime, timedelta

from app import app
from models import TopUpTransaction
from services.mining_engine import run_hourly_mining_accruals, run_hourly_staking_accruals
from services.wallet_verifier import process_topup


POLL_SECONDS = int(os.getenv("TOPUP_WORKER_POLL_SECONDS", "15"))
RUNNING_TIMEOUT_SECONDS = int(os.getenv("TOPUP_RUNNING_TIMEOUT_SECONDS", "180"))
MINING_ACCRUALS_ENABLED = os.getenv("MINING_ACCRUALS_ENABLED", "true").lower() == "true"


def run_once():
    with app.app_context():
        now = datetime.utcnow()
        running_timeout = now - timedelta(seconds=RUNNING_TIMEOUT_SECONDS)
        stale_running = (
            TopUpTransaction.query.filter(
                TopUpTransaction.verification_status == "running",
                TopUpTransaction.verification_started_at.isnot(None),
                TopUpTransaction.verification_started_at < running_timeout,
                TopUpTransaction.is_dead_letter.is_(False),
            )
            .all()
        )
        for row in stale_running:
            row.verification_status = "queued"
            row.provider_note = "Requeued after worker timeout"
            row.next_retry_at = now

        pending = (
            TopUpTransaction.query.filter(
                TopUpTransaction.verification_status.in_(["queued", "failed"]),
                TopUpTransaction.is_dead_letter.is_(False),
            )
            .order_by(TopUpTransaction.created_at.asc())
            .limit(25)
            .all()
        )
        processable = []
        for row in pending:
            if row.next_retry_at and row.next_retry_at > now:
                continue
            processable.append(row)

        for row in processable:
            process_topup(row)
        mining_count = 0
        if MINING_ACCRUALS_ENABLED:
            mining_count = run_hourly_mining_accruals(now)
            mining_count += run_hourly_staking_accruals(now)
        return len(processable) + mining_count


def run_forever():
    while True:
        count = run_once()
        if count == 0:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    mode = os.getenv("WORKER_MODE", "loop")
    if mode == "once":
        run_once()
    else:
        run_forever()
