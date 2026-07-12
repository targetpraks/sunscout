# SunScout Incident Runbook

Aligned to GDPR breach-notification timelines (notify the supervisory authority within 72 hours of becoming aware of a personal-data breach; notify affected users without undue delay when high risk).

## Severity definitions

- **SEV1 — personal data breach or production data loss.** Examples: DB leak, signed-QR secret compromise, deletion of user data, auth bypass. Page on-call immediately.
- **SEV2 — major functionality degraded.** Examples: booking creation failing, conditions refresh down across all beaches, merchant redeem broken.
- **SEV3 — minor degradation.** Examples: a single provider adapter failing (mocked fallback covers it), slow reads.

## Response timeline (SEV1)

1. **0–15 min:** Acknowledge, declare SEV1, start an incident channel, record start time (the 72-hour GDPR clock starts at awareness).
2. **15–60 min:** Contain. Rotate `SUNSCOUT_QR_SECRET` if QR tokens are compromised; revoke embed tokens; block the affected route; revert the offending deploy.
3. **60 min–4 h:** Assess scope. Query `audit_log` and `analytics_event` for affected actors/timeframe. Identify data classes exposed (use the Data Retention schedule).
4. **Within 72 h:** Notify the supervisory authority if personal data is involved. Record the notification.
5. **Without undue delay:** Notify affected users if high risk to rights and freedoms.
6. **Within 5 business days:** Postmortem published; corrective actions filed.

## Playbooks

### Auth / header-adapter compromise
The current `x-sunscout-user-id` adapter is a placeholder (PRD non-goal until Clerk JWT). If it leaks, the blast radius is the demo user only. On real JWT: rotate Clerk keys, force re-auth, audit `audit_log` for `account_deleted` / `booking_created` anomalies.

### QR token compromise
- Rotate `SUNSCOUT_QR_SECRET` (restart API). Existing tokens fail signature verification.
- Tokens already expire 7 days after booking end (`verifyBookingToken`).
- Audit `booking_redeemed` events for redeems outside expected windows.

### Provider outage
- A provider failure does not crash refresh: `refreshConditions` records the beach in `failed[]` and keeps prior data with its freshness label. The UI shows "Updated N min ago" / "Offline beach estimate" (honest degradation, PRD principle 6).
- Tide/water-quality/SoFar/map use mocked fallback adapters; no unverified Spotter claim is shown.

### Data loss / accidental deletion
- Restore from the latest Postgres backup. Bookings and settlements are financial records — prioritize restoring `booking`, `booking_item`, `settlement`.
- `account_deletion_request` must be restored to prove erasure compliance.

## Contacts (fill before beta)
- On-call engineer: ___
- DPO / privacy lead: ___
- Supervisory authority (Portugal CNPD): cnpd.pt
