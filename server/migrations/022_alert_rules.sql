-- Personal condition alert rules ("tell me before I go"): a beachgoer picks a
-- saved beach and a predicate — wind dropping below a threshold, golden hour
-- approaching within an offset, or a hazard clearing — and the alert-rule
-- matcher on the condition refresh turns live conditions into rule-scoped
-- notifications. Storage is rule-scoped, evaluation stays honest: rules only
-- read live condition data, never alter Day Score or Beach Pulse ranking.

create table if not exists alert_rule (
  id bigint generated always as identity primary key,
  user_id bigint not null references app_user(id) on delete cascade,
  beach_id bigint not null references beach(id) on delete cascade,
  -- wind_below | golden_hour_within | hazard_clear
  kind text not null check (kind in ('wind_below', 'golden_hour_within', 'hazard_clear')),
  -- Predicate config, validated by zod in server/alertRules.ts:
  --   wind_below:           { "thresholdKmh": 15 }
  --   golden_hour_within:   { "offsetMinutes": 30 }
  --   hazard_clear:         {} (no config; matches when hazards on the beach
  --                          have all cleared)
  config jsonb not null default '{}'::jsonb,
  -- low | normal | high — the banner shows only >= the user's chosen priority
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  enabled boolean not null default true,
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, beach_id, kind, config)
);

create index if not exists alert_rule_user_idx on alert_rule (user_id);
create index if not exists alert_rule_enabled_idx on alert_rule (enabled) where enabled;