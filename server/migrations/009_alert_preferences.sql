-- Proactive smart alerts: per-user alert preference storage (per-kind toggle
-- plus daily mute hours, expressed as minute-of-day 0-1439) and the dedupe
-- ledger that keeps evaluation idempotent across refresh runs. The refresh job
-- (server/scripts/refreshConditions.ts) is the only writer; no API routes
-- touch these tables.

create table if not exists alert_preference (
  user_id bigint not null references app_user(id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  mute_start_minute smallint check (mute_start_minute between 0 and 1439),
  mute_end_minute smallint check (mute_end_minute between 0 and 1439),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table if not exists alert_dispatch (
  user_id bigint not null references app_user(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  dispatched_at timestamptz not null default now(),
  primary key (user_id, kind, dedupe_key)
);

create index if not exists alert_dispatch_dispatched_at_idx
  on alert_dispatch (dispatched_at);