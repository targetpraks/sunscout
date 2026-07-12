-- Social trip sharing + beach journal + activity tracker + beach ratings.

create table if not exists trip_invite (
  trip_id bigint not null references trip(id) on delete cascade,
  friend_id bigint not null references friend(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (trip_id, friend_id)
);

create table if not exists trip_vote (
  trip_id bigint not null references trip(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  friend_id bigint not null references friend(id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (trip_id, beach_id, friend_id)
);

create table if not exists beach_journal_entry (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  check_in_id bigint references beach_check_in(id) on delete set null,
  notes text,
  mood text check (mood in ('relaxed', 'energetic', 'social', 'adventurous', 'family')),
  conditions_snapshot jsonb not null default '{}'::jsonb,
  visited_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists journal_user_idx on beach_journal_entry (user_id, visited_at desc);
create index if not exists journal_beach_idx on beach_journal_entry (beach_id, user_id);

create table if not exists beach_rating (
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, beach_id)
);
