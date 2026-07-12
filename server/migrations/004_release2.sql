-- Release 2: badges/progression, settlement ledger, activity metadata,
-- photo check-in, notification foundations, and crowd density aggregation.

create table if not exists badge (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  slug text not null unique,
  name text not null,
  description text not null,
  criteria jsonb not null default '{}'::jsonb,
  icon text not null default 'medal',
  created_at timestamptz not null default now()
);

create table if not exists badge_award (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  badge_id bigint not null references badge(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

create index if not exists badge_award_user_idx on badge_award (user_id, awarded_at desc);

alter table amenity_inventory
  add column if not exists label text,
  add column if not exists description text;

alter table beach_check_in
  add column if not exists photo_url text,
  add column if not exists caption text;

create table if not exists settlement (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  booking_id bigint not null references booking(id) on delete cascade,
  merchant_id bigint not null references merchant(id) on delete cascade,
  gross_cents integer not null check (gross_cents >= 0),
  commission_cents integer not null check (commission_cents >= 0),
  net_cents integer not null check (net_cents = gross_cents - commission_cents),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  status text not null default 'pending'
    check (status in ('pending', 'settled', 'refunded')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists settlement_merchant_idx on settlement (merchant_id, status, created_at desc);

create table if not exists crowd_density (
  id bigint generated always as identity primary key,
  beach_id bigint not null references beach(id) on delete cascade,
  observed_at timestamptz not null default now(),
  crowd_percent smallint not null check (crowd_percent between 0 and 100),
  source text not null default 'check_in_aggregate',
  contributors integer not null default 0
);

create index if not exists crowd_density_beach_idx on crowd_density (beach_id, observed_at desc);

create table if not exists notification (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_user_idx on notification (user_id, created_at desc);

create table if not exists notification_preference (
  user_id bigint not null references app_user(id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  primary key (user_id, kind)
);
