-- Sightings lifecycle hardening: server-enforced 7-day TTL, expiry sweep
-- marker, and moderation/read-path indexes.
--
-- ORDER-INDEPENDENT BY DESIGN: the migration runner applies files in
-- filename order, and this file sorts BEFORE
-- 014_pulse_sightings_events.sql, which also creates beach_sighting. On a
-- fresh database this file creates the table itself (so 014's create is a
-- no-op); on a database that already applied 014 the create below is a
-- no-op and only the swept_at column and new indexes are added. The column
-- set must therefore stay identical to 014's definition.

create table if not exists beach_sighting (
  id uuid primary key,
  beach_id text not null,
  audience text not null check (audience in ('family','friends','solo','couple','group','beach-club')),
  time_of_day text check (time_of_day in ('sunrise','morning','midday','afternoon','golden-hour','dusk','night')),
  moderation_state text not null default 'approved' check (moderation_state in ('pending','approved','rejected')),
  people_in_frame boolean not null default false,
  people_consent boolean not null default false,
  media_form text not null check (media_form in ('native','link')),
  media_url text not null,
  media_mime_type text,
  media_platform text,
  media_attribution text,
  caption text,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Flipped once by the idempotent expiry sweep when the row's TTL
  -- boundary has passed. NULL = never swept (or a link sighting, which
  -- never auto-expires).
  swept_at timestamptz
);

-- For databases where 014 already created the table without swept_at.
alter table beach_sighting add column if not exists swept_at timestamptz;

-- Same names + definitions as 014 so a fresh database does not end up with
-- duplicate indexes when 014 runs afterwards.
create index if not exists beach_sighting_beach_idx on beach_sighting (beach_id, captured_at desc);
create index if not exists beach_sighting_expiry_idx on beach_sighting (expires_at) where expires_at is not null;

-- New for the lifecycle hardening: the sweep scan (unswept, expired) and
-- the moderation-gated read path.
create index if not exists beach_sighting_sweep_idx on beach_sighting (expires_at) where expires_at is not null and swept_at is null;
create index if not exists beach_sighting_moderation_idx on beach_sighting (moderation_state, captured_at desc);