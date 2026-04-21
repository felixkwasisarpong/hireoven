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
export type ScoreMethod = 'fast' | 'deep';

export type ResumeEditType =
  | 'rewrite'
  | 'keyword_inject'
  | 'quantify'
  | 'expand'
  | 'shorten';

export type ResumeSection =
  | 'summary'
  | 'work_experience'
  | 'skills'
  | 'education'
  | 'projects';

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'final_round'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export type TimelineEntryType =
  | 'status_change'
  | 'note'
  | 'interview_scheduled'
  | 'offer_received'
  | 'rejection_received';

export type TimelineEntry = {
  id: string;
  type: TimelineEntryType;
  status?: ApplicationStatus;
  note?: string;
  date: string;
  auto: boolean;
};

export type InterviewFormat = 'phone' | 'video' | 'in_person' | 'take_home';
export type InterviewOutcome = 'pending' | 'passed' | 'failed' | 'unknown';

export type InterviewRound = {
  id: string;
  round_name: string;
  date?: string;
  format: InterviewFormat;
  interviewer?: string;
  notes?: string;
  outcome: InterviewOutcome;
};

export type OfferDetails = {
  base_salary?: number;
  equity?: string;
  signing_bonus?: number;
  annual_bonus_target?: number;
  benefits_notes?: string;
  offer_deadline?: string;
};

export type JobApplication = {
  id: string;
  user_id: string;
  job_id: string | null;
  resume_id: string | null;
  status: ApplicationStatus;
  company_name: string;
  company_logo_url: string | null;
  /** Enriched on read — company domain for logo fallbacks (favicon / Clearbit chain). */
  company_domain?: string | null;
  job_title: string;
  apply_url: string | null;
  applied_at: string | null;
  match_score: number | null;
  cover_letter_id: string | null;
  notes: string | null;
  follow_up_date: string | null;
  salary_expected: number | null;
  salary_offered: number | null;
  timeline: TimelineEntry[];
  interviews: InterviewRound[];
  offer_details: OfferDetails | null;
  is_archived: boolean;
  source: string;
  created_at: string;
  updated_at: string;
};

export type JobApplicationInsert = Omit<JobApplication, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type PipelineStats = {
  total: number;
  by_status: Record<ApplicationStatus, number>;
  conversion_rates: {
    applied_to_phone: number;
    phone_to_interview: number;
    interview_to_offer: number;
    overall: number;
  };
  avg_days_to_response: number;
  avg_days_in_interview: number;
  applications_this_week: number;
  applications_this_month: number;
  response_rate: number;
};

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

// ---------------------------------------------------------------------------
// Autofill
// ---------------------------------------------------------------------------

export type WorkAuthorization =
  | 'us_citizen'
  | 'green_card'
  | 'h1b'
  | 'opt'
  | 'stem_opt'
  | 'tn_visa'
  | 'other'
  | 'require_sponsorship';

export type PreferredWorkType = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export type CustomAnswer = {
  question_pattern: string;
  answer: string;
};

export type AutofillProfile = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  website_url: string | null;
  work_authorization: WorkAuthorization | null;
  requires_sponsorship: boolean;
  authorized_to_work: boolean;
  sponsorship_statement: string | null;
  years_of_experience: number | null;
  salary_expectation_min: number | null;
  salary_expectation_max: number | null;
  earliest_start_date: string | null;
  willing_to_relocate: boolean;
  preferred_work_type: PreferredWorkType | null;
  custom_answers: CustomAnswer[];
  highest_degree: string | null;
  field_of_study: string | null;
  university: string | null;
  graduation_year: number | null;
  gpa: string | null;
  gender: string | null;
  ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;
  auto_fill_diversity: boolean;
  created_at: string;
  updated_at: string;
};

export type AutofillProfileInsert = Omit<AutofillProfile, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AutofillProfileUpdate = Partial<AutofillProfileInsert>;

export type AutofillHistory = {
  id: string;
  user_id: string;
  job_id: string | null;
  company_name: string | null;
  job_title: string | null;
  ats_type: string | null;
  fields_filled: number;
  fields_total: number;
  fill_rate: number | null;
  applied_at: string;
};

export type AutofillHistoryInsert = Omit<AutofillHistory, 'id' | 'applied_at'> & {
  id?: string;
  applied_at?: string;
};

// ---------------------------------------------------------------------------
// Cover letter types
// ---------------------------------------------------------------------------

export type CoverLetterTone = 'professional' | 'conversational' | 'enthusiastic' | 'formal';
export type CoverLetterLength = 'short' | 'medium' | 'long';
export type CoverLetterStyle = 'story' | 'skills_focused' | 'achievement_focused';
export type SponsorshipApproach = 'proactive' | 'on_request' | 'omit';

// CoverLetterOptions defined after ResumeAnalysis — see below
export type CoverLetterOptionsBase = {
  tone: CoverLetterTone;
  length: CoverLetterLength;
  style: CoverLetterStyle;
  hiringManager?: string;
  customInstructions?: string;
  mentionSponsorship?: boolean;
  sponsorshipApproach?: SponsorshipApproach;
};

export type GeneratedCoverLetter = {
  subject_line: string;
  body: string;
  word_count: number;
  opening_line: string;
};

export type CoverLetter = {
  id: string;
  user_id: string;
  resume_id: string;
  job_id: string | null;
  job_title: string;
  company_name: string;
  hiring_manager: string | null;
  subject_line: string | null;
  body: string;
  word_count: number | null;
  tone: CoverLetterTone;
  length: CoverLetterLength;
  style: CoverLetterStyle;
  version_number: number;
  is_favorite: boolean;
  was_used: boolean;
  mentions_sponsorship: boolean;
  sponsorship_approach: SponsorshipApproach | null;
  created_at: string;
  updated_at: string;
};

export type CoverLetterInsert = Omit<CoverLetter, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CoverLetterUpdate = Partial<CoverLetterInsert>;

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

export type CoverLetterOptions = CoverLetterOptionsBase & { analysis?: ResumeAnalysis };

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
  h1b_prediction: H1BPrediction | null;
  h1b_prediction_at: string | null;
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
  desired_employment_types: EmploymentType[] | null;
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
// Waitlist (pre-launch)
// ---------------------------------------------------------------------------

export type Waitlist = {
  id: string;
  email: string;
  source: string | null;
  referrer: string | null;
  is_international: boolean | null;
  visa_status: string | null;
  university: string | null;
  metadata: Record<string, unknown> | null;
  confirmed: boolean;
  confirmation_token: string | null;
  joined_at: string;
};

export type WaitlistInsert = {
  id?: string;
  email: string;
  source?: string | null;
  referrer?: string | null;
  is_international?: boolean | null;
  visa_status?: string | null;
  university?: string | null;
  metadata?: Record<string, unknown> | null;
  confirmed?: boolean;
  confirmation_token?: string | null;
  joined_at?: string;
};

export type WaitlistUpdate = Partial<Omit<WaitlistInsert, 'email'>>;

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

export type ResumeSnapshot = Pick<
  Resume,
  | 'full_name'
  | 'email'
  | 'phone'
  | 'location'
  | 'linkedin_url'
  | 'portfolio_url'
  | 'summary'
  | 'work_experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'seniority_level'
  | 'years_of_experience'
  | 'primary_role'
  | 'industries'
  | 'top_skills'
  | 'resume_score'
  | 'raw_text'
>;

export type ResumeVersion = {
  id: string;
  resume_id: string;
  user_id: string;
  version_number: number;
  name: string | null;
  file_url: string | null;
  snapshot: ResumeSnapshot | null;
  changes_summary: string | null;
  created_at: string;
};

export type ResumeVersionInsert = Omit<ResumeVersion, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type JobApplicationUpdate = Partial<JobApplicationInsert>;

export type ResumeEditContext = {
  experienceIndex?: number;
  bulletIndex?: number;
  field?: 'summary' | 'description' | 'achievement' | 'technical' | 'soft' | 'languages' | 'certifications';
  keyword?: string;
};

export type ResumeEdit = {
  id: string;
  user_id: string;
  resume_id: string;
  job_id: string | null;
  section: ResumeSection;
  original_content: string;
  suggested_content: string;
  edit_type: ResumeEditType | null;
  keywords_added: string[] | null;
  was_accepted: boolean | null;
  feedback: string | null;
  context: ResumeEditContext | null;
  created_at: string;
};

export type ResumeEditInsert = Omit<ResumeEdit, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type ResumeEditSuggestion = ResumeEdit & {
  local_id?: string;
};

// ---------------------------------------------------------------------------
// Match scoring
// ---------------------------------------------------------------------------

export type JobMatchScore = {
  id: string;
  user_id: string;
  resume_id: string;
  job_id: string;
  overall_score: number;
  skills_score: number | null;
  seniority_score: number | null;
  location_score: number | null;
  employment_type_score: number | null;
  sponsorship_score: number | null;
  is_seniority_match: boolean | null;
  is_location_match: boolean | null;
  is_employment_type_match: boolean | null;
  is_sponsorship_compatible: boolean | null;
  matching_skills_count: number;
  total_required_skills: number;
  skills_match_rate: number | null;
  score_method: ScoreMethod;
  computed_at: string;
  resume_version: number;
};

export type JobMatchScoreInsert = Omit<JobMatchScore, 'id'> & {
  id?: string;
};

export type ScoreExplanation = {
  headline: string;
  strengths: string[];
  concerns: string[];
  sponsorship_note: string | null;
};

export type JobWithMatchScore = JobWithCompany & {
  match_score?: JobMatchScore | null;
  final_rank?: number | null;
};

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
// DOL LCA records (H1B approval prediction input)
// ---------------------------------------------------------------------------

export type LCACaseStatus =
  | 'Certified'
  | 'Certified-Withdrawn'
  | 'Denied'
  | 'Withdrawn'
  | string;

export type LCARecord = {
  id: string;
  employer_name: string;
  employer_name_normalized: string | null;
  company_id: string | null;
  job_title: string | null;
  soc_code: string | null;
  soc_title: string | null;
  worksite_city: string | null;
  worksite_state: string | null;
  worksite_state_abbr: string | null;
  wage_rate_from: number | null;
  wage_rate_to: number | null;
  wage_unit: string | null;
  prevailing_wage: number | null;
  prevailing_wage_unit: string | null;
  wage_level: string | null;
  case_status: LCACaseStatus | null;
  decision_date: string | null;
  visa_class: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  full_time_position: boolean | null;
  naics_code: string | null;
  fiscal_year: number | null;
  source_case_number: string | null;
  created_at: string;
};

export type LCARecordInsert = Omit<LCARecord, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type YearStat = {
  total: number;
  certified: number;
  denied: number;
  rate: number;
};

export type WageLevelStat = {
  total: number;
  certified: number;
  rate: number;
};

export type TopJobTitle = {
  title: string;
  soc_code: string | null;
  count: number;
  cert_rate: number;
};

export type TopState = { state: string; count: number };

export type EmployerLCAStats = {
  id: string;
  employer_name_normalized: string;
  company_id: string | null;
  display_name: string | null;
  total_applications: number;
  total_certified: number;
  total_denied: number;
  total_withdrawn: number;
  certification_rate: number | null;
  stats_by_year: Record<string, YearStat>;
  stats_by_wage_level: Record<string, WageLevelStat>;
  top_job_titles: TopJobTitle[];
  top_states: TopState[];
  is_staffing_firm: boolean;
  is_consulting_firm: boolean;
  has_high_denial_rate: boolean;
  is_first_time_filer: boolean;
  approval_trend: 'improving' | 'declining' | 'stable' | null;
  last_updated: string;
};

export type EmployerLCAStatsInsert = Omit<EmployerLCAStats, 'id' | 'last_updated'> & {
  id?: string;
  last_updated?: string;
};

export type SOCBaseRate = {
  soc_code: string;
  soc_title: string | null;
  total_applications: number;
  total_certified: number;
  total_denied: number;
  approval_rate: number | null;
  sample_size: number;
  last_updated: string;
};

export type SOCBaseRateInsert = Omit<SOCBaseRate, 'last_updated'> & {
  last_updated?: string;
};

// ---------------------------------------------------------------------------
// H1B approval prediction
// ---------------------------------------------------------------------------

export type H1BConfidence = 'high' | 'medium' | 'low';
export type H1BVerdict = 'strong' | 'good' | 'moderate' | 'risky' | 'unknown';

export type PredictionSignal = {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: 'high' | 'medium' | 'low';
  detail: string;
};

export type H1BEmployerSnapshot = {
  totalApplications: number;
  certificationRate: number;
  trend: 'improving' | 'declining' | 'stable' | null;
  isStaffingFirm: boolean;
  dataYears: number[];
};

export type H1BPrediction = {
  approvalLikelihood: number;
  confidenceLevel: H1BConfidence;
  verdict: H1BVerdict;
  employerScore: number;
  jobTitleScore: number;
  locationScore: number;
  wageScore: number | null;
  signals: PredictionSignal[];
  employerStats: H1BEmployerSnapshot | null;
  missingSalary: boolean;
  missingEmployerData: boolean;
  summary: string;
  topRisk: string | null;
  computedAt: string;
  isUSJob: boolean;
};

export type H1BPredictionInput = {
  jobTitle: string;
  normalizedTitle: string | null;
  company: {
    id: string;
    name: string;
  };
  location: string | null;
  state: string | null;
  isRemote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  seniorityLevel: SeniorityLevel | null;
  employmentType: EmploymentType | null;
  socCode?: string | null;
  description?: string | null;
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
      resume_edits: TableDefinition<
        ResumeEdit,
        ResumeEditInsert,
        Partial<ResumeEditInsert>
      >;
      job_applications: TableDefinition<
        JobApplication,
        JobApplicationInsert,
        JobApplicationUpdate
      >;
      crawl_logs: TableDefinition<CrawlLog, CrawlLogInsert, Partial<CrawlLogInsert>>;
      h1b_records: TableDefinition<H1BRecord, H1BRecordInsert, Partial<H1BRecordInsert>>;
      lca_records: TableDefinition<LCARecord, LCARecordInsert, Partial<LCARecordInsert>>;
      employer_lca_stats: TableDefinition<
        EmployerLCAStats,
        EmployerLCAStatsInsert,
        Partial<EmployerLCAStatsInsert>
      >;
      soc_base_rates: TableDefinition<
        SOCBaseRate,
        SOCBaseRateInsert,
        Partial<SOCBaseRateInsert>
      >;
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
      job_match_scores: TableDefinition<
        JobMatchScore,
        JobMatchScoreInsert,
        Partial<JobMatchScoreInsert>
      >;
      resume_analyses: TableDefinition<ResumeAnalysis, ResumeAnalysisInsert, Partial<ResumeAnalysisInsert>>;
      cover_letters: TableDefinition<CoverLetter, CoverLetterInsert, CoverLetterUpdate>;
      autofill_profiles: TableDefinition<AutofillProfile, AutofillProfileInsert, AutofillProfileUpdate>;
      autofill_history: TableDefinition<AutofillHistory, AutofillHistoryInsert, Partial<AutofillHistoryInsert>>;
      waitlist: TableDefinition<Waitlist, WaitlistInsert, WaitlistUpdate>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
