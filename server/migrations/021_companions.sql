-- Companions (durable 2026-06-22 group direction): the people a user
-- travels with — name plus relationship (family / friend / solo) — so a
-- booking can be planned for the whole group instead of a solo user.
-- Distinct from the `friend` trip-planner entity (008_planner_extension):
-- companions are the group profile attached to beach-day bookings; the
-- friend surface (trip members and votes) stays untouched.

create table if not exists companion (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  relationship text not null default 'friend'
    check (relationship in ('family', 'friend', 'solo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate names are rejected per user, case-insensitively ("Alex" and
-- "alex" are the same companion). Enforced here in addition to the
-- pre-check in server/companions.ts so races cannot create dupes.
create unique index if not exists companion_user_name_key
  on companion (user_id, lower(name));
create index if not exists companion_user_idx on companion (user_id);

-- Booking ↔ companion attach table: which companions are coming on a
-- booked beach day. Ownership is enforced in the API layer — the booking
-- is always owner-scoped and every attached companion must belong to the
-- same user — so no user_id is denormalized here.
create table if not exists booking_companion (
  booking_id bigint not null references booking(id) on delete cascade,
  companion_id bigint not null references companion(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (booking_id, companion_id)
);

create index if not exists booking_companion_companion_idx
  on booking_companion (companion_id);

-- Down (the migration runner is append-only, so a revert is run manually
-- against the target database, in this order):
--   drop table if exists booking_companion;
--   drop index if exists companion_user_name_key;
--   drop table if exists companion;