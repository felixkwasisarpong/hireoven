-- Salary Benchmarks — fallback compensation data for offer negotiation
-- Run against Hireoven Postgres.

DO $$ BEGIN
  CREATE TYPE salary_location_type AS ENUM (
    'remote', 'sf_bay', 'nyc', 'seattle', 'austin', 'chicago', 'boston', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.salary_benchmarks (
  id                     UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  role_title_normalized  TEXT              NOT NULL,
  location_type          salary_location_type NOT NULL,
  p25_salary             INTEGER           NOT NULL,
  p50_salary             INTEGER           NOT NULL,
  p75_salary             INTEGER           NOT NULL,
  p90_salary             INTEGER           NOT NULL,
  data_year              INTEGER           NOT NULL DEFAULT 2025,
  source                 TEXT              NOT NULL DEFAULT 'benchmark_estimate',
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (role_title_normalized, location_type, data_year)
);

CREATE INDEX IF NOT EXISTS idx_salary_benchmarks_role
  ON public.salary_benchmarks(role_title_normalized, location_type);
