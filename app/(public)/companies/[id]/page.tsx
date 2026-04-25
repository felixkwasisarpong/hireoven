import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowRight,
  Banknote,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
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
import { buildCompanyImmigrationProfile, formatProfilePercent, getProfileConfidenceLabel } from "@/lib/companies/immigration-profile"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
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

type Props = { params: Promise<{ id: string }> }

const sectionCard =
  "rounded-[28px] border border-slate-200/70 bg-white p-6 shadow-[0_14px_42px_rgba(15,23,42,0.04)]"

const mutedCard = "rounded-2xl bg-slate-50/85 p-4 ring-1 ring-slate-200/55"
const mergedBand = "rounded-3xl bg-slate-50/70 p-5 ring-1 ring-slate-200/55"

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "Unknown"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value))
}

function formatSalary(min: number | null, max: number | null, currency = "USD") {
  if (min == null && max == null) return null
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  })
  if (min != null && max != null) return `${fmt.format(min)} - ${fmt.format(max)}`
  if (min != null) return `From ${fmt.format(min)}`
  return `Up to ${fmt.format(max ?? 0)}`
}

function hoursAgo(ts: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function statusCopy(sponsorsH1b: boolean | null, confidence: number | null) {
  if (sponsorsH1b === true || (confidence ?? 0) >= 70) {
    return {
      label: "Historical H-1B signal",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      description: "Past data suggests sponsorship activity. Current role support is not confirmed.",
    }
  }
  if ((confidence ?? 0) >= 40) {
    return {
      label: "Possible sponsorship signal",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      description: "Some signals exist, but they should be reviewed role by role.",
    }
  }
  return {
    label: "Sponsorship unknown",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
    description: "Hireoven has not confirmed current sponsorship support.",
  }
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={mutedCard}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
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
    <div className="mb-5 flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-50 text-[#2563EB]">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
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
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-sm font-bold tabular-nums text-slate-950">{value == null ? "Unknown" : `${width}%`}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${width}%` }} />
      </div>
      {detail ? <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{detail}</p> : null}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm leading-6 text-slate-500">
      {children}
    </div>
  )
}

async function loadCompany(id: string) {
  const pool = getPostgresPool()
  const [companyResult, jobsResult, lcaStatsResult, salaryStatsResult] = await Promise.all([
    pool.query<Company>(`SELECT * FROM companies WHERE id = $1::uuid LIMIT 1`, [id]),
    pool.query<CompanyJobListRow>(
      `SELECT id, title, location, is_remote, is_hybrid, seniority_level, employment_type,
              salary_min, salary_max, salary_currency, sponsors_h1b, sponsorship_score,
              first_detected_at, apply_url, skills
       FROM jobs
       WHERE company_id = $1::uuid AND is_active = true AND ${sqlJobLocatedInUsa("jobs")}
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
  ])

  const company = companyResult.rows[0]
  if (!company) return null
  const jobs = jobsResult.rows
  const lcaStats = lcaStatsResult.rows[0] ?? null
  const salaryStats = salaryStatsResult.rows[0] ?? null

  const stemRoleCount = jobs.filter((job) =>
    /software|engineer|developer|data|scientist|analyst|machine learning|ai/i.test(job.title)
  ).length

  const profile = buildCompanyImmigrationProfile({
    company,
    lcaStats,
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

  const similarCompaniesResult = await pool.query<SimilarCompanyRow>(
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
  )

  return {
    company,
    jobs,
    lcaStats,
    salaryStats,
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

  const { company, jobs, profile, similarCompanies } = data
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
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
            <div className="min-w-0">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {company.logo_url ? (
                  <Image
                    src={company.logo_url}
                    alt={`${company.name} logo`}
                    width={88}
                    height={88}
                    className="h-[88px] w-[88px] shrink-0 rounded-3xl border border-slate-100 bg-white object-contain p-2"
                    priority
                  />
                ) : (
                  <div className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-3xl bg-sky-50 text-3xl font-bold text-[#0C4A6E]">
                    {company.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", status.tone)}>
                      {status.label}
                    </span>
                    {company.ats_type ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium capitalize text-slate-600">
                        {company.ats_type} ATS
                      </span>
                    ) : null}
                  </div>
                  <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                    {company.name} immigration profile
                  </h1>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
                    {profile.overviewSummary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="#open-jobs"
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1D4ED8]"
                    >
                      View open jobs
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <a
                      href={company.careers_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Company careers
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <aside className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Decision snapshot</p>
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
                  <MiniStat label="LCA records" value={totalLca == null ? "Unknown" : totalLca.toLocaleString()} />
                </div>
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  Use this as a job-search signal. Sponsorship, OPT, STEM OPT, and cap-exempt support are never guaranteed by historical data.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <section id="open-jobs" className={sectionCard}>
              <SectionHeader
                icon={Briefcase}
                eyebrow="Current open jobs"
                title={`${jobs.length} open role${jobs.length === 1 ? "" : "s"} at ${company.name}`}
                description="Fresh openings tracked by Hireoven. Review each job description for current sponsorship language."
              />
              {jobs.length === 0 ? (
                <EmptyState>No open roles are currently tracked for {company.name}.</EmptyState>
              ) : (
                <div className="space-y-3">
                  {jobs.map((job) => {
                    const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency)
                    return (
                      <article
                        key={job.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-sky-200 hover:shadow-sm"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <Link
                              href={`/jobs/${job.id}`}
                              className="text-base font-bold text-slate-950 transition hover:text-[#2563EB]"
                            >
                              {job.title}
                            </Link>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                              {job.location ? (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                                  {job.is_remote ? "Remote" : job.is_hybrid ? `Hybrid · ${job.location}` : job.location}
                                </span>
                              ) : null}
                              {salary ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                  <Banknote className="h-3.5 w-3.5" aria-hidden />
                                  {salary}
                                </span>
                              ) : null}
                              {job.sponsors_h1b ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                                  <Plane className="h-3.5 w-3.5" aria-hidden />
                                  Historical sponsorship signal
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 text-sm">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                              <Clock3 className="h-3.5 w-3.5" aria-hidden />
                              {hoursAgo(job.first_detected_at)}
                            </span>
                            <a
                              href={job.apply_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-xl bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1D4ED8]"
                            >
                              Apply
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          </div>
                        </div>
                      </article>
                    )
                  })}
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

                <p className="text-sm leading-6 text-slate-600">{profile.sponsorshipHistory.summary}</p>

                {profile.sponsorshipHistory.riskFlags.length > 0 ? (
                  <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200/80">
                    <p className="text-sm font-semibold text-amber-900">Signals to review</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-800">
                      {profile.sponsorshipHistory.riskFlags.map((flag) => (
                        <li key={flag}>• {flag}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                  <div className={mergedBand}>
                    <div className="mb-4 flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-[#2563EB] ring-1 ring-slate-200/70">
                        <Sparkles className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-bold text-slate-950">Sponsored role families</h3>
                        <p className="mt-0.5 text-sm leading-6 text-slate-500">
                          Compare the current job with historical sponsored role patterns.
                        </p>
                      </div>
                    </div>
                    {profile.roleFamilies.length === 0 ? (
                      <EmptyState>No role-family LCA breakdown is connected for {company.name} yet.</EmptyState>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {profile.roleFamilies.map((role) => (
                          <div key={role.label} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/60">
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-semibold text-slate-900">{role.label}</p>
                              {role.share != null ? (
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700">
                                  {role.share}%
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {role.count == null ? "Historical count unknown" : `${role.count.toLocaleString()} historical filing${role.count === 1 ? "" : "s"}`}
                            </p>
                            <p className="mt-2 text-xs font-medium text-slate-400">{getProfileConfidenceLabel(role.confidence)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-[#2563EB] ring-1 ring-slate-200/70">
                        <MapPin className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <h3 className="font-bold text-slate-950">Common worksites</h3>
                        <p className="mt-0.5 text-sm leading-6 text-slate-500">
                          Location history can vary by team and worksite.
                        </p>
                      </div>
                    </div>
                    {profile.worksites.length === 0 ? (
                      <EmptyState>No worksite breakdown is connected for {company.name} yet.</EmptyState>
                    ) : (
                      <div className="space-y-2.5">
                        {profile.worksites.map((site) => (
                          <div key={site.label} className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/60">
                            <div>
                              <p className="font-semibold text-slate-900">{site.label}</p>
                              <p className="text-sm text-slate-500">
                                {site.count == null ? "Count unknown" : `${site.count.toLocaleString()} filing${site.count === 1 ? "" : "s"}`}
                              </p>
                            </div>
                            {site.share != null ? (
                              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">
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
                      <Banknote className="h-4 w-4 text-[#2563EB]" aria-hidden />
                      <h3 className="font-bold text-slate-950">Salary context</h3>
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
                    <p className="mt-4 text-sm leading-6 text-slate-600">{profile.salaryIntelligence.summary}</p>
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-[#2563EB]" aria-hidden />
                      <h3 className="font-bold text-slate-950">STEM OPT readiness</h3>
                    </div>
                    <p className="text-sm font-semibold capitalize text-slate-900">{profile.stemOptReadiness.readiness}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{profile.stemOptReadiness.summary}</p>
                    <div className="mt-4 flex items-start gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      <p className="text-xs leading-5 text-slate-500">
                        E-Verify is {profile.stemOptReadiness.likelyEVerify === true ? "likely" : "not confirmed"} in the current data.
                      </p>
                    </div>
                  </div>

                  <div className={mergedBand}>
                    <div className="mb-4 flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-[#2563EB]" aria-hidden />
                      <h3 className="font-bold text-slate-950">Cap-exempt signal</h3>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{profile.capExempt.summary}</p>
                    {profile.capExempt.evidence.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-sm leading-6 text-slate-500">
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
                icon={FileQuestion}
                eyebrow="SEO FAQ"
                title={`Questions about ${company.name} sponsorship`}
                description="Short answers use careful wording because employer policy can change by role, location, and year."
              />
              <div className="divide-y divide-slate-100">
                {[
                  [`Does ${company.name} sponsor H-1B?`, profile.faq.h1b],
                  [`Does ${company.name} hire OPT students?`, profile.faq.opt],
                  [`Does ${company.name} support STEM OPT?`, profile.faq.stemOpt],
                  [`What roles has ${company.name} sponsored before?`, profile.faq.sponsoredRoles],
                ].map(([question, answer]) => (
                  <div key={question} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-base font-bold text-slate-950">{question}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">{answer}</p>
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
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {profile.hiringHealth.summary ?? "Hiring trend is unknown until more crawl history is available."}
              </p>

              <div className="my-6 border-t border-slate-100" />

              <SectionHeader icon={Building2} eyebrow="Similar companies" title="Compare employers" />
              {similarCompanies.length === 0 ? (
                <EmptyState>No similar company suggestions yet.</EmptyState>
              ) : (
                <div className="space-y-3">
                  {similarCompanies.map((similar) => (
                    <Link
                      key={similar.id}
                      href={`/companies/${similar.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-sky-200 hover:bg-sky-50/30"
                    >
                      {similar.logo_url ? (
                        <Image
                          src={similar.logo_url}
                          alt={`${similar.name} logo`}
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1"
                        />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                          {similar.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{similar.name}</span>
                        <span className="block text-xs text-slate-500">
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
