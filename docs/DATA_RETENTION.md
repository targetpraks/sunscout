# SunScout Data Retention Schedule

Status: pre-beta baseline (PRD §16 — "Data retention schedule before beta").
Applies to the PostgreSQL system of record. External provider raw payloads follow the same schedule unless a provider contract specifies otherwise.

## Retention by data class

| Domain | Table(s) | Retention | Action at expiry |
|---|---|---|---|
| User profile | `app_user` | While active + 30 days after deletion request | Hard delete (soft `deleted_at` → purge job) |
| Account deletion request | `account_deletion_request` | 6 years (legal proof of erasure) | Archive to cold storage, then purge |
| Saved beaches | `user_saved_beach` | While active + 30 days | Cascade delete with user |
| Trips | `trip`, `trip_beach` | While active + 90 days after trip end | Anonymize/beach-link metadata, drop user link |
| Check-ins | `beach_check_in` | 24 months | Aggregate into `crowd_density`, drop user link |
| Check-in photos | `beach_check_in.photo_url` | 12 months | Delete object + column |
| Photos (gallery) | `beach_photo` | Indefinite (provider/merchant-owned) | Removed on merchant/beach deletion |
| Bookings | `booking`, `booking_item` | 7 years (financial record) | Anonymize user link after 7 years |
| Settlements | `settlement` | 7 years (financial record) | Anonymize after 7 years |
| QR tokens | `booking.qr_token` | Expires 7 days after booking end | Redeem rejects expired tokens |
| Conditions | `beach_condition` | 90 days raw, indefinitely aggregated | Drop raw rows older than 90 days; keep aggregates |
| Tide readings | `beach_tide_reading` | 30 days | Purge daily |
| Crowd forecast | `crowd_forecast` | 7 days | Purge daily |
| Hazard alerts | `hazard_alert` | While active + 30 days after expiry | Purge |
| Vibe votes | `vibe_vote` | While active + 12 months | Drop user link after 12 months |
| Analytics events | `analytics_event` | 24 months | Drop user link after 12 months; purge at 24 months |
| Audit log | `audit_log` | 24 months | Purge at 24 months |
| Notifications | `notification` | 90 days | Purge |
| Institution exports | `institution_contract.exports_used` | Rolling 12 months of usage | Counter reset on contract renewal |

## Location minimization

- Precise location is never stored. Check-ins persist only a coarse `coarse_location_bucket`.
- No background location collection (PRD §16). Location is requested only for explicit nearby search or check-in and discarded after use.

## Erasure

- `POST /api/me/delete-account` soft-deletes the user, records an `account_deletion_request`, and emits an `account_deleted` audit event. A scheduled purge job (to be wired in CI) hard-deletes user-owned rows after the 30-day grace window, retaining only legally-required financial and deletion-proof records.

## Operational jobs (to be scheduled)

- `purge-expired-tide` — daily, drops `beach_tide_reading` and `crowd_forecast` older than their windows.
- `purge-notifications` — daily, drops notifications older than 90 days.
- `expire-qr-tokens` — redeem already rejects expired tokens; no row change required.
- `anonymize-checkins` — monthly, drops user links on check-ins older than 24 months into `crowd_density`.
