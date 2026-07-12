-- Age-aware family discovery (PRD P1): age band on the family suitability row.
alter table beach_suitability
  add column if not exists age_min smallint,
  add column if not exists age_max smallint;
