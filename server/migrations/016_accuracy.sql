-- Condition accuracy feedback (workstream 3): per-user ratings of live
-- condition readings, aggregated per condition into a 0-1 accuracy score
-- so Pulse can discount unreliable readings.
create table if not exists condition_accuracy_rating (
  id bigint generated always as identity primary key,
  beach_id bigint not null references beach(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete cascade,
  condition text not null check (condition in ('crowd', 'waterQuality', 'wind', 'wave', 'tide', 'temperature')),
  rating numeric(4,3) not null check (rating >= 0 and rating <= 1),
  captured_at timestamptz not null default now()
);

create index if not exists condition_accuracy_rating_beach_idx
  on condition_accuracy_rating (beach_id, condition);

create index if not exists condition_accuracy_rating_user_idx
  on condition_accuracy_rating (user_id, beach_id, condition, captured_at desc);