-- Adaptive Math Coach — per learner x learning-component Beta posteriors
-- Safe to re-run. The app also issues CREATE TABLE IF NOT EXISTS on first use.
--
-- alpha/beta are Beta(alpha, beta) posterior parameters with prior Beta(1,1):
--   correct answer -> alpha += w, wrong answer -> beta += w
--   (w = 1/k when an item is tagged with k learning components, so values
--   can be fractional -> double precision).
-- lc_id is the Learning Commons LearningComponent identifier (text).

create table if not exists amc_lc_mastery (
  learner_id uuid not null,
  lc_id text not null,
  alpha double precision not null default 1 check (alpha >= 1),
  beta double precision not null default 1 check (beta >= 1),
  updated_at timestamptz not null default now(),
  primary key (learner_id, lc_id)
);

create index if not exists amc_lc_mastery_learner_idx
  on amc_lc_mastery (learner_id, updated_at desc);
