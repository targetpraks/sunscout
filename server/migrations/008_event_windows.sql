-- Event start/end windows for the live "what's happening now" view.
--
-- Ordering note: this file sorts BEFORE 014_pulse_sightings_events.sql,
-- which also creates beach_event with `create table if not exists`. To stay
-- correct on both fresh and already-migrated databases, the DDL here is
-- fully self-contained and idempotent: on a fresh database it creates the
-- table and the live-window index; where 014 has already run, every
-- statement below is a no-op. Keep the column list in sync with 014 and with
-- the EVENTS_MIGRATION_SQL export in server/events.ts.

create table if not exists beach_event (
  id serial primary key,
  public_id uuid not null unique default gen_random_uuid(),
  beach_id int not null references beach(id),
  coordinator_id int not null references app_user(id),
  title text not null,
  description text,
  category text not null check (category in ('party','surf-competition','beach-soccer','triathlon','sailing','takeover')),
  state text not null default 'draft' check (state in ('draft','published','cancelled')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_paid_takeover boolean not null default false,
  sponsor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beach_event_window check (end_at > start_at)
);

-- Consumer "now" selector: published events only, probed by beach and
-- window bounds. The partial index keeps the time-windowed endpoint cheap
-- without indexing coordinator-private drafts/cancellations.
create index if not exists beach_event_live_window_idx
  on beach_event (beach_id, start_at, end_at)
  where state = 'published';

-- Backfill note: start_at/end_at are NOT NULL since 014, so existing rows
-- already carry valid windows and no backfill is needed.