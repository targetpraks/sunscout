-- Spotter crowdfunding program (PRD P1): community-funded Spotter buoys.
create table if not exists spotter_campaign (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  beach_id bigint not null references beach(id) on delete cascade,
  goal_cents integer not null check (goal_cents > 0),
  raised_cents integer not null default 0 check (raised_cents >= 0),
  status text not null default 'open'
    check (status in ('open', 'funded', 'deployed')),
  created_at timestamptz not null default now(),
  unique (beach_id)
);

create table if not exists spotter_contribution (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  campaign_id bigint not null references spotter_campaign(id) on delete cascade,
  user_id bigint not null references app_user(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index if not exists spotter_contribution_campaign_idx on spotter_contribution (campaign_id, created_at desc);
