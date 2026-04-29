# Backend smoke tests

Run:

- `python -m unittest backend.tests.test_smoke`

Covered smoke scenarios:

- auth: register/login/me
- wallet: list addresses/create top-up
- admin: upsert/list provider credentials
- negative: invalid reset token, replay tx hash, amount mismatch, double-credit guard

Reconciliation:

- `python backend/reconcile.py`

Rollout runbook:

- `docs/phase-rollout-checklist.md`
