-- Adaptive Math Coach — run once in Supabase SQL Editor

create table if not exists amc_sessions (
  id uuid primary key,
  short_code text,
  learner_id uuid null,
  grade text not null,
  jurisdiction text null,
  percent int null,
  score int null,
  total int null,
  result jsonb not null default '{}'::jsonb,
  roadmap jsonb null,
  coverage jsonb null,
  artifacts jsonb null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists amc_sessions_created_at_idx on amc_sessions (created_at desc);
create index if not exists amc_sessions_learner_id_idx on amc_sessions (learner_id);
create index if not exists amc_sessions_short_code_idx on amc_sessions (short_code);

create table if not exists amc_learners (
  id uuid primary key,
  public_code text not null unique,
  pin_hash text not null,
  pin_salt text not null,
  current_grade text null,
  jurisdiction text null,
  component_mastery jsonb not null default '{}'::jsonb,
  coverage_history jsonb not null default '[]'::jsonb,
  session_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists amc_learners_public_code_idx on amc_learners (public_code);

create table if not exists amc_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  session_id uuid null,
  learner_id uuid null,
  grade text null,
  ok boolean not null default true,
  message text null,
  meta jsonb null
);

create index if not exists amc_events_at_idx on amc_events (at desc);
create index if not exists amc_events_kind_idx on amc_events (kind);
