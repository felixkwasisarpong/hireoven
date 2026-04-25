-- =============================================================================
-- Hireoven - Supabase Database Schema
-- =============================================================================

-- 1. Companies table
-- Stores every company we monitor
CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  industry TEXT,
  size TEXT, -- startup, small, medium, large, enterprise
  careers_url TEXT NOT NULL,
  ats_type TEXT, -- greenhouse, lever, workday, icims, bamboohr, ashby, custom
  is_active BOOLEAN DEFAULT true,
  last_crawled_at TIMESTAMPTZ,
  job_count INTEGER DEFAULT 0,
  -- H1B / sponsorship data
  h1b_sponsor_count_1yr INTEGER DEFAULT 0,
  h1b_sponsor_count_3yr INTEGER DEFAULT 0,
  sponsors_h1b BOOLEAN DEFAULT false,
  sponsorship_confidence INTEGER DEFAULT 0, -- 0-100 score
  immigration_profile_summary JSONB,
  hiring_health JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Jobs table
-- Every job listing we detect
CREATE TABLE jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  is_remote BOOLEAN DEFAULT false,
  is_hybrid BOOLEAN DEFAULT false,
  employment_type TEXT, -- fulltime, parttime, contract, internship
  seniority_level TEXT, -- intern, junior, mid, senior, staff, principal, director, vp, exec
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT DEFAULT 'USD',
  description TEXT,
  apply_url TEXT NOT NULL,
  external_id TEXT, -- the ID from the ATS system
  -- Freshness tracking (core moat)
  first_detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  -- H1B / sponsorship fields
  sponsors_h1b BOOLEAN,
  sponsorship_score INTEGER DEFAULT 0, -- 0-100
  visa_language_detected TEXT, -- raw text extracted from JD about visa
  requires_authorization BOOLEAN DEFAULT false, -- "must be authorized" flag
  -- AI normalized fields
  skills TEXT[], -- extracted skills array
  normalized_title TEXT, -- AI cleaned title
  raw_data JSONB, -- original scraped data + normalization payload snapshots
  job_intelligence JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  -- Job preferences
  desired_roles TEXT[],
  desired_locations TEXT[],
  desired_seniority TEXT[],
  desired_employment_types TEXT[],
  remote_only BOOLEAN DEFAULT false,
  -- International student fields
  is_international BOOLEAN DEFAULT false,
  visa_status TEXT, -- opt, stem_opt, h1b, citizen, green_card, other
  opt_end_date DATE,
  needs_sponsorship BOOLEAN DEFAULT false,
  -- Notification preferences
  alert_frequency TEXT DEFAULT 'instant', -- instant, daily, weekly
  email_alerts BOOLEAN DEFAULT true,
  push_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Watchlist table
-- Companies a user is watching
CREATE TABLE watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

-- 5. Job alerts table
-- Saved search alerts
CREATE TABLE job_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT,
  keywords TEXT[],
  locations TEXT[],
  seniority_levels TEXT[],
  employment_types TEXT[],
  remote_only BOOLEAN DEFAULT false,
  sponsorship_required BOOLEAN DEFAULT false,
  company_ids UUID[],
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Alert notifications table
-- Log of every notification sent
CREATE TABLE alert_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE,
  notification_type TEXT DEFAULT 'alert', -- alert, watchlist
  channel TEXT, -- email, push, both
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  UNIQUE(user_id, job_id)
);

-- 7. Crawl logs table
-- Track every crawl attempt
CREATE TABLE crawl_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT, -- success, failed, unchanged
  jobs_found INTEGER DEFAULT 0,
  new_jobs INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  crawled_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. H1B records table
-- USCIS public petition data
CREATE TABLE h1b_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  employer_name TEXT NOT NULL,
  year INTEGER,
  total_petitions INTEGER,
  approved INTEGER,
  denied INTEGER,
  initial_approvals INTEGER,
  continuing_approvals INTEGER,
  naics_code TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Push subscriptions table
-- Web push subscriptions for instant notifications
CREATE TABLE push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Resumes table
-- Uploaded resumes plus parsed structured data
CREATE TABLE IF NOT EXISTS resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  name TEXT,
  file_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  is_primary BOOLEAN DEFAULT false,
  parse_status TEXT DEFAULT 'pending',
  full_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  summary TEXT,
  work_experience JSONB,
  education JSONB,
  skills JSONB,
  projects JSONB,
  seniority_level TEXT,
  years_of_experience INTEGER,
  primary_role TEXT,
  industries TEXT[],
  top_skills TEXT[],
  resume_score INTEGER,
  raw_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Resume versions table
-- Saved tailored variants of a base resume
CREATE TABLE IF NOT EXISTS resume_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT,
  file_url TEXT,
  snapshot JSONB,
  changes_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Resume edits table
-- AI-generated suggestions plus accept/reject feedback
CREATE TABLE IF NOT EXISTS resume_edits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  original_content TEXT NOT NULL,
  suggested_content TEXT NOT NULL,
  edit_type TEXT,
  keywords_added TEXT[],
  was_accepted BOOLEAN,
  feedback TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Job applications table
-- Per-user tracking for jobs applied to
CREATE TABLE IF NOT EXISTS job_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  cover_letter_id UUID REFERENCES cover_letters(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'saved',
  company_name TEXT NOT NULL,
  company_logo_url TEXT,
  job_title TEXT NOT NULL,
  apply_url TEXT,
  applied_at TIMESTAMPTZ,
  match_score INTEGER,
  notes TEXT,
  follow_up_date DATE,
  salary_expected INTEGER,
  salary_offered INTEGER,
  timeline JSONB DEFAULT '[]'::jsonb,
  interviews JSONB DEFAULT '[]'::jsonb,
  offer_details JSONB,
  application_verdict JSONB,
  is_archived BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'hireoven',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations for existing installations
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS cover_letter_id UUID REFERENCES cover_letters(id) ON DELETE SET NULL;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS company_logo_url TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS interviews JSONB DEFAULT '[]'::jsonb;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS offer_details JSONB;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'hireoven';

-- 14. Match scores table
-- Per-user score cache for ranking and personalization
CREATE TABLE IF NOT EXISTS job_match_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  overall_score INTEGER NOT NULL,
  skills_score INTEGER,
  seniority_score INTEGER,
  location_score INTEGER,
  employment_type_score INTEGER,
  sponsorship_score INTEGER,
  is_seniority_match BOOLEAN,
  is_location_match BOOLEAN,
  is_employment_type_match BOOLEAN,
  is_sponsorship_compatible BOOLEAN,
  matching_skills_count INTEGER DEFAULT 0,
  total_required_skills INTEGER DEFAULT 0,
  skills_match_rate DECIMAL,
  score_method TEXT DEFAULT 'fast',
  score_breakdown JSONB,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  resume_version INTEGER DEFAULT 1,
  UNIQUE(user_id, resume_id, job_id)
);

-- 15. Job normalizations table (optional dedicated store)
-- Canonical normalized payloads and frontend view models by job id.
CREATE TABLE IF NOT EXISTS job_normalizations (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  canonical_payload JSONB NOT NULL,
  page_view_payload JSONB NOT NULL,
  card_view_payload JSONB NOT NULL,
  confidence_score NUMERIC NOT NULL,
  completeness_score NUMERIC NOT NULL,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_jobs_company_id ON jobs(company_id);
CREATE INDEX idx_jobs_first_detected_at ON jobs(first_detected_at DESC);
CREATE INDEX idx_jobs_is_active ON jobs(is_active);
CREATE INDEX idx_jobs_seniority ON jobs(seniority_level);
CREATE INDEX idx_jobs_remote ON jobs(is_remote);
CREATE INDEX idx_jobs_sponsorship ON jobs(sponsors_h1b);
CREATE INDEX idx_jobs_employment_type ON jobs(employment_type);
CREATE INDEX idx_jobs_external_id ON jobs(external_id);
CREATE INDEX idx_jobs_skills ON jobs USING GIN(skills);
CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_ats_type ON companies(ats_type);
CREATE INDEX idx_companies_sponsors_h1b ON companies(sponsors_h1b);
CREATE INDEX idx_watchlist_user ON watchlist(user_id);
CREATE INDEX idx_watchlist_company ON watchlist(company_id);
CREATE INDEX idx_alerts_user ON job_alerts(user_id);
CREATE INDEX idx_alert_notifications_user ON alert_notifications(user_id);
CREATE INDEX idx_alert_notifications_sent_at ON alert_notifications(sent_at DESC);
CREATE INDEX idx_alert_notifications_opened_at ON alert_notifications(opened_at);
CREATE INDEX idx_crawl_logs_company ON crawl_logs(company_id);
CREATE INDEX idx_crawl_logs_crawled_at ON crawl_logs(crawled_at DESC);
CREATE INDEX idx_h1b_records_company ON h1b_records(company_id);
CREATE INDEX idx_h1b_records_year ON h1b_records(year DESC);
-- Enables fast upsert path in the USCIS importer (employer_name, fiscal year
-- pair is the natural key for aggregated petition counts). Run this as a
-- migration on existing databases:
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_h1b_records_employer_year
--     ON h1b_records(employer_name, year);
CREATE UNIQUE INDEX IF NOT EXISTS idx_h1b_records_employer_year
  ON h1b_records(employer_name, year);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint
  ON push_subscriptions ((subscription->>'endpoint'));
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_primary ON resumes(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_resumes_parse_status ON resumes(parse_status);
CREATE INDEX IF NOT EXISTS idx_resume_versions_resume_id ON resume_versions(resume_id);
CREATE INDEX IF NOT EXISTS idx_resume_edits_resume_id ON resume_edits(resume_id);
CREATE INDEX IF NOT EXISTS idx_resume_edits_job_id ON resume_edits(job_id);
CREATE INDEX IF NOT EXISTS idx_resume_edits_user_id ON resume_edits(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_edits_created_at ON resume_edits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_applications_user_id ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_match_scores_user_job ON job_match_scores(user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_score ON job_match_scores(user_id, overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_match_scores_computed ON job_match_scores(user_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_normalizations_source_adapter ON job_normalizations(source_adapter);
CREATE INDEX IF NOT EXISTS idx_job_normalizations_requires_review ON job_normalizations(requires_review);
CREATE INDEX IF NOT EXISTS idx_job_normalizations_confidence ON job_normalizations(confidence_score DESC);

-- =============================================================================
-- Full-text search vectors (run as a migration after initial schema)
-- =============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(normalized_title, '') || ' ' ||
      coalesce(location, '') || ' ' ||
      coalesce(array_to_string(skills, ' '), '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_jobs_search ON jobs USING gin(search_vector);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(industry, '') || ' ' ||
      coalesce(domain, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_companies_search ON companies USING gin(search_vector);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE h1b_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_match_scores ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Watchlist
CREATE POLICY "Users can manage own watchlist"
  ON watchlist FOR ALL USING (auth.uid() = user_id);

-- Job alerts
CREATE POLICY "Users can manage own alerts"
  ON job_alerts FOR ALL USING (auth.uid() = user_id);

-- Alert notifications
CREATE POLICY "Users can view own notifications"
  ON alert_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications"
  ON alert_notifications FOR UPDATE USING (auth.uid() = user_id);

-- Public read for jobs and companies
CREATE POLICY "Jobs are publicly readable"
  ON jobs FOR SELECT USING (true);
CREATE POLICY "Companies are publicly readable"
  ON companies FOR SELECT USING (true);

-- Crawl logs and H1B records: service role only (no public/user access)
CREATE POLICY "Service role can manage crawl logs"
  ON crawl_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage h1b records"
  ON h1b_records FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Users can manage own push subscriptions"
  ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resumes'
      AND policyname = 'Users manage own resumes'
  ) THEN
    CREATE POLICY "Users manage own resumes"
      ON resumes FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_versions'
      AND policyname = 'Users manage own versions'
  ) THEN
    CREATE POLICY "Users manage own versions"
      ON resume_versions FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_applications'
      AND policyname = 'Users manage own applications'
  ) THEN
    CREATE POLICY "Users manage own applications"
      ON job_applications FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_edits'
      AND policyname = 'Users manage own edits'
  ) THEN
    CREATE POLICY "Users manage own edits"
      ON resume_edits FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_match_scores'
      AND policyname = 'Users view own scores'
  ) THEN
    CREATE POLICY "Users view own scores"
      ON job_match_scores FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 14. Autofill profile table
CREATE TABLE IF NOT EXISTS autofill_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT DEFAULT 'United States',
  linkedin_url TEXT,
  github_url TEXT,
  portfolio_url TEXT,
  website_url TEXT,
  work_authorization TEXT,
  requires_sponsorship BOOLEAN DEFAULT false,
  authorized_to_work BOOLEAN DEFAULT true,
  sponsorship_statement TEXT,
  years_of_experience INTEGER,
  salary_expectation_min INTEGER,
  salary_expectation_max INTEGER,
  earliest_start_date TEXT,
  willing_to_relocate BOOLEAN DEFAULT false,
  preferred_work_type TEXT,
  custom_answers JSONB DEFAULT '[]',
  highest_degree TEXT,
  field_of_study TEXT,
  university TEXT,
  graduation_year INTEGER,
  gpa TEXT,
  gender TEXT,
  ethnicity TEXT,
  veteran_status TEXT,
  disability_status TEXT,
  auto_fill_diversity BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Autofill history table
CREATE TABLE IF NOT EXISTS autofill_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  company_name TEXT,
  job_title TEXT,
  ats_type TEXT,
  fields_filled INTEGER DEFAULT 0,
  fields_total INTEGER DEFAULT 0,
  fill_rate DECIMAL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE autofill_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own autofill profile"
  ON autofill_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users view own autofill history"
  ON autofill_history FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_autofill_profiles_user ON autofill_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_autofill_history_user ON autofill_history(user_id);
CREATE INDEX IF NOT EXISTS idx_autofill_history_applied ON autofill_history(applied_at DESC);

-- 16. Cover letters table
CREATE TABLE IF NOT EXISTS cover_letters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  hiring_manager TEXT,
  subject_line TEXT,
  body TEXT NOT NULL,
  word_count INTEGER,
  tone TEXT DEFAULT 'professional',
  length TEXT DEFAULT 'medium',
  style TEXT DEFAULT 'story',
  version_number INTEGER DEFAULT 1,
  is_favorite BOOLEAN DEFAULT false,
  was_used BOOLEAN DEFAULT false,
  mentions_sponsorship BOOLEAN DEFAULT false,
  sponsorship_approach TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cover_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own cover letters"
  ON cover_letters FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cover_letters_user ON cover_letters(user_id);
CREATE INDEX IF NOT EXISTS idx_cover_letters_job ON cover_letters(user_id, job_id);

-- =============================================================================
-- Functions & Triggers
-- =============================================================================

-- Auto-update updated_at on companies
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS resumes_updated_at ON resumes;
CREATE TRIGGER resumes_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS job_applications_updated_at ON job_applications;
CREATE TRIGGER job_applications_updated_at
  BEFORE UPDATE ON job_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile row when a new auth user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- Admin additions (run as migration after initial schema)
-- =============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS seniority_level TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS top_skills TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS desired_employment_types TEXT[];
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ats_identifier TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS raw_ats_config JSONB DEFAULT '{}'::jsonb;

-- 10. API usage table - track Claude, Resend, and push-notification calls
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service TEXT NOT NULL, -- claude, resend, webpush
  operation TEXT,        -- normalize, detect_visa, email, push
  tokens_used INTEGER,
  cost_usd DECIMAL(10,6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage(service);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at DESC);

ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage api_usage"
  ON api_usage FOR ALL USING (auth.role() = 'service_role');

-- 11. System settings table - lightweight config store for admin controls
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_at
  ON system_settings(updated_at DESC);

-- Security-definer helper so RLS policies can check admin status
-- without recursive RLS on profiles
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.is_admin_user() TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'h1b_records'
      AND policyname = 'H1B records are publicly readable'
  ) THEN
    CREATE POLICY "H1B records are publicly readable"
      ON h1b_records FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Admins can read all profiles'
  ) THEN
    CREATE POLICY "Admins can read all profiles"
      ON profiles FOR SELECT
      USING (auth.uid() = id OR public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Admins can update all profiles'
  ) THEN
    CREATE POLICY "Admins can update all profiles"
      ON profiles FOR UPDATE
      USING (auth.uid() = id OR public.is_admin_user())
      WITH CHECK (auth.uid() = id OR public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'watchlist'
      AND policyname = 'Admins can manage watchlist'
  ) THEN
    CREATE POLICY "Admins can manage watchlist"
      ON watchlist FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_alerts'
      AND policyname = 'Admins can manage job alerts'
  ) THEN
    CREATE POLICY "Admins can manage job alerts"
      ON job_alerts FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_notifications'
      AND policyname = 'Admins can manage alert notifications'
  ) THEN
    CREATE POLICY "Admins can manage alert notifications"
      ON alert_notifications FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies'
      AND policyname = 'Admins can manage companies'
  ) THEN
    CREATE POLICY "Admins can manage companies"
      ON companies FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs'
      AND policyname = 'Admins can manage jobs'
  ) THEN
    CREATE POLICY "Admins can manage jobs"
      ON jobs FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'crawl_logs'
      AND policyname = 'Admins can manage crawl logs'
  ) THEN
    CREATE POLICY "Admins can manage crawl logs"
      ON crawl_logs FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'h1b_records'
      AND policyname = 'Admins can manage h1b records'
  ) THEN
    CREATE POLICY "Admins can manage h1b records"
      ON h1b_records FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
      AND policyname = 'Admins can manage push subscriptions'
  ) THEN
    CREATE POLICY "Admins can manage push subscriptions"
      ON push_subscriptions FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_usage'
      AND policyname = 'Admins can read api_usage'
  ) THEN
    CREATE POLICY "Admins can read api_usage"
      ON api_usage FOR SELECT
      USING (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'system_settings'
      AND policyname = 'Admins can manage system settings'
  ) THEN
    CREATE POLICY "Admins can manage system settings"
      ON system_settings FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;
END $$;

-- =============================================================================
-- Subscriptions table
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'pro_international')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'canceled', 'past_due', 'unpaid')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  billing_interval TEXT DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'yearly')),
  amount_cents INTEGER,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  cancellation_feedback JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT DEFAULT 'monthly';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount_cents INTEGER;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancellation_feedback JSONB;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'Users can view own subscription'
  ) THEN
    CREATE POLICY "Users can view own subscription"
      ON subscriptions FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- =============================================================================
-- Waitlist (pre-launch marketing)
-- =============================================================================
-- Captured via /launch; accessed only from server (service role) in API routes.
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  source TEXT DEFAULT 'launch_page',
  referrer TEXT,
  is_international BOOLEAN,
  visa_status TEXT,
  university TEXT,
  metadata JSONB,
  confirmed BOOLEAN DEFAULT false,
  confirmation_token TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_joined_at ON waitlist(joined_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_confirmation_token ON waitlist(confirmation_token) WHERE confirmation_token IS NOT NULL;

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated clients cannot read/write; service role bypasses RLS.

-- =============================================================================
-- Marketing foundation
-- =============================================================================

CREATE TABLE IF NOT EXISTS marketing_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  source TEXT DEFAULT 'app',
  subscribed_to_marketing BOOLEAN DEFAULT true,
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_token TEXT UNIQUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID REFERENCES profiles(id),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  segment TEXT DEFAULT 'all',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  total_recipients INTEGER DEFAULT 0,
  total_sent INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaign_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES marketing_subscribers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_email
  ON marketing_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_subscribed
  ON marketing_subscribers(subscribed_to_marketing);
CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_token
  ON marketing_subscribers(unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_at
  ON marketing_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_sends_campaign_id
  ON marketing_campaign_sends(campaign_id);

ALTER TABLE marketing_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketing_subscribers'
      AND policyname = 'Admins can manage marketing subscribers'
  ) THEN
    CREATE POLICY "Admins can manage marketing subscribers"
      ON marketing_subscribers FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketing_campaigns'
      AND policyname = 'Admins can manage marketing campaigns'
  ) THEN
    CREATE POLICY "Admins can manage marketing campaigns"
      ON marketing_campaigns FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketing_campaign_sends'
      AND policyname = 'Admins can manage marketing campaign sends'
  ) THEN
    CREATE POLICY "Admins can manage marketing campaign sends"
      ON marketing_campaign_sends FOR ALL
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());
  END IF;
END $$;

-- =============================================================================
-- DOL LCA data (H1B approval prediction engine)
-- =============================================================================
-- `h1b_records` (above) holds aggregated USCIS employer-level petition data.
-- `lca_records` holds Department of Labor LCA disclosures - one row per filing,
-- including job title / SOC code / worksite / wage level / decision. This is
-- the input data the prediction engine uses. `employer_lca_stats` is a
-- pre-aggregated cache so we do not have to re-scan millions of rows at query
-- time.

CREATE TABLE IF NOT EXISTS lca_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Employer info
  employer_name TEXT NOT NULL,
  employer_name_normalized TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- Job details
  job_title TEXT,
  soc_code TEXT,
  soc_title TEXT,
  -- Location
  worksite_city TEXT,
  worksite_state TEXT,
  worksite_state_abbr TEXT,
  -- Wage info
  wage_rate_from DECIMAL,
  wage_rate_to DECIMAL,
  wage_unit TEXT,
  prevailing_wage DECIMAL,
  prevailing_wage_unit TEXT,
  wage_level TEXT,
  -- Decision
  case_status TEXT,
  decision_date DATE,
  -- Filing details
  visa_class TEXT DEFAULT 'H-1B',
  employment_start_date DATE,
  employment_end_date DATE,
  full_time_position BOOLEAN,
  -- NAICS
  naics_code TEXT,
  -- Year for trend analysis
  fiscal_year INTEGER,
  -- Dedup key (composed from DOL case number when available so re-imports
  -- skip duplicates instead of multiplying rows).
  source_case_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lca_employer
  ON lca_records(employer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_lca_company
  ON lca_records(company_id);
CREATE INDEX IF NOT EXISTS idx_lca_state
  ON lca_records(worksite_state_abbr);
CREATE INDEX IF NOT EXISTS idx_lca_soc
  ON lca_records(soc_code);
CREATE INDEX IF NOT EXISTS idx_lca_year
  ON lca_records(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_lca_status
  ON lca_records(case_status);
-- Full (not partial) unique index: rows where source_case_number IS NULL
-- are treated as distinct by Postgres under default NULL semantics, so they
-- won't collide. The importer still handles the NULL case by using a plain
-- INSERT instead of an upsert. A partial unique index with WHERE cannot
-- back an ON CONFLICT target via PostgREST's upsert, so keep this full.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lca_case_year
  ON lca_records(source_case_number, fiscal_year);

CREATE TABLE IF NOT EXISTS employer_lca_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employer_name_normalized TEXT UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  display_name TEXT,
  -- Overall stats
  total_applications INTEGER DEFAULT 0,
  total_certified INTEGER DEFAULT 0,
  total_denied INTEGER DEFAULT 0,
  total_withdrawn INTEGER DEFAULT 0,
  certification_rate DECIMAL,
  -- By year (last 3 years) / wage level / titles / states
  stats_by_year JSONB DEFAULT '{}'::jsonb,
  stats_by_wage_level JSONB DEFAULT '{}'::jsonb,
  top_job_titles JSONB DEFAULT '[]'::jsonb,
  top_states JSONB DEFAULT '[]'::jsonb,
  -- Risk flags
  is_staffing_firm BOOLEAN DEFAULT false,
  is_consulting_firm BOOLEAN DEFAULT false,
  has_high_denial_rate BOOLEAN DEFAULT false,
  is_first_time_filer BOOLEAN DEFAULT false,
  -- Trend
  approval_trend TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employer_stats_company
  ON employer_lca_stats(company_id);
CREATE INDEX IF NOT EXISTS idx_employer_stats_rate
  ON employer_lca_stats(certification_rate DESC);

ALTER TABLE lca_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_lca_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lca_records'
      AND policyname = 'LCA records are publicly readable'
  ) THEN
    CREATE POLICY "LCA records are publicly readable"
      ON lca_records FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lca_records'
      AND policyname = 'Admins manage lca records'
  ) THEN
    CREATE POLICY "Admins manage lca records"
      ON lca_records FOR ALL
      USING (public.is_admin_user() OR auth.role() = 'service_role')
      WITH CHECK (public.is_admin_user() OR auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employer_lca_stats'
      AND policyname = 'Employer stats are publicly readable'
  ) THEN
    CREATE POLICY "Employer stats are publicly readable"
      ON employer_lca_stats FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employer_lca_stats'
      AND policyname = 'Admins manage employer stats'
  ) THEN
    CREATE POLICY "Admins manage employer stats"
      ON employer_lca_stats FOR ALL
      USING (public.is_admin_user() OR auth.role() = 'service_role')
      WITH CHECK (public.is_admin_user() OR auth.role() = 'service_role');
  END IF;
END $$;

-- Cache prediction results per job (so batch/feed renders are cheap).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS h1b_prediction JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS h1b_prediction_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_intelligence JSONB;

-- Optional snapshots for the additive job intelligence layer. Existing reads
-- should continue to rely on their current columns until APIs opt in.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS immigration_profile_summary JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS hiring_health JSONB;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS application_verdict JSONB;
ALTER TABLE job_match_scores ADD COLUMN IF NOT EXISTS score_breakdown JSONB;

-- Expose the employer display name on the aggregate so admin UIs can show it
-- without re-joining to lca_records.
ALTER TABLE employer_lca_stats ADD COLUMN IF NOT EXISTS display_name TEXT;

-- SOC-code base rates - precomputed by the LCA importer so the H1B predictor
-- can form its Bayesian prior without scanning `lca_records` on every call.
-- One row per normalized 6-digit SOC code (e.g. "15-1252").
CREATE TABLE IF NOT EXISTS soc_base_rates (
  soc_code TEXT PRIMARY KEY,
  soc_title TEXT,
  total_applications INTEGER NOT NULL DEFAULT 0,
  total_certified INTEGER NOT NULL DEFAULT 0,
  total_denied INTEGER NOT NULL DEFAULT 0,
  approval_rate DECIMAL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soc_base_rates_sample_size
  ON soc_base_rates(sample_size DESC);

ALTER TABLE soc_base_rates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'soc_base_rates'
      AND policyname = 'SOC base rates are publicly readable'
  ) THEN
    CREATE POLICY "SOC base rates are publicly readable"
      ON soc_base_rates FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'soc_base_rates'
      AND policyname = 'Admins manage soc base rates'
  ) THEN
    CREATE POLICY "Admins manage soc base rates"
      ON soc_base_rates FOR ALL
      USING (public.is_admin_user() OR auth.role() = 'service_role')
      WITH CHECK (public.is_admin_user() OR auth.role() = 'service_role');
  END IF;
END $$;
