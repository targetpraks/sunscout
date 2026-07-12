create extension if not exists pgcrypto;

create table app_user (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  email text not null unique,
  display_name text not null,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table beach (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  slug text not null unique,
  name text not null,
  country_code text not null check (char_length(country_code) = 2),
  region text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  timezone text not null,
  description text not null,
  decision_text text not null,
  cover_photo_url text not null,
  beach_type text not null check (beach_type in ('sandy', 'rocky', 'coral', 'mixed')),
  has_spotter boolean not null default false,
  blue_flag boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index beach_region_idx on beach (region, name);
create index beach_location_idx on beach (latitude, longitude);
create index beach_spotter_idx on beach (has_spotter) where has_spotter;

create table beach_condition (
  id bigint generated always as identity primary key,
  beach_id bigint not null references beach(id) on delete cascade,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null,
  sea_temp_c numeric(4,1),
  wave_height_m numeric(4,2),
  uv_index numeric(4,1),
  crowd_percent smallint check (crowd_percent between 0 and 100),
  water_quality text check (water_quality in ('excellent', 'good', 'advisory', 'closed', 'unknown')),
  golden_hour_start timestamptz,
  golden_hour_end timestamptz,
  raw jsonb not null default '{}'::jsonb
);

create index beach_condition_beach_observed_idx
  on beach_condition (beach_id, observed_at desc);

create table beach_suitability (
  beach_id bigint not null references beach(id) on delete cascade,
  audience text not null check (audience in ('families', 'solo', 'couples', 'party', 'clubs')),
  label text not null,
  score smallint check (score between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (beach_id, audience)
);

create table beach_amenity (
  beach_id bigint not null references beach(id) on delete cascade,
  amenity text not null,
  verified_at timestamptz,
  source text not null default 'community',
  primary key (beach_id, amenity)
);

create table user_saved_beach (
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, beach_id)
);

create index user_saved_beach_beach_idx on user_saved_beach (beach_id);

create table trip (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index trip_user_status_idx on trip (user_id, status, created_at desc);

create table trip_beach (
  trip_id bigint not null references trip(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  planned_for date,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (trip_id, beach_id)
);

create index trip_beach_beach_idx on trip_beach (beach_id);

create table beach_check_in (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  local_day date not null default current_date,
  crowd_contributed boolean not null default true,
  coarse_location_bucket text,
  points_awarded smallint not null default 10,
  unique (user_id, beach_id, local_day)
);

create index beach_check_in_beach_time_idx on beach_check_in (beach_id, checked_in_at desc);
create index beach_check_in_user_time_idx on beach_check_in (user_id, checked_in_at desc);

create table merchant (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  owner_user_id bigint references app_user(id) on delete restrict,
  beach_id bigint not null references beach(id) on delete restrict,
  business_name text not null,
  kyc_status text not null default 'pending' check (kyc_status in ('pending', 'verified', 'rejected')),
  commission_basis_points smallint not null default 500 check (commission_basis_points between 0 and 10000),
  created_at timestamptz not null default now()
);

create index merchant_owner_idx on merchant (owner_user_id);
create index merchant_beach_idx on merchant (beach_id);

create table amenity_inventory (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  merchant_id bigint not null references merchant(id) on delete cascade,
  amenity_type text not null check (amenity_type in ('sunbed', 'umbrella', 'cabana', 'activity')),
  total_count integer not null check (total_count >= 0),
  available_count integer not null check (available_count between 0 and total_count),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  slot_duration_minutes integer not null default 360 check (slot_duration_minutes > 0),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (merchant_id, amenity_type)
);

create index amenity_inventory_merchant_idx on amenity_inventory (merchant_id);
create index amenity_inventory_available_idx
  on amenity_inventory (merchant_id, amenity_type)
  where available_count > 0;

create table booking (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete restrict,
  merchant_id bigint not null references merchant(id) on delete restrict,
  beach_id bigint not null references beach(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'redeemed', 'cancelled', 'no_show', 'refunded')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  commission_cents integer not null check (commission_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  qr_token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index booking_user_starts_idx on booking (user_id, starts_at desc);
create index booking_merchant_starts_idx on booking (merchant_id, starts_at desc);
create index booking_beach_starts_idx on booking (beach_id, starts_at desc);
create index booking_active_idx on booking (merchant_id, starts_at)
  where status in ('pending', 'confirmed');

create table booking_item (
  booking_id bigint not null references booking(id) on delete cascade,
  inventory_id bigint not null references amenity_inventory(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  primary key (booking_id, inventory_id)
);

create index booking_item_inventory_idx on booking_item (inventory_id);

create table analytics_event (
  id bigint generated always as identity primary key,
  user_id bigint references app_user(id) on delete set null,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  properties jsonb not null default '{}'::jsonb
);

create index analytics_event_name_time_idx on analytics_event (event_name, occurred_at desc);
create index analytics_event_user_time_idx on analytics_event (user_id, occurred_at desc);
