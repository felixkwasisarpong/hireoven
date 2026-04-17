// =============================================================================
// Hireoven — TypeScript interfaces matching the Supabase schema
// =============================================================================

// ---------------------------------------------------------------------------
// Shared enums / union types
// ---------------------------------------------------------------------------

export type CompanySize = 'startup' | 'small' | 'medium' | 'large' | 'enterprise';

export type AtsType =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'icims'
  | 'bamboohr'
  | 'ashby'
  | 'custom';

export type EmploymentType = 'fulltime' | 'parttime' | 'contract' | 'internship';

export type SeniorityLevel =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'director'
  | 'vp'
  | 'exec';

export type VisaStatus =
  | 'opt'
  | 'stem_opt'
  | 'h1b'
  | 'citizen'
  | 'green_card'
  | 'other';

export type AlertFrequency = 'instant' | 'daily' | 'weekly';

export type NotificationChannel = 'email' | 'push' | 'both';

export type CrawlStatus = 'success' | 'failed' | 'unchanged';

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface Company {
  id: string;
  name: string;
  domain: string;
  logo_url: string | null;
  industry: string | null;
  size: CompanySize | null;
  careers_url: string;
  ats_type: AtsType | null;
  is_active: boolean;
  last_crawled_at: string | null;
  job_count: number;
  // H1B / sponsorship
  h1b_sponsor_count_1yr: number;
  h1b_sponsor_count_3yr: number;
  sponsors_h1b: boolean;
  sponsorship_confidence: number; // 0-100
  created_at: string;
  updated_at: string;
}

export type CompanyInsert = Omit<Company, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CompanyUpdate = Partial<CompanyInsert>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  company_id: string;
  title: string;
  department: string | null;
  location: string | null;
  is_remote: boolean;
  is_hybrid: boolean;
  employment_type: EmploymentType | null;
  seniority_level: SeniorityLevel | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  description: string | null;
  apply_url: string;
  external_id: string | null;
  // Freshness tracking
  first_detected_at: string;
  last_seen_at: string;
  is_active: boolean;
  // H1B / sponsorship
  sponsors_h1b: boolean | null;
  sponsorship_score: number; // 0-100
  visa_language_detected: string | null;
  requires_authorization: boolean;
  // AI normalized fields
  skills: string[] | null;
  normalized_title: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type JobInsert = Omit<Job, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type JobUpdate = Partial<JobInsert>;

/** Job row with the related company joined in */
export interface JobWithCompany extends Job {
  company: Company;
}

// ---------------------------------------------------------------------------
// Profiles (extends auth.users)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string; // matches auth.users.id
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  // Job preferences
  desired_roles: string[] | null;
  desired_locations: string[] | null;
  desired_seniority: SeniorityLevel[] | null;
  remote_only: boolean;
  // International student fields
  is_international: boolean;
  visa_status: VisaStatus | null;
  opt_end_date: string | null; // ISO date string
  needs_sponsorship: boolean;
  // Notification preferences
  alert_frequency: AlertFrequency;
  email_alerts: boolean;
  push_alerts: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileInsert = Pick<Profile, 'id'> &
  Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>> & {
    created_at?: string;
    updated_at?: string;
  };

export type ProfileUpdate = Partial<
  Omit<Profile, 'id' | 'created_at' | 'updated_at'>
>;

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface Watchlist {
  id: string;
  user_id: string;
  company_id: string;
  created_at: string;
}

export type WatchlistInsert = Omit<Watchlist, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

/** Watchlist row with company joined in */
export interface WatchlistWithCompany extends Watchlist {
  company: Company;
}

// ---------------------------------------------------------------------------
// Job Alerts
// ---------------------------------------------------------------------------

export interface JobAlert {
  id: string;
  user_id: string;
  name: string | null;
  keywords: string[] | null;
  locations: string[] | null;
  seniority_levels: SeniorityLevel[] | null;
  employment_types: EmploymentType[] | null;
  remote_only: boolean;
  sponsorship_required: boolean;
  company_ids: string[] | null;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export type JobAlertInsert = Omit<JobAlert, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type JobAlertUpdate = Partial<JobAlertInsert>;

// ---------------------------------------------------------------------------
// Alert Notifications
// ---------------------------------------------------------------------------

export interface AlertNotification {
  id: string;
  user_id: string;
  job_id: string;
  alert_id: string;
  channel: NotificationChannel;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
}

export type AlertNotificationInsert = Omit<AlertNotification, 'id' | 'sent_at'> & {
  id?: string;
  sent_at?: string;
};

/** Notification row with job and alert joined in */
export interface AlertNotificationWithDetails extends AlertNotification {
  job: JobWithCompany;
  alert: JobAlert;
}

// ---------------------------------------------------------------------------
// Crawl Logs
// ---------------------------------------------------------------------------

export interface CrawlLog {
  id: string;
  company_id: string;
  status: CrawlStatus;
  jobs_found: number;
  new_jobs: number;
  error_message: string | null;
  duration_ms: number | null;
  crawled_at: string;
}

export type CrawlLogInsert = Omit<CrawlLog, 'id' | 'crawled_at'> & {
  id?: string;
  crawled_at?: string;
};

// ---------------------------------------------------------------------------
// H1B Records
// ---------------------------------------------------------------------------

export interface H1BRecord {
  id: string;
  company_id: string | null;
  employer_name: string;
  year: number | null;
  total_petitions: number | null;
  approved: number | null;
  denied: number | null;
  initial_approvals: number | null;
  continuing_approvals: number | null;
  naics_code: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

export type H1BRecordInsert = Omit<H1BRecord, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// Supabase Database type map (for typed client usage)
// ---------------------------------------------------------------------------

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      companies: TableDefinition<Company, CompanyInsert, CompanyUpdate>;
      jobs: TableDefinition<Job, JobInsert, JobUpdate>;
      profiles: TableDefinition<Profile, ProfileInsert, ProfileUpdate>;
      watchlist: TableDefinition<Watchlist, WatchlistInsert, Partial<WatchlistInsert>>;
      job_alerts: TableDefinition<JobAlert, JobAlertInsert, JobAlertUpdate>;
      alert_notifications: TableDefinition<
        AlertNotification,
        AlertNotificationInsert,
        Partial<AlertNotificationInsert>
      >;
      crawl_logs: TableDefinition<CrawlLog, CrawlLogInsert, Partial<CrawlLogInsert>>;
      h1b_records: TableDefinition<H1BRecord, H1BRecordInsert, Partial<H1BRecordInsert>>;
    };
    Views: {};
    Functions: {};
  };
}
