-- Brand sponsorship & takeover surfaces (Pillar 7, PRD §4.6).
--
-- Integrity rule (earned-vs-paid separation): rows in ad_placement own ONLY
-- the visual/branding/curated layer of a beach surface. Nothing in this table
-- may be read by, feed into, or influence Beach Pulse scoring, day quality,
-- match scores, or any earned ranking. server/ads.test.ts pins that invariant.
--
-- This file keeps the 007_ prefix from the workstream spec. The migration
-- runner tracks versions by full filename, so it coexists with
-- 007_external_auth.sql without conflict (lexical order: external_auth first).

create table if not exists ad_placement (
  id serial primary key,
  public_id uuid not null unique default gen_random_uuid(),
  -- beach public id, deliberately not an FK into beach(id): the ads domain is
  -- decoupled from internal ids (same convention as beach_sighting).
  beach_public_id uuid not null,
  kind text not null check (kind in ('placement', 'beach_takeover', 'event_takeover')),
  brand_name text not null check (length(btrim(brand_name)) > 0),
  label text not null check (length(btrim(label)) > 0),
  headline text,
  body text,
  image_url text,
  target_url text,
  -- plain uuid, NOT a foreign key: beach_event is created by migration 014,
  -- which sorts after 007 on a fresh database.
  event_public_id uuid,
  weight int not null default 0 check (weight >= 0),
  sponsored boolean not null default true,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ad_placement_window check (end_at > start_at)
);

create index if not exists ad_placement_beach_window_idx
  on ad_placement (beach_public_id, start_at, end_at);
create index if not exists ad_placement_kind_idx on ad_placement (kind);