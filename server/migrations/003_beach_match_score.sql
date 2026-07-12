-- Promote the ranking match score to a beach-level column so provider
-- condition refreshes (which carry provider raw, not ranking signals) cannot
-- drop a beach's match score.
alter table beach add column if not exists match_score smallint not null default 0;
create index if not exists beach_match_score_idx on beach (match_score desc);
