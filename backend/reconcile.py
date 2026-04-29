from app import app
from models import TopUpTransaction
from services.wallet_verifier import process_topup


def run_reconciliation(limit: int = 100):
    with app.app_context():
        rows = (
            TopUpTransaction.query.filter_by(status="confirmed")
            .order_by(TopUpTransaction.confirmed_at.desc())
            .limit(limit)
            .all()
        )
        for row in rows:
            process_topup(row)
        return len(rows)


if __name__ == "__main__":
    count = run_reconciliation()
    print(f"Reconciled rows: {count}")
