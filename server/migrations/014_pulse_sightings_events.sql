-- Beach Pulse, Sightings, and Events wiring: persistence for the
-- coordinator-owned beach event calendar and the ephemeral beach-scoped
-- sightings rail (7-day TTL).

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
create index if not exists beach_event_beach_idx on beach_event (beach_id, start_at);
create index if not exists beach_event_coordinator_idx on beach_event (coordinator_id);

-- beach_id is the beach public id (opaque to the sightings domain, which never
-- resolves it to the internal beach row).
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
  expires_at timestamptz
);

create index if not exists beach_sighting_beach_idx on beach_sighting (beach_id, captured_at desc);
create index if not exists beach_sighting_expiry_idx on beach_sighting (expires_at) where expires_at is not null;