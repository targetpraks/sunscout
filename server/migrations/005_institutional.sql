-- Release 3: institutional / B2B product — tenants, contracts, region-pinned
-- beaches, exports, and signed iframe embed tokens.

create table if not exists institution (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  name text not null,
  slug text not null unique,
  region text,
  created_at timestamptz not null default now()
);

create table if not exists institution_member (
  institution_id bigint not null references institution(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (institution_id, user_id)
);

create table if not exists institution_contract (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  institution_id bigint not null references institution(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'expired', 'terminated')),
  starts_on date not null default current_date,
  ends_on date,
  annual_quota_exports integer not null default 10000,
  exports_used integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists institution_contract_institution_idx
  on institution_contract (institution_id, status);

create table if not exists institution_beach (
  institution_id bigint not null references institution(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (institution_id, beach_id)
);

create table if not exists embed_token (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  token text not null unique,
  institution_id bigint not null references institution(id) on delete cascade,
  label text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists embed_token_token_idx on embed_token (token);
