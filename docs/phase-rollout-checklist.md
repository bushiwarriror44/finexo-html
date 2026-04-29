# Phase Rollout Checklist (1 to 4)

This runbook defines a low-risk production rollout for `referral`, `support`, and `kyc` domains with clear go/no-go gates and rollback actions.

## 1. Feature Flags Matrix And Production Toggles

### Current toggles already used in code

- `KYC_REQUIRED_COUNTRIES` (used by user KYC policy logic).
- `TOPUP_WORKER_POLL_SECONDS` (worker polling interval).
- `TOPUP_RUNNING_TIMEOUT_SECONDS` (stale-running recovery timeout).

### Recommended rollout flags (add to `.env` and runtime config)

| Phase | Toggle | Default | Staging | Production at phase start | Purpose |
|---|---|---:|---:|---:|---|
| 1 | `FEATURE_REFERRAL` | `false` | `true` | `true` | Enable referral API/UI read flows. |
| 1 | `FEATURE_REFERRAL_PAYOUTS` | `false` | `true` | `false` then `true` | Safely enable payout writes after read validation. |
| 2 | `FEATURE_SUPPORT` | `false` | `true` | `true` | Enable ticketing API/UI. |
| 2 | `FEATURE_SUPPORT_CHAT_POLLING` | `false` | `true` | `true` | Enable polling chat transport. |
| 2 | `FEATURE_SUPPORT_SLA` | `false` | `true` | `true` | Enable SLA state calculations and monitor labels. |
| 3 | `FEATURE_KYC` | `false` | `true` | `true` | Enable KYC domain endpoints/UI blocks. |
| 3 | `FEATURE_KYC_OPTIONAL` | `true` | `true` | `true` | Keep KYC optional unless country policy requires it. |
| 4 | `FEATURE_RATE_LIMIT_STRICT` | `false` | `true` | `false` then `true` | Harden support/KYC endpoint rate controls. |
| 4 | `FEATURE_AUDIT_STRICT` | `false` | `true` | `false` then `true` | Require strict audit coverage for critical admin actions. |

### Production env additions (website and worker)

Add these vars to deployment configuration:

- `FEATURE_REFERRAL`
- `FEATURE_REFERRAL_PAYOUTS`
- `FEATURE_SUPPORT`
- `FEATURE_SUPPORT_CHAT_POLLING`
- `FEATURE_SUPPORT_SLA`
- `FEATURE_KYC`
- `FEATURE_KYC_OPTIONAL`
- `FEATURE_RATE_LIMIT_STRICT`
- `FEATURE_AUDIT_STRICT`

## 2. Migration And Seed Runbook

## Preflight (every phase)

1. Ensure backup snapshot exists for `data/app.db`.
2. Confirm backend container/app starts with expected env.
3. Confirm worker starts and reads shared `data` volume.
4. Run smoke baseline:
   - `cd backend && python -m pytest tests/test_smoke.py`
   - `cd .. && npm run build`

## Database/model migration safety

Project uses in-app initialization (`init_all_models`) and `db.create_all()`. For each phase:

1. Deploy code with feature flags still disabled for new writes.
2. Start backend and verify startup logs for schema initialization errors.
3. Validate seed assumptions:
   - Referral: at least one active `ReferralRule`.
   - Support: SLA rows for `low`, `medium`, `high`.
4. Run read-only verification queries via admin API before enabling writes.

## Rollback strategy by phase

- **Phase 1 rollback**
  - Set `FEATURE_REFERRAL_PAYOUTS=false`.
  - Keep `FEATURE_REFERRAL=true` for read-only referral visibility.
- **Phase 2 rollback**
  - Set `FEATURE_SUPPORT_CHAT_POLLING=false`.
  - Keep `FEATURE_SUPPORT=true` so existing tickets remain accessible.
- **Phase 3 rollback**
  - Set `FEATURE_KYC=false`.
  - Keep KYC data in storage/database; do not delete files/rows.
- **Phase 4 rollback**
  - Set `FEATURE_RATE_LIMIT_STRICT=false` and `FEATURE_AUDIT_STRICT=false`.
  - Preserve baseline logging and security alerts.

## 3. Validation Suite And Go/No-Go Gates

## Automated baseline

- Backend smoke tests:
  - `test_referral_code_and_stats`
  - `test_kyc_submit_and_admin_review`
  - `test_support_ticket_flow`
  - `test_negative_replay_tx_hash`
  - `test_negative_double_credit_guard`
  - `test_negative_amount_mismatch`
- Frontend build check:
  - `npm run build`

## Endpoint validation by phase

### Phase 1 (Referral)

- User:
  - `GET /api/user/referral`
  - `POST /api/user/referral/regenerate`
- Admin:
  - `GET /admin/api/referral/rules`
  - `POST /admin/api/referral/rules`
  - `GET /admin/api/referral/stats`

Go if:

- referral code generation works for new/existing users;
- no duplicate payout writes for same top-up level chain;
- admin can switch active rule without API errors.

### Phase 2 (Support)

- User:
  - `GET /api/user/support/tickets`
  - `POST /api/user/support/tickets`
  - `GET /api/user/support/tickets/<id>/messages`
  - `POST /api/user/support/tickets/<id>/messages`
- Admin:
  - `GET /admin/api/support/tickets`
  - `POST /admin/api/support/tickets/<id>/action`
  - `GET /admin/api/support/sla-rules`

Go if:

- ticket lifecycle open/assign/escalate/close works end-to-end;
- polling chat receives updates without broken auth/session;
- SLA statuses progress correctly.

### Phase 3 (KYC)

- User:
  - `GET /api/user/kyc`
  - `POST /api/user/kyc/submit`
  - `GET /api/user/kyc/document/<id>`
- Admin:
  - `GET /admin/api/kyc/queue`
  - `POST /admin/api/kyc/<id>/review`

Go if:

- document upload restrictions (mime/size) are enforced;
- private document endpoint respects ownership/admin auth;
- review state transitions are visible in both UI surfaces.

### Phase 4 (Hardening)

- Confirm strict rate limiting on support/KYC hotspots.
- Confirm audit events for:
  - referral rule updates,
  - KYC review decisions,
  - support action overrides.
- Confirm worker retry/dead-letter flow under load remains stable.

Go if:

- no auth/session regressions;
- no public KYC document leakage;
- no duplicate financial credits/payouts;
- no critical admin action failures.

## 4. Final Release Checklist

Use this checklist for each phase:

- [ ] Backup snapshot taken and restore tested.
- [ ] New phase flags configured but write paths initially conservative.
- [ ] Backend smoke tests green.
- [ ] Frontend build green.
- [ ] Admin API sanity checks passed for phase scope.
- [ ] User API sanity checks passed for phase scope.
- [ ] Observability checks passed (app logs, worker logs, audit events).
- [ ] On-call owner assigned for first 24h after enablement.
- [ ] Rollback command/config prepared and validated.
- [ ] Release note published with current active flags.

## Post-deploy (first 24 hours)

- Monitor:
  - top-up settlement and referral payouts,
  - support queue growth and first-response latency,
  - KYC pending queue age and reject ratio,
  - endpoint error rates (4xx/5xx) and auth failures.
- If blocker appears, rollback only the current phase flags and keep previous stable phases active.
