import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowRight,
  Banknote,
  Briefcase,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileQuestion,
  GraduationCap,
  Landmark,
  MapPin,
  Plane,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { EmployerHealthScore } from "@/components/employers/EmployerHealthScore"
import { buildCompanyImmigrationProfile, formatProfilePercent, getProfileConfidenceLabel } from "@/lib/companies/immigration-profile"
import { sqlSeoVisibleJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { cn } from "@/lib/utils"
import type { Company, Job } from "@/types"

export const dynamic = "force-dynamic"

type CompanyJobListRow = Pick<
  Job,
  | "id"
  | "title"
  | "location"
  | "is_remote"
  | "is_hybrid"
  | "seniority_level"
  | "employment_type"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "sponsors_h1b"
  | "sponsorship_score"
  | "first_detected_at"
  | "apply_url"
  | "skills"
>

type LcaStatsRow = {
  total_applications: number | null
  total_certified: number | null
  total_denied: number | null
  certification_rate: number | null
  approval_trend: string | null
  has_high_denial_rate: boolean | null
  top_job_titles: unknown
  top_states: unknown
  stats_by_wage_level: unknown
}

type SalaryStatsRow = {
  sample_size: number | null
  median_wage: number | null
  wage_min: number | null
  wage_max: number | null
  common_wage_level: string | null
}

type SimilarCompanyRow = Pick<
  Company,
  "id" | "name" | "domain" | "logo_url" | "industry" | "job_count" | "sponsors_h1b" | "sponsorship_confidence"
>

type HealthSnapshotRow = {
  total_score: number
  verdict: string
  glassdoor_rating: number | null
  glassdoor_trend: string
  layoff_score: number
  funding_score: number
}

type H1bRecordRow = {
  year: number
  total_petitions: number
  approved: number
  denied: number
  initial_approvals: number
}

type Props = { params: Promise<{ id: string }> }

const sectionCard = "term-panel p-6"

const mutedCard = "border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4"
const mergedBand = "border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5"

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "Unknown"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value))
}


function statusCopy(sponsorsH1b: boolean | null, confidence: number | null) {
  if (sponsorsH1b === true || (confidence ?? 0) >= 70) {
    return {
      label: "Historical H-1B signal",
      tone: "border-[#38e08a]/25 bg-[#38e08a]/12 text-[#38e08a]",
      description: "Past data suggests sponsorship activity. Current role support is not confirmed.",
    }
  }
  if ((confidence ?? 0) >= 40) {
    return {
      label: "Possible sponsorship signal",
      tone: "border-[#f5a623]/30 bg-[#f5a623]/12 text-[#f5a623]",
      description: "Some signals exist, but they should be reviewed role by role.",
    }
  }
  return {
    label: "Sponsorship unknown",
    tone: "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#ccd6cf]/70",
    description: "Hireoven has not confirmed current sponsorship support.",
  }
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={mutedCard}>
      <p className="term-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-[#ccd6cf]/55">{hint}</p> : null}
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: typeof Building2
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-[rgba(120,200,160,0.12)] pb-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#f5a623]">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div>
        <p className="term-label">{eyebrow}</p>
        <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-white">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-[#ccd6cf]/55">{description}</p> : null}
      </div>
    </div>
  )
}

function ProgressRow({
  label,
  value,
  detail,
}: {
  label: string
  value: number | null
  detail?: string
}) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#ccd6cf]">{label}</p>
        <p className="text-sm font-bold tabular-nums text-white">{value == null ? "Unknown" : `${width}%`}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden bg-[#0a0e0c] border border-[rgba(120,200,160,0.12)]">
        <div className="h-full bg-[#38e08a]" style={{ width: `${width}%` }} />
      </div>
      {detail ? <p className="mt-1.5 text-xs leading-relaxed text-[#ccd6cf]/55">{detail}</p> : null}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5 text-sm leading-6 text-[#ccd6cf]/55">
      {children}
    </div>
  )
}

async function loadCompany(id: string) {
  const pool = getPostgresPool()
  const [companyResult, jobsResult, lcaStatsResult, salaryStatsResult, h1bResult] = await Promise.all([
    pool.query<Company>(`SELECT * FROM companies WHERE id = $1::uuid LIMIT 1`, [id]),
    pool.query<CompanyJobListRow>(
      `SELECT id, title, location, is_remote, is_hybrid, seniority_level, employment_type,
              salary_min, salary_max, salary_currency, sponsors_h1b, sponsorship_score,
              first_detected_at, apply_url, skills
       FROM jobs
       WHERE company_id = $1::uuid
         AND is_active = true
         AND ${sqlSeoVisibleJob("jobs")}
         AND ${sqlJobLocatedInUsa("jobs")}
       ORDER BY first_detected_at DESC NULLS LAST
       LIMIT 12`,
      [id]
    ),
    pool.query<LcaStatsRow>(
      `SELECT total_applications, total_certified, total_denied, certification_rate, approval_trend,
              has_high_denial_rate, top_job_titles, top_states, stats_by_wage_level
       FROM employer_lca_stats
       WHERE company_id = $1::uuid
       LIMIT 1`,
      [id]
    ),
    pool.query<SalaryStatsRow>(
      `SELECT
          COUNT(*)::int AS sample_size,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_rate_from)::numeric AS median_wage,
          MIN(wage_rate_from)::numeric AS wage_min,
          MAX(COALESCE(wage_rate_to, wage_rate_from))::numeric AS wage_max,
          MODE() WITHIN GROUP (ORDER BY wage_level) AS common_wage_level
       FROM lca_records
       WHERE company_id = $1::uuid
         AND wage_rate_from IS NOT NULL
         AND (wage_unit IS NULL OR wage_unit ILIKE 'year%')`,
      [id]
    ),
    pool.query<H1bRecordRow>(
      `SELECT year, total_petitions, approved, denied, initial_approvals
       FROM h1b_records
       WHERE company_id = $1::uuid
       ORDER BY year DESC`,
      [id]
    ),
  ])

  const company = companyResult.rows[0]
  if (!company) return null
  const jobs = jobsResult.rows
  const lcaStats = lcaStatsResult.rows[0] ?? null
  const salaryStats = salaryStatsResult.rows[0] ?? null
  const h1bRecords = h1bResult.rows

  // When employer_lca_stats is missing, compute fallback totals from h1b_records.
  // H1B petition counts are a reasonable proxy for petition activity even though
  // they come from a different USCIS source than LCA records.
  const h1bTotalPetitions = h1bRecords.reduce((s, r) => s + r.total_petitions, 0)
  const h1bApproved = h1bRecords.reduce((s, r) => s + r.approved, 0)
  const h1bDenied = h1bRecords.reduce((s, r) => s + r.denied, 0)
  const h1bApprovalRate = h1bTotalPetitions > 0 ? h1bApproved / h1bTotalPetitions : null

  const effectiveLcaStats: LcaStatsRow | null =
    lcaStats ??
    (h1bRecords.length > 0
      ? {
          total_applications: h1bTotalPetitions,
          total_certified: h1bApproved,
          total_denied: h1bDenied,
          certification_rate: h1bApprovalRate,
          approval_trend: null,
          has_high_denial_rate: h1bApprovalRate != null && h1bApprovalRate < 0.8 ? true : null,
          top_job_titles: null,
          top_states: null,
          stats_by_wage_level: null,
        }
      : null)

  const stemRoleCount = jobs.filter((job) =>
    /software|engineer|developer|data|scientist|analyst|machine learning|ai/i.test(job.title)
  ).length

  const profile = buildCompanyImmigrationProfile({
    company,
    lcaStats: effectiveLcaStats,
    salaryStats,
    jobSignal: {
      activeJobCount: jobs.length,
      recentJobCount: jobs.filter((job) => {
        const days = (Date.now() - new Date(job.first_detected_at).getTime()) / 86_400_000
        return Number.isFinite(days) && days <= 14
      }).length,
      stemRoleCount,
    },
  })

  const [similarCompaniesResult, healthResult] = await Promise.all([
    pool.query<SimilarCompanyRow>(
      `SELECT id, name, domain, logo_url, industry, job_count, sponsors_h1b, sponsorship_confidence
       FROM companies
       WHERE id <> $1::uuid
         AND is_active = true
         AND ($2::text IS NULL OR industry = $2::text)
       ORDER BY
         ABS(COALESCE(sponsorship_confidence, 0) - $3::int) ASC,
         job_count DESC
       LIMIT 6`,
      [company.id, company.industry, company.sponsorship_confidence ?? 0]
    ),
    pool.query<HealthSnapshotRow>(
      `SELECT total_score, verdict, glassdoor_rating, glassdoor_trend, layoff_score, funding_score
       FROM company_health_scores
       WHERE company_id = $1::uuid
       LIMIT 1`,
      [company.id]
    ),
  ])

  return {
    company,
    jobs,
    h1bRecords,
    lcaStats: effectiveLcaStats,
    salaryStats,
    healthSnapshot: healthResult.rows[0] ?? null,
    profile: {
      ...profile,
      similarCompanyIds: similarCompaniesResult.rows.map((row) => row.id),
    },
    similarCompanies: similarCompaniesResult.rows,
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!hasPostgresEnv()) return { title: "Company immigration profile - Hireoven" }

  const { id } = await params
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    name: string
    job_count: number
    sponsorship_confidence: number
    industry: string | null
  }>(
    `SELECT name, job_count, sponsorship_confidence, industry FROM companies WHERE id = $1::uuid LIMIT 1`,
    [id]
  )
  const company = rows[0]

  if (!company) return { title: "Company immigration profile - Hireoven" }

  return {
    title: `${company.name} H-1B Sponsorship, OPT & Jobs - Hireoven`,
    description: `See ${company.name} jobs, historical H-1B/LCA sponsorship signals, salary intelligence, STEM OPT readiness, worksites, and sponsored role families on Hireoven.`,
    openGraph: {
      title: `${company.name} immigration profile - Hireoven`,
      description: `${company.job_count} open roles · ${company.sponsorship_confidence}% historical sponsorship confidence`,
      type: "website",
    },
  }
}

export default async function PublicCompanyPage({ params }: Props) {
  if (!hasPostgresEnv()) notFound()

  const { id } = await params
  const data = await loadCompany(id)
  if (!data) notFound()

  // Logged-in visitors see real, clickable job rows; logged-out visitors keep
  // the blurred signup teaser.
  const isAuthenticated = Boolean(await getSessionUser())

  const { company, jobs, h1bRecords, profile, similarCompanies, healthSnapshot } = data
  const status = statusCopy(profile.sponsorshipHistory.sponsorsH1b, profile.sponsorshipHistory.sponsorshipConfidence)
  const sponsorConfidence = profile.sponsorshipHistory.sponsorshipConfidence
  const approvalRate = profile.sponsorshipHistory.lcaCertificationRate
  const totalLca = profile.sponsorshipHistory.totalLcaApplications

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.name,
    url: company.careers_url || `https://${company.domain}`,
    logo: company.logo_url ?? undefined,
    sameAs: company.domain ? [`https://${company.domain}`] : undefined,
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <section className="overflow-hidden term-panel">
          <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
            <div className="min-w-0">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <CompanyLogo
                  companyName={company.name}
                  domain={company.domain}
                  logoUrl={company.logo_url}
                  priority
                  className="h-[88px] w-[88px] shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("border px-3 py-1 text-xs font-semibold", status.tone)}>
                      {status.label}
                    </span>
                    {company.ats_type ? (
                      <span className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-medium capitalize text-[#ccd6cf]/70">
                        {company.ats_type} ATS
                      </span>
                    ) : null}
                  </div>
                  <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    {company.name} <span className="text-[#f5a623]">immigration profile</span>
                  </h1>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-[#ccd6cf]/70">
                    {profile.overviewSummary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link href="#open-jobs" className="term-btn term-btn-amber">
                      View open jobs
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <a
                      href={company.careers_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="term-btn"
                    >
                      Company careers
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <aside className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5">
              <p className="term-label">Decision snapshot</p>
              <div className="mt-4 space-y-4">
                <ProgressRow
                  label="Historical sponsorship confidence"
                  value={sponsorConfidence}
                  detail={status.description}
                />
                <ProgressRow
                  label="LCA certification signal"
                  value={approvalRate == null ? null : Math.round(approvalRate * 100)}
                  detail="Historical LCA outcome rate where public records are connected."
                />
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Open jobs" value={jobs.length.toLocaleString()} />
                  <MiniStat
                    label={totalLca != null ? "LCA records" : "H-1B petitions"}
                    value={totalLca == null ? "Unknown" : totalLca.toLocaleString()}
                  />
                </div>
                {healthSnapshot && (
                  <div className="flex items-center justify-between gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-3">
                    <div>
                      <p className="term-label">Employer health</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className="text-lg font-bold tabular-nums"
                          style={{
                            color: healthSnapshot.verdict === "strong" ? "#38e08a"
                              : healthSnapshot.verdict === "healthy" ? "#5DCAA5"
                              : healthSnapshot.verdict === "caution" ? "#f5a623"
                              : "#E24B4A"
                          }}
                        >
                          {healthSnapshot.total_score}
                        </span>
                        <span
                          className="px-2 py-0.5 text-[10px] font-bold capitalize border"
                          style={{
                            background: healthSnapshot.verdict === "strong" ? "rgba(56,224,138,0.12)"
                              : healthSnapshot.verdict === "healthy" ? "rgba(93,202,165,0.12)"
                              : healthSnapshot.verdict === "caution" ? "rgba(245,166,35,0.12)"
                              : "rgba(226,75,74,0.12)",
                            borderColor: healthSnapshot.verdict === "strong" ? "rgba(56,224,138,0.3)"
                              : healthSnapshot.verdict === "healthy" ? "rgba(93,202,165,0.3)"
                              : healthSnapshot.verdict === "caution" ? "rgba(245,166,35,0.3)"
                              : "rgba(226,75,74,0.3)",
                            color: healthSnapshot.verdict === "strong" ? "#38e08a"
                              : healthSnapshot.verdict === "healthy" ? "#5DCAA5"
                              : healthSnapshot.verdict === "caution" ? "#f5a623"
                              : "#E24B4A",
                          }}
                        >
                          {healthSnapshot.verdict}
                        </span>
                      </div>
                    </div>
                    {healthSnapshot.glassdoor_rating != null && (
                      <div className="text-right">
                        <p className="term-label">Glassdoor</p>
                        <p className="mt-1 text-lg font-bold tabular-nums text-white">
                          {Number(healthSnapshot.glassdoor_rating).toFixed(1)}
                          <span className="ml-1 text-sm text-[#f5a623]">★</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <p className="border border-[#f5a623]/25 bg-[#f5a623]/10 px-4 py-3 text-xs leading-5 text-[#f5a623]">
                  Use this as a job-search signal. Sponsorship, OPT, STEM OPT, and cap-exempt support are never guaranteed by historical data.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            {/* Open jobs — teaser for logged-out visitors */}
            <section id="open-jobs" className={sectionCard}>
              <SectionHeader
                icon={Briefcase}
                eyebrow="Current open jobs"
                title={`${jobs.length} open role${jobs.length === 1 ? "" : "s"} at ${company.name}`}
                description="Hireoven tracks these in real time — new roles appear within minutes of posting."
              />

              {isAuthenticated && jobs.length > 0 ? (
                /* Logged in — real, clickable job rows linking to the detail page */
                <div className="overflow-hidden border border-[rgba(120,200,160,0.2)]">
                  {jobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/dashboard/jobs/${job.id}`}
                      className="flex items-center justify-between gap-3 border-b border-[rgba(120,200,160,0.12)] bg-[#0e1411] px-4 py-3.5 last:border-0 transition hover:bg-[#111a15]"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-[14px] font-semibold text-white">{job.title}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#ccd6cf]/55">
                          {(job.is_remote || job.location) && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {job.is_remote ? "Remote" : job.location}
                            </span>
                          )}
                          {job.employment_type && (
                            <span className="capitalize">{job.employment_type.replace(/[-_]/g, " ")}</span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#ccd6cf]/45" />
                    </Link>
                  ))}
                </div>
              ) : (
              /* Logged out (or no jobs) — ghost rows + signup teaser */
              <div className="relative overflow-hidden border border-[rgba(120,200,160,0.2)]">
                {(jobs.length > 0 ? jobs.slice(0, 3) : Array.from({ length: 3 })).map((_, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-[rgba(120,200,160,0.12)] bg-[#0e1411] px-4 py-3.5 last:border-0 select-none">
                    <div className="space-y-1.5">
                      <div className={cn("h-3.5 bg-[#1a221d]", i === 0 ? "w-52" : i === 1 ? "w-40" : "w-48")} />
                      <div className="flex gap-3">
                        <div className="h-2.5 w-20 bg-[#141c17]" />
                        <div className="h-2.5 w-16 bg-[#141c17]" />
                      </div>
                    </div>
                    <div className="h-7 w-16 bg-[#1a221d]" />
                  </div>
                ))}

                {/* Lock overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e0c]/85">
                  <div className="mx-4 w-full max-w-sm border border-[rgba(120,200,160,0.26)] bg-[#0e1411] p-6 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
                      <Sparkles className="h-6 w-6 text-[#f5a623]" />
                    </div>
                    <p className="text-[15px] font-semibold text-white">
                      {jobs.length > 0
                        ? `See all ${jobs.length} open role${jobs.length === 1 ? "" : "s"}`
                        : `Get alerts when ${company.name} hires`}
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#ccd6cf]/55">
                      Sign up free to see live job listings, AI match scores, and apply in one click.
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      <Link
                        href="/signup?next=%2Fdashboard%2Fonboarding"
                        className="term-btn term-btn-amber w-full justify-center"
                      >
                        Sign up free — see all jobs
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                      <Link
                        href="/login"
                        className="term-btn w-full justify-center"
                      >
                        Already have an account? Sign in
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </section>

            <section className={sectionCard}>
              <SectionHeader
                icon={ShieldCheck}
                eyebrow="Immigration intelligence"
                title="Sponsorship, LCA, salary and OPT signals"
                description="These related signals are grouped together so you can read the employer story without jumping across separate cards."
              />

              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <MiniStat label="Historical signal" value={status.label} hint={status.description} />
                  <MiniStat
                    label="Recent petitions"
                    value={profile.sponsorshipHistory.recentH1BPetitions == null ? "Unknown" : profile.sponsorshipHistory.recentH1BPetitions.toLocaleString()}
                    hint="Recent H-1B/LCA-style activity where connected."
                  />
                  <MiniStat
                    label="Certification rate"
                    value={formatProfilePercent(profile.sponsorshipHistory.lcaCertificationRate)}
                    hint="Based on historical LCA outcomes."
                  />
                </div>

                <p className="text-sm leading-6 text-[#ccd6cf]/70">{profile.sponsorshipHistory.summary}</p>

                {profile.sponsorshipHistory.riskFlags.length > 0 ? (
                  <div className="border border-[#f5a623]/30 bg-[#f5a623]/10 px-4 py-3">
                    <p className="text-sm font-semibold text-[#f5a623]">Signals to review</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-[#f5a623]/85">
                      {profile.sponsorshipHistory.riskFlags.map((flag) => (
                        <li key={flag}>• {flag}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* H-1B petition history — only shown when records exist */}
                {h1bRecords.length > 0 && (
                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-[#f5a623]" aria-hidden />
                      <h3 className="font-semibold text-white">H-1B petition history</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[rgba(120,200,160,0.2)] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#ccd6cf]/45">
                            <th className="pb-2 pr-6">Year</th>
                            <th className="pb-2 pr-6">Petitions</th>
                            <th className="pb-2 pr-6">Approved</th>
                            <th className="pb-2 pr-6">Denied</th>
                            <th className="pb-2">Approval rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgba(120,200,160,0.12)]">
                          {h1bRecords.map((row) => {
                            const rate = row.total_petitions > 0
                              ? Math.round((row.approved / row.total_petitions) * 100)
                              : null
                            return (
                              <tr key={row.year} className="text-[#ccd6cf]/80">
                                <td className="py-2.5 pr-6 font-semibold text-white">{row.year}</td>
                                <td className="py-2.5 pr-6">{row.total_petitions.toLocaleString()}</td>
                                <td className="py-2.5 pr-6 font-medium text-[#38e08a]">{row.approved.toLocaleString()}</td>
                                <td className="py-2.5 pr-6 text-red-400">{row.denied}</td>
                                <td className="py-2.5">
                                  {rate != null ? (
                                    <span className={cn(
                                      "font-semibold",
                                      rate >= 90 ? "text-[#38e08a]" : rate >= 70 ? "text-[#f5a623]" : "text-red-400"
                                    )}>
                                      {rate}%
                                    </span>
                                  ) : "—"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[rgba(120,200,160,0.2)] text-[12px] font-semibold text-[#ccd6cf]/80">
                            <td className="pt-2.5 pr-6">Total</td>
                            <td className="pt-2.5 pr-6">{h1bRecords.reduce((s, r) => s + r.total_petitions, 0).toLocaleString()}</td>
                            <td className="pt-2.5 pr-6 text-[#38e08a]">{h1bRecords.reduce((s, r) => s + r.approved, 0).toLocaleString()}</td>
                            <td className="pt-2.5 pr-6 text-red-400">{h1bRecords.reduce((s, r) => s + r.denied, 0)}</td>
                            <td className="pt-2.5">
                              {(() => {
                                const total = h1bRecords.reduce((s, r) => s + r.total_petitions, 0)
                                const approved = h1bRecords.reduce((s, r) => s + r.approved, 0)
                                const rate = total > 0 ? Math.round((approved / total) * 100) : null
                                return rate != null ? (
                                  <span className={cn("font-bold", rate >= 90 ? "text-[#38e08a]" : "text-[#f5a623]")}>
                                    {rate}%
                                  </span>
                                ) : "—"
                              })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#ccd6cf]/45">
                      Source: USCIS H-1B employer data. These are petition counts, not individual employees.
                    </p>
                  </div>
                )}

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                  <div className={mergedBand}>
                    <div className="mb-4 flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#f5a623]">
                        <Sparkles className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-semibold text-white">Sponsored role families</h3>
                        <p className="mt-0.5 text-sm leading-6 text-[#ccd6cf]/55">
                          Compare the current job with historical sponsored role patterns.
                        </p>
                      </div>
                    </div>
                    {profile.roleFamilies.length === 0 ? (
                      <EmptyState>No role-family LCA breakdown is connected for {company.name} yet.</EmptyState>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {profile.roleFamilies.map((role) => (
                          <div key={role.label} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-semibold text-white">{role.label}</p>
                              {role.share != null ? (
                                <span className="border border-[#f5a623]/30 bg-[#f5a623]/12 px-2 py-0.5 text-xs font-bold text-[#f5a623]">
                                  {role.share}%
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-[#ccd6cf]/55">
                              {role.count == null ? "Historical count unknown" : `${role.count.toLocaleString()} historical filing${role.count === 1 ? "" : "s"}`}
                            </p>
                            <p className="mt-2 text-xs font-medium text-[#ccd6cf]/45">{getProfileConfidenceLabel(role.confidence)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#f5a623]">
                        <MapPin className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-semibold text-white">Common worksites</h3>
                        <p className="mt-0.5 text-sm leading-6 text-[#ccd6cf]/55">
                          Location history can vary by team and worksite.
                        </p>
                      </div>
                    </div>
                    {profile.worksites.length === 0 ? (
                      <EmptyState>No worksite breakdown is connected for {company.name} yet.</EmptyState>
                    ) : (
                      <div className="space-y-2.5">
                        {profile.worksites.map((site) => (
                          <div key={site.label} className="flex items-center justify-between gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-3">
                            <div>
                              <p className="font-semibold text-white">{site.label}</p>
                              <p className="text-sm text-[#ccd6cf]/55">
                                {site.count == null ? "Count unknown" : `${site.count.toLocaleString()} filing${site.count === 1 ? "" : "s"}`}
                              </p>
                            </div>
                            {site.share != null ? (
                              <span className="border border-[#f5a623]/30 bg-[#f5a623]/12 px-2.5 py-1 text-xs font-bold text-[#f5a623]">
                                {site.share}%
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-[#f5a623]" aria-hidden />
                      <h3 className="font-semibold text-white">Salary context</h3>
                    </div>
                    <div className="space-y-3">
                      <MiniStat label="Median wage" value={formatMoney(profile.salaryIntelligence.medianWage)} />
                      <MiniStat
                        label="Historical range"
                        value={
                          profile.salaryIntelligence.rangeMin == null && profile.salaryIntelligence.rangeMax == null
                            ? "Unknown"
                            : `${formatMoney(profile.salaryIntelligence.rangeMin)} - ${formatMoney(profile.salaryIntelligence.rangeMax)}`
                        }
                      />
                      <MiniStat
                        label="Wage level"
                        value={profile.salaryIntelligence.commonWageLevel ?? "Unknown"}
                        hint={`${getProfileConfidenceLabel(profile.salaryIntelligence.confidence)} · ${
                          profile.salaryIntelligence.sampleSize == null
                            ? "sample size unknown"
                            : `${profile.salaryIntelligence.sampleSize.toLocaleString()} wage records`
                        }`}
                      />
                    </div>
                    <p className="mt-4 text-sm leading-6 text-[#ccd6cf]/70">{profile.salaryIntelligence.summary}</p>
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-[#f5a623]" aria-hidden />
                      <h3 className="font-semibold text-white">STEM OPT readiness</h3>
                    </div>
                    <p className="text-sm font-semibold capitalize text-white">{profile.stemOptReadiness.readiness}</p>
                    <p className="mt-2 text-sm leading-6 text-[#ccd6cf]/70">{profile.stemOptReadiness.summary}</p>
                    <div className="mt-4 flex items-start gap-2 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#38e08a]" aria-hidden />
                      <p className="text-xs leading-5 text-[#ccd6cf]/55">
                        E-Verify is {profile.stemOptReadiness.likelyEVerify === true ? "likely" : "not confirmed"} in the current data.
                      </p>
                    </div>
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-[#f5a623]" aria-hidden />
                      <h3 className="font-semibold text-white">Possible cap-exempt pathway</h3>
                    </div>
                    <p className="text-sm leading-6 text-[#ccd6cf]/70">{profile.capExempt.summary}</p>
                    {profile.capExempt.evidence.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-sm leading-6 text-[#ccd6cf]/55">
                        {profile.capExempt.evidence.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionCard}>
              <SectionHeader
                icon={TrendingUp}
                eyebrow="Employer financial health"
                title={`Is ${company.name} a stable place to work?`}
                description="Composite score based on funding recency, layoff history, Glassdoor rating, and hiring trajectory."
              />
              <EmployerHealthScore companyId={company.id} companyName={company.name} />
            </section>

            <section className={sectionCard}>
              <SectionHeader
                icon={FileQuestion}
                eyebrow="SEO FAQ"
                title={`Questions about ${company.name} sponsorship`}
                description="Short answers use careful wording because employer policy can change by role, location, and year."
              />
              <div className="divide-y divide-[rgba(120,200,160,0.12)]">
                {[
                  [`Does ${company.name} sponsor H-1B?`, profile.faq.h1b],
                  [`Does ${company.name} hire OPT students?`, profile.faq.opt],
                  [`Does ${company.name} support STEM OPT?`, profile.faq.stemOpt],
                  [`What roles has ${company.name} sponsored before?`, profile.faq.sponsoredRoles],
                ].map(([question, answer]) => (
                  <div key={question} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-base font-semibold text-white">{question}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-[#ccd6cf]/70">{answer}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <section className={sectionCard}>
              <SectionHeader icon={TrendingUp} eyebrow="Hiring health" title="Recent hiring activity" />
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Active roles" value={(profile.hiringHealth.activeJobCount ?? jobs.length).toLocaleString()} />
                <MiniStat label="Recent roles" value={(profile.hiringHealth.recentJobCount ?? 0).toLocaleString()} />
              </div>
              <p className="mt-4 text-sm leading-6 text-[#ccd6cf]/70">
                {profile.hiringHealth.summary ?? "Hiring trend is unknown until more crawl history is available."}
              </p>

              <div className="my-6 border-t border-[rgba(120,200,160,0.12)]" />

              <SectionHeader icon={Building2} eyebrow="Similar companies" title="Compare employers" />
              {similarCompanies.length === 0 ? (
                <EmptyState>No similar company suggestions yet.</EmptyState>
              ) : (
                <div className="space-y-3">
                  {similarCompanies.map((similar) => (
                    <Link
                      key={similar.id}
                      href={`/companies/${similar.id}`}
                      className="term-panel-hover flex items-center gap-3 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-3"
                    >
                      <CompanyLogo
                        companyName={similar.name}
                        domain={similar.domain}
                        logoUrl={similar.logo_url}
                        className="h-10 w-10 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{similar.name}</span>
                        <span className="block text-xs text-[#ccd6cf]/55">
                          {similar.job_count} open role{similar.job_count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
