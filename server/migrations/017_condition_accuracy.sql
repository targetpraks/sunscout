-- Condition-accuracy feedback loop (PRD 6.1 community signal): one 1-5
-- rating per (user, beach, condition) for how accurate each published live
-- condition is. The latest rating wins. Aggregated per-condition into the
-- accuracy signal surfaced on Today + Beach Detail and available to the
-- Beach Pulse community mix.

create table if not exists condition_accuracy (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  condition text not null
    check (condition in ('crowd', 'water_quality', 'wind', 'temperature', 'cloud_cover')),
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, beach_id, condition)
);

create index if not exists condition_accuracy_beach_idx
  on condition_accuracy (beach_id, condition);
create index if not exists condition_accuracy_user_idx on condition_accuracy (user_id);