-- Settlement engine: redeemed bookings roll into one open settlement period
-- per merchant; closing a period produces a payout record net of the platform
-- commission. Extends the per-booking settlement ledger from 004_release2.sql
-- with period grouping and payouts.

create table if not exists settlement_period (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  merchant_id bigint not null references merchant(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

-- One open period per merchant; any number of closed periods.
create unique index if not exists settlement_period_one_open_per_merchant
  on settlement_period (merchant_id) where status = 'open';

create index if not exists settlement_period_merchant_idx
  on settlement_period (merchant_id, status);

alter table settlement
  add column if not exists period_id bigint references settlement_period(id) on delete set null;

create index if not exists settlement_period_id_idx on settlement (period_id);

create table if not exists payout (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  period_id bigint not null unique references settlement_period(id) on delete cascade,
  merchant_id bigint not null references merchant(id) on delete cascade,
  booking_count integer not null check (booking_count >= 0),
  gross_cents integer not null default 0 check (gross_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  net_cents integer not null default 0 check (net_cents = gross_cents - commission_cents),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  status text not null default 'scheduled' check (status in ('scheduled', 'paid', 'failed')),
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payout_merchant_idx on payout (merchant_id, closed_at desc);