-- Trip planner + discovery + today extension: activities, clothing-optional,
-- weather detail, accuracy feedback, companions/friends, trip location.

alter table beach add column if not exists allows_nudism boolean not null default false;

create table if not exists beach_activity (
  beach_id bigint not null references beach(id) on delete cascade,
  activity text not null,
  primary key (beach_id, activity)
);

create index if not exists beach_activity_activity_idx on beach_activity (activity);

alter table beach_condition
  add column if not exists air_temp_c numeric(4,1),
  add column if not exists wind_speed_kmh numeric(5,1),
  add column if not exists cloud_cover_percent numeric(4,1);

create table if not exists condition_feedback (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  metric text not null,
  accurate boolean not null,
  created_at timestamptz not null default now(),
  unique (user_id, beach_id, metric)
);

create index if not exists condition_feedback_beach_idx on condition_feedback (beach_id, metric);

create table if not exists friend (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  name text not null,
  relationship text not null default 'friend'
    check (relationship in ('family', 'friend', 'solo', 'partner', 'kid')),
  created_at timestamptz not null default now()
);

create index if not exists friend_user_idx on friend (user_id, created_at desc);

alter table trip
  add column if not exists location_label text,
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6);

create table if not exists trip_member (
  trip_id bigint not null references trip(id) on delete cascade,
  friend_id bigint not null references friend(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, friend_id)
);
