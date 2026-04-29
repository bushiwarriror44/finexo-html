# Dashboard API Contract

This document freezes the frontend-to-backend contract used by the user cabinet.

## Error Envelope

All non-2xx responses must follow:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": {
    "fields": {
      "fieldName": "REQUIRED|INVALID|TOO_SHORT|TOO_LARGE"
    }
  }
}
```

`details` is optional. `details.fields` is required for field-level validation failures.

## Status Mapping Policy

Backend may keep internal statuses, but API responses for dashboard endpoints must expose normalized statuses:

- **Topups**
  - `confirmed -> completed`
  - `rejected -> failed`
  - `pending -> pending`
  - verification: `done -> completed`, `running -> running`, `queued -> queued`, `failed -> failed`
- **Withdrawals**
  - `approved|processing -> processing`
  - `rejected -> failed`
  - `pending|completed|cancelled` unchanged
- **KYC**
  - `pending -> review`
  - `not_started|approved|rejected` unchanged
- **Support tickets**
  - `resolved -> completed`
  - `open|in_progress|waiting_user|closed` unchanged

All responses that normalize statuses should also include `rawStatus` (and `rawVerificationStatus` where applicable).

## Required Endpoints (User Cabinet)

- `GET /api/user/balance`
- `GET /api/user/referral`
- `POST /api/user/referral/regenerate`
- `GET /api/user/kyc`
- `POST /api/user/kyc/submit`
- `POST /api/user/change-password`
- `GET /api/user/mining/summary`
- `GET /api/user/mining/contracts`
- `GET /api/user/mining/accruals`
- `GET /api/user/mining/plans`
- `POST /api/user/mining/contracts`
- `GET /api/wallet/addresses`
- `GET /api/wallet/topups`
- `POST /api/wallet/topup`
- `POST /api/wallet/topup/:id/verify`
- `POST /api/wallet/topup/:id/process-now`
- `GET /api/user/withdrawals`
- `POST /api/user/withdrawals`
- `POST /api/user/withdrawals/:id/cancel`
- `GET /api/user/support/tickets`
- `POST /api/user/support/tickets`
- `GET /api/user/support/tickets/:id/messages`
- `POST /api/user/support/tickets/:id/messages`
- `POST /api/user/support/tickets/:id/close`

## Response Field Notes

- `support tickets` should include `category`, `slaState`, `firstResponseDueAt`.
- `support messages` should include `eventType`.
- `topups` and `withdrawals` should include optional `feeAmount` (nullable allowed).
- datetime fields should use ISO-8601.
