-- Brand takeover engine (Pillar 7, PRD §4.6 + 2026-06-24 advertising direction).
--
-- Extends the flat ad_placement inventory (007_sponsorship.sql) with scope-
-- aware brand takeovers: a brand takes over a single beach, an island, or a
-- region defined by a bounding box, for a time window, with a contextual
-- surface mapping (conditions=sunblock, sightings=swimwear, golden-hour=
-- watch, beach-detail=beach club).
--
-- Earned-vs-paid integrity rule (unchanged): rows in ad_takeover own ONLY
-- the visual/branding/curated layer of a beach surface. Nothing in this
-- table may be read by, feed into, or influence Beach Pulse scoring, day
-- quality, match scores, or any earned ranking. server/ads.test.ts pins
-- that invariant.
--
-- Coexists with 016_booking_cancellations.sql: the migration runner tracks
-- versions by full filename (see server/migrate.ts), and this file sorts
-- before it lexically.
--
-- Island identity: `beach` has no island column today, so island-scope
-- matching needs one. Added additively here (nullable, no backfill):
-- existing rows simply have no island, and island-scope takeovers never
-- match them. Region scope is a literal bounding box on the takeover row —
-- it deliberately does not reuse beach.region (a free-text label).

alter table beach
  add column if not exists island_code text;

create index if not exists beach_island_code_idx
  on beach (island_code) where island_code is not null;

create table if not exists ad_takeover (
  id serial primary key,
  public_id uuid not null unique default gen_random_uuid(),
  -- Contextual surface the takeover owns. Exactly one per row; the
  -- resolution ladder never mixes surfaces.
  surface text not null check (surface in ('conditions', 'sightings', 'golden-hour', 'beach-detail')),
  -- Scope ladder, resolved by server/ads.ts: beach beats island beats
  -- region, regardless of ad-buy weight.
  scope_kind text not null check (scope_kind in ('beach', 'island', 'region')),
  -- Scope targets; exactly one shape is set, enforced below. Plain uuid,
  -- NOT a foreign key — the ads domain stays decoupled from internal ids
  -- (same convention as ad_placement).
  scope_beach_public_id uuid,
  -- Matches beach.island_code when scope_kind = 'island'.
  scope_island text,
  -- Inclusive bounding box when scope_kind = 'region'.
  scope_min_lat numeric(9,6),
  scope_max_lat numeric(9,6),
  scope_min_lng numeric(9,6),
  scope_max_lng numeric(9,6),
  brand_name text not null check (length(btrim(brand_name)) > 0),
  label text not null check (length(btrim(label)) > 0),
  headline text,
  body text,
  image_url text,
  target_url text,
  weight int not null default 0 check (weight >= 0),
  sponsored boolean not null default true,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Half-open window, matching ad_placement and the events calendar.
  constraint ad_takeover_window check (end_at > start_at),
  constraint ad_takeover_scope_shape check (
    (scope_kind = 'beach'
       and scope_beach_public_id is not null
       and scope_island is null
       and scope_min_lat is null and scope_max_lat is null
       and scope_min_lng is null and scope_max_lng is null)
    or (scope_kind = 'island'
       and scope_beach_public_id is null
       and scope_island is not null
       and scope_min_lat is null and scope_max_lat is null
       and scope_min_lng is null and scope_max_lng is null)
    or (scope_kind = 'region'
       and scope_beach_public_id is null
       and scope_island is null
       and scope_min_lat is not null and scope_max_lat is not null
       and scope_min_lng is not null and scope_max_lng is not null
       and scope_min_lat <= scope_max_lat
       and scope_min_lng <= scope_max_lng)
  )
);

create index if not exists ad_takeover_surface_window_idx
  on ad_takeover (surface, start_at, end_at);
create index if not exists ad_takeover_beach_idx
  on ad_takeover (scope_beach_public_id, start_at, end_at)
  where scope_kind = 'beach';
create index if not exists ad_takeover_island_idx
  on ad_takeover (scope_island, start_at, end_at)
  where scope_kind = 'island';