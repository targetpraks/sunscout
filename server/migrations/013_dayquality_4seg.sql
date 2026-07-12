-- Add 4th segment (early morning) to day_quality for more granular scoring.
alter table day_quality
  add column if not exists early_morning_score smallint,
  add column if not exists early_morning_summary text;
