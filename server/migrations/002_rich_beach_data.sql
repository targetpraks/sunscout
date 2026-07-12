-- Rich beach surface: vibes, photos, hazards, tide, crowd forecast,
-- golden-hour detail, audit log, and account deletion requests.

alter table beach_condition
  add column if not exists sunrise timestamptz,
  add column if not exists sunset timestamptz,
  add column if not exists blue_hour_morning text,
  add column if not exists blue_hour_evening text,
  add column if not exists golden_hour_direction text,
  add column if not exists light_score smallint check (light_score between 0 and 100);

create table if not exists vibe_tag (
  beach_id bigint not null references beach(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (beach_id, tag)
);

create table if not exists vibe_vote (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  tag text not null,
  user_id bigint not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (beach_id, tag, user_id)
);

create index if not exists vibe_vote_beach_tag_idx on vibe_vote (beach_id, tag);

create table if not exists beach_photo (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  photo_url text not null,
  time_of_day text not null,
  caption text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists beach_photo_beach_idx on beach_photo (beach_id, position);

create table if not exists hazard_alert (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  severity text not null check (severity in ('advisory', 'warning', 'danger')),
  title text not null,
  detail text not null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  source text not null default 'lifeguard',
  created_at timestamptz not null default now()
);

create index if not exists hazard_alert_beach_idx on hazard_alert (beach_id, created_at desc);

create table if not exists beach_tide_reading (
  id bigint generated always as identity primary key,
  beach_id bigint not null references beach(id) on delete cascade,
  day date not null default current_date,
  time_label text not null,
  height_m numeric(4,2) not null,
  source text not null default 'tide_provider_demo',
  created_at timestamptz not null default now(),
  unique (beach_id, day, time_label)
);

create index if not exists beach_tide_reading_beach_day_idx
  on beach_tide_reading (beach_id, day, time_label);

create table if not exists crowd_forecast (
  beach_id bigint not null references beach(id) on delete cascade,
  hour smallint not null check (hour between 0 and 23),
  crowd_percent smallint not null check (crowd_percent between 0 and 100),
  source text not null default 'forecast_demo',
  updated_at timestamptz not null default now(),
  primary key (beach_id, hour)
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  actor_user_id bigint references app_user(id) on delete set null,
  action text not null,
  target text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_idx on audit_log (actor_user_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log (action, created_at desc);

create table if not exists account_deletion_request (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
