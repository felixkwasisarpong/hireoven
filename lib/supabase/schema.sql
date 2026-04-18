-- =============================================================================
-- Hireoven — Supabase Database Schema
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
  raw_data JSONB, -- original scraped data
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
  changes_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Job applications table
-- Per-user tracking for jobs applied to
CREATE TABLE IF NOT EXISTS job_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'saved',
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  apply_url TEXT,
  applied_at TIMESTAMPTZ,
  match_score INTEGER,
  cover_letter TEXT,
  notes TEXT,
  follow_up_date DATE,
  salary_expected INTEGER,
  salary_offered INTEGER,
  timeline JSONB DEFAULT '[]'::jsonb,
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
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint
  ON push_subscriptions ((subscription->>'endpoint'));
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_primary ON resumes(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_resumes_parse_status ON resumes(parse_status);
CREATE INDEX IF NOT EXISTS idx_resume_versions_resume_id ON resume_versions(resume_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_user_id ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);

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
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

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
END $$;

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
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ats_identifier TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS raw_ats_config JSONB DEFAULT '{}'::jsonb;

-- 10. API usage table — track Claude, Resend, and push-notification calls
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

-- 11. System settings table — lightweight config store for admin controls
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
