-- Auth/payments/push adapter boundaries + community hazard reporting.

alter table hazard_alert
  add column if not exists verified boolean not null default false,
  add column if not exists reported_by bigint references app_user(id) on delete set null;

create table if not exists push_subscription (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  endpoint text not null,
  p256dh_key text,
  auth_secret text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists merchant_claim (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  business_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, beach_id)
);
