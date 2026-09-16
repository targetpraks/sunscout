-- Per-audience vibe votes: the Beach Pulse community signal.
-- Distinct from the vibe_vote toggle table in 002_rich_beach_data.sql:
-- this table records who (user) felt what (vibe) as which audience, once
-- per beach per local day. The 24h cooldown is enforced in server/vibes.ts
-- via an insert guard; the unique constraint below is the same-day backstop.
--
-- Audience tags are the superset of the beach_suitability audience ids
-- (families, solo, couples, party, clubs) and the per-audience leaderboard
-- scopes from the product direction (friends, chill, beach-club) so
-- workstream-1's per-audience Pulse leaderboards always find their bucket.
--
-- NOTE: originally numbered 004 by the workstream spec while 004_release2.sql
-- already existed; renumbered to 015 so the sequence stays readable (the loader
-- keys on the full filename)

create table if not exists beach_vibe_vote (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete cascade,
  vibe text not null check (
    vibe in ('chill', 'party', 'family', 'romantic', 'hidden-gem', 'beach-club')
  ),
  audience_tag text not null check (
    audience_tag in (
      'families', 'friends', 'solo', 'couples', 'party', 'clubs',
      'chill', 'beach-club'
    )
  ),
  local_day date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, beach_id, local_day)
);

create index if not exists beach_vibe_vote_beach_time_idx
  on beach_vibe_vote (beach_id, created_at desc);

create index if not exists beach_vibe_vote_user_time_idx
  on beach_vibe_vote (user_id, beach_id, created_at desc);