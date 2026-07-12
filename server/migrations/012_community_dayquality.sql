-- Community beach data reports (sand, prices, facilities, music, food)
-- + day-quality score storage.

create table if not exists beach_attribute_report (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete cascade,
  attribute text not null,
  value text not null,
  created_at timestamptz not null default now()
);

create index if not exists beach_attr_report_beach_idx
  on beach_attribute_report (beach_id, attribute, created_at desc);

create table if not exists day_quality (
  id bigint generated always as identity primary key,
  beach_id bigint not null references beach(id) on delete cascade,
  day date not null default current_date,
  morning_score smallint,
  afternoon_score smallint,
  late_afternoon_score smallint,
  overall_score smallint,
  morning_summary text,
  afternoon_summary text,
  late_afternoon_summary text,
  raw_hourly jsonb,
  computed_at timestamptz not null default now(),
  unique (beach_id, day)
);
