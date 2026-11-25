-- Adaptive Math Coach — learner PIN login rate limits
-- Safe to re-run. The app also issues CREATE TABLE IF NOT EXISTS on first use.

create table if not exists amc_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  fail_count int not null default 0,
  updated_at timestamptz not null default now()
);
