-- Booking self-service cancellations (workstream: ship booking self-service).
--
-- One row per cancelled booking: the refund policy tier that was applied, the
-- refund and forfeit amounts in minor units, and when the user cancelled. The
-- booking row itself only flips status to 'cancelled' (the status CHECK from
-- 001_initial.sql already allows it) — the money outcome lives here so the
-- history is append-only and a re-cancel cannot overwrite the original result.
--
-- Policy (see server/bookings.ts): full refund >24h before start, 50% refund
-- 2-24h before start, no refund <2h before start.

create table if not exists booking_cancellation (
  id bigint generated always as identity primary key,
  booking_id bigint not null references booking(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete restrict,
  cancelled_at timestamptz not null default now(),
  refund_cents integer not null check (refund_cents >= 0),
  forfeit_cents integer not null check (forfeit_cents >= 0),
  refund_tier text not null check (refund_tier in ('full', 'partial', 'none')),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  unique (booking_id)
);

create index if not exists booking_cancellation_user_idx
  on booking_cancellation (user_id, cancelled_at desc);