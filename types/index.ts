// =============================================================================
// Hireoven — TypeScript types matching the Supabase schema
// NOTE: Must use `type` aliases (not `interface`) so they satisfy
// `Record<string, unknown>` in Supabase SDK v2.100+ conditional types.
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

export type NotificationType = 'alert' | 'watchlist';

export type CrawlStatus = 'success' | 'failed' | 'unchanged';

export type JobWithinWindow = 'all' | '1h' | '6h' | '24h' | '3d';

export type JobSortOption = 'freshest' | 'match' | 'relevant';

export type ResumeParseStatus = 'pending' | 'processing' | 'complete' | 'failed';

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export type AnalysisVerdict = 'strong_match' | 'good_match' | 'partial_match' | 'weak_match';

export type ApplyRecommendation = 'apply_now' | 'apply_with_tweaks' | 'stretch_role' | 'skip';

export type AnalysisRecommendation = {
  priority: 'high' | 'medium' | 'low';
  category: 'skills' | 'experience' | 'keywords' | 'format';
  issue: string;
  fix: string;
};

export type ExperienceMatch = {
  required_years: number | null;
  candidate_years: number;
  matching_roles: string[];
  gaps: string[];
};

export type ResumeAnalysis = {
  id: string;
  user_id: string;
  resume_id: string;
  job_id: string;
  overall_score: number | null;
  skills_score: number | null;
  experience_score: number | null;
  education_score: number | null;
  keywords_score: number | null;
  matching_skills: string[] | null;
  missing_skills: string[] | null;
  bonus_skills: string[] | null;
  matching_keywords: string[] | null;
  missing_keywords: string[] | null;
  keyword_density: Record<string, number> | null;
  experience_match: ExperienceMatch | null;
  recommendations: AnalysisRecommendation[] | null;
  verdict: AnalysisVerdict | null;
  verdict_summary: string | null;
  apply_recommendation: ApplyRecommendation | null;
  apply_reasoning: string | null;
  created_at: string;
};

export type ResumeAnalysisInsert = Omit<ResumeAnalysis, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export type Company = {
  id: string;
  name: string;
  domain: string;
  logo_url: string | null;
  industry: string | null;
  size: CompanySize | null;
  careers_url: string;
  ats_type: AtsType | null;
  ats_identifier: string | null;
  is_active: boolean;
  last_crawled_at: string | null;
  job_count: number;
  notes: string | null;
  raw_ats_config: Record<string, unknown> | null;
  h1b_sponsor_count_1yr: number;
  h1b_sponsor_count_3yr: number;
  sponsors_h1b: boolean;
  sponsorship_confidence: number;
  created_at: string;
  updated_at: string;
};

export type CompanyInsert = Omit<Company, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CompanyUpdate = Partial<CompanyInsert>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type Job = {
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
  first_detected_at: string;
  last_seen_at: string;
  is_active: boolean;
  sponsors_h1b: boolean | null;
  sponsorship_score: number;
  visa_language_detected: string | null;
  requires_authorization: boolean;
  skills: string[] | null;
  normalized_title: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type JobInsert = Omit<Job, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type JobUpdate = Partial<JobInsert>;

export type JobWithCompany = Job & { company: Company };

// ---------------------------------------------------------------------------
// Profiles (extends auth.users)
// ---------------------------------------------------------------------------

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  desired_roles: string[] | null;
  desired_locations: string[] | null;
  desired_seniority: SeniorityLevel[] | null;
  seniority_level: SeniorityLevel | null;
  top_skills: string[] | null;
  remote_only: boolean;
  is_international: boolean;
  visa_status: VisaStatus | null;
  opt_end_date: string | null;
  needs_sponsorship: boolean;
  alert_frequency: AlertFrequency;
  email_alerts: boolean;
  push_alerts: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = Pick<Profile, 'id'> &
  Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>> & {
    created_at?: string;
    updated_at?: string;
  };

export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export type WorkExperience = {
  company: string;
  title: string;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  description: string;
  achievements: string[];
};

export type Education = {
  institution: string;
  degree: string;
  field: string;
  start_date: string;
  end_date: string | null;
  gpa: string | null;
};

export type Skills = {
  technical: string[];
  soft: string[];
  languages: string[];
  certifications: string[];
};

export type Project = {
  name: string;
  description: string;
  url: string | null;
  technologies: string[];
};

export type ParsedResume = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  summary: string | null;
  work_experience: WorkExperience[];
  education: Education[];
  skills: Skills;
  projects: Project[];
  seniority_level: SeniorityLevel | null;
  years_of_experience: number | null;
  primary_role: string | null;
  industries: string[];
  top_skills: string[];
  resume_score: number | null;
  raw_text: string;
};

export type Resume = {
  id: string;
  user_id: string;
  file_name: string;
  name: string | null;
  file_url: string;
  storage_path: string;
  file_size: number | null;
  is_primary: boolean;
  parse_status: ResumeParseStatus;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  summary: string | null;
  work_experience: WorkExperience[] | null;
  education: Education[] | null;
  skills: Skills | null;
  projects: Project[] | null;
  seniority_level: SeniorityLevel | null;
  years_of_experience: number | null;
  primary_role: string | null;
  industries: string[] | null;
  top_skills: string[] | null;
  resume_score: number | null;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
};

export type ResumeInsert = Omit<Resume, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ResumeUpdate = Partial<ResumeInsert>;

export type ResumeVersion = {
  id: string;
  resume_id: string;
  user_id: string;
  version_number: number;
  name: string | null;
  file_url: string | null;
  changes_summary: string | null;
  created_at: string;
};

export type ResumeVersionInsert = Omit<ResumeVersion, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type JobApplicationTimelineItem = {
  status: ApplicationStatus;
  date: string;
  note: string | null;
};

export type JobApplication = {
  id: string;
  user_id: string;
  job_id: string | null;
  resume_id: string | null;
  status: ApplicationStatus;
  company_name: string;
  job_title: string;
  apply_url: string | null;
  applied_at: string | null;
  match_score: number | null;
  cover_letter: string | null;
  notes: string | null;
  follow_up_date: string | null;
  salary_expected: number | null;
  salary_offered: number | null;
  timeline: JobApplicationTimelineItem[];
  created_at: string;
  updated_at: string;
};

export type JobApplicationInsert = Omit<JobApplication, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type JobApplicationUpdate = Partial<JobApplicationInsert>;

// ---------------------------------------------------------------------------
// API Usage
// ---------------------------------------------------------------------------

export type ApiUsage = {
  id: string;
  service: string;
  operation: string | null;
  tokens_used: number | null;
  cost_usd: number | null;
  created_at: string;
};

export type ApiUsageInsert = Omit<ApiUsage, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type SystemSetting = {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
};

export type SystemSettingInsert = Omit<SystemSetting, 'updated_at'> & {
  updated_at?: string;
};

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export type Watchlist = {
  id: string;
  user_id: string;
  company_id: string;
  created_at: string;
};

export type WatchlistInsert = Omit<Watchlist, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type WatchlistWithCompany = Watchlist & { company: Company };

// ---------------------------------------------------------------------------
// Job Alerts
// ---------------------------------------------------------------------------

export type JobAlert = {
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
};

export type JobAlertInsert = Omit<JobAlert, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type JobAlertUpdate = Partial<JobAlertInsert>;

// ---------------------------------------------------------------------------
// Alert Notifications
// ---------------------------------------------------------------------------

export type AlertNotification = {
  id: string;
  user_id: string;
  job_id: string;
  alert_id: string | null;
  notification_type: NotificationType;
  channel: NotificationChannel;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
};

export type AlertNotificationInsert = Omit<AlertNotification, 'id' | 'sent_at' | 'opened_at' | 'clicked_at'> & {
  id?: string;
  sent_at?: string;
  opened_at?: string | null;
  clicked_at?: string | null;
};

export type AlertNotificationWithDetails = AlertNotification & {
  job: JobWithCompany;
  alert: JobAlert | null;
};

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

export type WebPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export type PushSubscriptionRecord = {
  id: string;
  user_id: string;
  subscription: WebPushSubscription;
  created_at: string;
};

export type PushSubscriptionInsert = Omit<PushSubscriptionRecord, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// Crawl Logs
// ---------------------------------------------------------------------------

export type CrawlLog = {
  id: string;
  company_id: string;
  status: CrawlStatus;
  jobs_found: number;
  new_jobs: number;
  error_message: string | null;
  duration_ms: number | null;
  crawled_at: string;
};

export type CrawlLogInsert = Omit<CrawlLog, 'id' | 'crawled_at'> & {
  id?: string;
  crawled_at?: string;
};

// ---------------------------------------------------------------------------
// H1B Records
// ---------------------------------------------------------------------------

export type H1BRecord = {
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
};

export type H1BRecordInsert = Omit<H1BRecord, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// UI filter state
// ---------------------------------------------------------------------------

export type JobFilters = {
  remote?: boolean;
  sponsorship?: boolean;
  seniority?: SeniorityLevel[];
  employment_type?: EmploymentType[];
  within?: JobWithinWindow;
  company_ids?: string[];
  sort?: JobSortOption;
};

// ---------------------------------------------------------------------------
// Supabase Database type map (for typed client usage)
// ---------------------------------------------------------------------------

type TableDefinition<Row extends Record<string, unknown>, Insert extends Record<string, unknown>, Update extends Record<string, unknown>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: never[];
};

export type Database = {
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
      resumes: TableDefinition<Resume, ResumeInsert, ResumeUpdate>;
      resume_versions: TableDefinition<
        ResumeVersion,
        ResumeVersionInsert,
        Partial<ResumeVersionInsert>
      >;
      job_applications: TableDefinition<
        JobApplication,
        JobApplicationInsert,
        JobApplicationUpdate
      >;
      crawl_logs: TableDefinition<CrawlLog, CrawlLogInsert, Partial<CrawlLogInsert>>;
      h1b_records: TableDefinition<H1BRecord, H1BRecordInsert, Partial<H1BRecordInsert>>;
      push_subscriptions: TableDefinition<
        PushSubscriptionRecord,
        PushSubscriptionInsert,
        Partial<PushSubscriptionInsert>
      >;
      api_usage: TableDefinition<ApiUsage, ApiUsageInsert, Partial<ApiUsageInsert>>;
      system_settings: TableDefinition<
        SystemSetting,
        SystemSettingInsert,
        Partial<SystemSettingInsert>
      >;
      resume_analyses: TableDefinition<ResumeAnalysis, ResumeAnalysisInsert, Partial<ResumeAnalysisInsert>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
