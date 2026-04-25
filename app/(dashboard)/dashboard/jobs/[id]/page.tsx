import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Building2,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Home as HomeIcon,
  ListChecks,
  MapPin,
  Plane,
  Star,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import JobDetailPanel from "@/components/jobs/JobDetailPanel"
import JobShareRow from "@/components/jobs/JobShareRow"
import CompanyLogo from "@/components/ui/CompanyLogo"
import {
  formatSalaryLabel,
  resolveJobNormalization,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import {
  extractEducationLabel,
  extractExperienceLabel,
} from "@/lib/jobs/metadata"
import { cleanJobTitle } from "@/lib/jobs/title"
import {
  employerLikelySponsorsH1b,
  employerSponsorshipPill,
} from "@/lib/jobs/sponsorship-employer-signal"
import { getSessionUser } from "@/lib/auth/session-user"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extractSkillsFromText,
  getSkillsBucketValues,
  normalizeSkillList,
  skillMatches,
} from "@/lib/skills/taxonomy"
import { cn } from "@/lib/utils"
import type { Company, Job, JobMatchScore, Skills } from "@/types"

type Props = { params: Promise<{ id: string }> }

type SimilarJob = {
  id: string
  title: string
  location: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  company: {
    name: string
    domain: string | null
    logo_url: string | null
  } | null
}

type ResumeSkillRow = {
  skills: Skills | null
  top_skills: string[] | null
  raw_text: string | null
}

const EXPERIENCE_BY_SENIORITY: Record<string, string> = {
  intern: "0 - 1 years",
  junior: "1 - 3 years",
  mid: "3 - 6 years",
  senior: "5+ years",
  staff: "8+ years",
  principal: "10+ years",
  director: "10+ years",
  vp: "12+ years",
  exec: "12+ years",
}

function dedupe(values: string[], max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

const TABS = [
  { id: "job-details", label: "Job Details", icon: FileText },
  { id: "about-company", label: "About Company", icon: Building2 },
  { id: "similar-jobs", label: "Similar Jobs", icon: Briefcase },
]

function FactRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{value}</div>
      </div>
    </li>
  )
}

function SectionH({ children, icon: Icon }: { children: React.ReactNode; icon?: LucideIcon }) {
  return (
    <h2 className="inline-flex items-center gap-2 text-[16px] font-semibold tracking-tight text-slate-900">
      {Icon ? (
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-50 text-[#2563EB]">
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        </span>
      ) : null}
      {children}
    </h2>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-[14px] leading-relaxed text-slate-700">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default async function DashboardJobDetailPage({ params }: Props) {
  const { id } = await params
  const pool = getPostgresPool()

  const [session, jobResult] = await Promise.all([
    getSessionUser(),
    pool.query(
      `SELECT j.*, to_jsonb(c.*) AS company
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1::uuid AND j.is_active = true AND ${sqlJobLocatedInUsa("j")}
       LIMIT 1`,
      [id]
    ),
  ])
  const rawJob = jobResult.rows[0]
  if (!rawJob) notFound()

  const job = rawJob as unknown as Job & { company: Company | null }
  const company = job.company

  const normalized = resolveJobNormalization(job as unknown as PersistedJobForNormalization)
  const page = normalized.pageView

  const displayTitle = cleanJobTitle(page.title)
  const postedLabel = page.posted_at_label ?? "Recently posted"
  const employmentLabel = page.employment_label ?? "Not specified"
  const salaryLabel = page.salary_label
  const seniorityLabel = page.seniority_label
  const experienceLabel =
    extractExperienceLabel(job.description) ??
    (seniorityLabel
      ? EXPERIENCE_BY_SENIORITY[(job.seniority_level ?? "") as string]
      : null) ??
    "Not specified"
  const educationLabel = extractEducationLabel(job.description) ?? "Not specified"

  const aboutRole =
    page.sections.about_role.items.length > 0
      ? page.sections.about_role.items
      : ["We are still extracting this role summary from the source posting."]

  const responsibilities =
    page.sections.responsibilities.items.length > 0
      ? page.sections.responsibilities.items
      : []
  const requirements =
    page.sections.requirements.items.length > 0 ? page.sections.requirements.items : []
  const niceToHave = page.sections.preferred_qualifications.items

  const skills = page.skills.slice(0, 8)

  const sponsorshipPill = employerSponsorshipPill({ ...job, company })
  const sponsorsConfirmed = employerLikelySponsorsH1b({ ...job, company })

  const workModel = job.is_remote ? "Remote" : job.is_hybrid ? "Hybrid" : "On-site"
  const workModelLong = job.is_remote
    ? "Remote-first"
    : job.is_hybrid
      ? "Hybrid"
      : "On-site"

  const visaSponsorshipValue = sponsorsConfirmed
    ? "Historical signal"
    : job.requires_authorization
      ? "Not provided"
      : "See posting"

  const similarSql = `SELECT j.id, j.title, j.location, j.salary_min, j.salary_max, j.salary_currency,
       jsonb_build_object('name', c.name, 'domain', c.domain, 'logo_url', c.logo_url) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.is_active = true AND ${sqlJobLocatedInUsa("j")}`

  const [matchScoreMap, resumeSkillResult, similarByTitleResult, similarByCompanyResult] = await Promise.all([
    session?.sub
      ? scoreJobsForUser(session.sub, [id]).catch((err) => {
          console.warn("Job page: match score preload failed", err)
          return new Map<string, JobMatchScore>()
        })
      : Promise.resolve(new Map<string, JobMatchScore>()),
    session?.sub
      ? pool.query<ResumeSkillRow>(
          `SELECT skills, top_skills, raw_text
           FROM resumes
           WHERE user_id = $1
             AND parse_status = 'complete'
           ORDER BY is_primary DESC, updated_at DESC
           LIMIT 1`,
          [session.sub]
        )
      : Promise.resolve({ rows: [] as ResumeSkillRow[] }),
    page.normalized_title && page.normalized_title.length > 0
      ? pool.query<SimilarJob>(
          `${similarSql} AND j.normalized_title = $1 AND j.id <> $2::uuid LIMIT 3`,
          [page.normalized_title, id]
        )
      : Promise.resolve({ rows: [] as SimilarJob[] }),
    job.company_id
      ? pool.query<SimilarJob>(
          `${similarSql} AND j.company_id = $1 AND j.id <> $2::uuid LIMIT 6`,
          [job.company_id, id]
        )
      : Promise.resolve({ rows: [] as SimilarJob[] }),
  ])

  const initialMatchScore = matchScoreMap.get(id) ?? null

  // Resume skills: structured buckets + raw text fallback via taxonomy
  const resumeSkillLabels = normalizeSkillList([
    ...(resumeSkillResult.rows[0]?.top_skills ?? []),
    ...getSkillsBucketValues(resumeSkillResult.rows[0]?.skills ?? null),
    ...extractSkillsFromText(resumeSkillResult.rows[0]?.raw_text ?? null),
  ])

  // Job skills come from the DB (crawl-time extraction) — no UI-side mining needed
  const jobSkillCandidates = normalizeSkillList(
    [...(job.skills ?? []), ...page.skills],
    40
  )
  const requirementSkillPills = jobSkillCandidates.map((skill) => ({
    skill,
    matched: resumeSkillLabels.some((resumeSkill) => skillMatches(skill, resumeSkill)),
  }))

  const similarMap = new Map<string, SimilarJob>()
  for (const entry of similarByTitleResult.rows ?? []) similarMap.set(entry.id, entry)
  for (const entry of similarByCompanyResult.rows ?? []) {
    if (similarMap.size >= 3) break
    similarMap.set(entry.id, entry)
  }
  const similarJobs = [...similarMap.values()].slice(0, 3)

  const qualificationItems = dedupe([...requirements])
  const niceToHaveItems = dedupe(niceToHave)

  const facts: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: CalendarClock, label: "Posted", value: postedLabel },
    { icon: Star, label: "Experience", value: experienceLabel },
    { icon: Briefcase, label: "Employment type", value: employmentLabel },
    { icon: HomeIcon, label: "Work model", value: workModelLong },
    { icon: Banknote, label: "Salary", value: salaryLabel ?? "Not disclosed" },
    { icon: Plane, label: "Visa sponsorship", value: visaSponsorshipValue },
  ]

  const panel = "rounded-2xl bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70"

  return (
    <main className="min-h-full bg-[#F1F5F9] pb-16">
      <div className="mx-auto w-full max-w-[1340px] px-4 py-6 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#2563EB] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
          Back to jobs
        </Link>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
          {/* ──────────────────── Main column ──────────────────── */}
          <div className="min-w-0 space-y-5">

            {/* Job header */}
            <section id="job-details" className={cn(panel, "p-6")}>
              <div className="flex min-w-0 items-start gap-5">
                <CompanyLogo
                  companyName={company?.name ?? "Company"}
                  domain={company?.domain ?? null}
                  logoUrl={company?.logo_url ?? null}
                  className="h-[88px] w-[88px] shrink-0 rounded-xl border-0 bg-transparent"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-[22px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[24px]">
                    {displayTitle}
                  </h1>
                  <div className="mt-1 flex items-center gap-1.5">
                    {company?.id ? (
                      <Link
                        href={`/companies/${company.id}`}
                        className="text-[14px] font-semibold text-slate-700 transition hover:text-[#2563EB] hover:underline"
                      >
                        {company.name}
                      </Link>
                    ) : (
                      <span className="text-[14px] font-semibold text-slate-700">
                        {company?.name ?? "Unknown company"}
                      </span>
                    )}
                    <BadgeCheck className="h-4 w-4 text-[#2563EB]" strokeWidth={2.5} aria-hidden />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-600">
                    {page.location ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden />
                        {page.location}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden />
                      {employmentLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <HomeIcon className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden />
                      {workModel}
                    </span>
                    {salaryLabel ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Banknote className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden />
                        {salaryLabel}
                      </span>
                    ) : null}
                  </div>
                  {skills.length > 0 ? (
                    <div className="mt-3.5 flex flex-wrap gap-1.5">
                      {skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11.5px] font-medium text-sky-800"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Tab nav */}
              <nav className="mt-5 border-t border-slate-100 pt-1">
                <div className="flex flex-wrap gap-x-1">
                  {TABS.map((tab, index) => {
                    const Icon = tab.icon
                    return (
                      <a
                        key={tab.id}
                        href={`#${tab.id}`}
                        className={`relative inline-flex h-11 items-center gap-1.5 px-3.5 text-[13.5px] font-semibold transition-colors ${
                          index === 0
                            ? "text-[#2563EB]"
                            : "text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                        {tab.label}
                        {index === 0 ? (
                          <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-[#2563EB]" />
                        ) : null}
                      </a>
                    )
                  })}
                </div>
              </nav>

              {/* Job description sections */}
              <div className="mt-5 space-y-7">
                <div>
                  <SectionH icon={FileText}>About the role</SectionH>
                  <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-slate-700">
                    {aboutRole.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>

                {responsibilities.length > 0 && (
                  <div>
                    <SectionH icon={ListChecks}>What you&apos;ll do</SectionH>
                    <div className="mt-3">
                      <BulletList items={responsibilities} />
                    </div>
                  </div>
                )}

                {(qualificationItems.length > 0 || requirementSkillPills.length > 0) && (
                  <div>
                    <SectionH icon={ClipboardList}>Requirements</SectionH>
                    {requirementSkillPills.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Skills needed for this job
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {requirementSkillPills.map(({ skill, matched }) => (
                            <span
                              key={skill}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1",
                                matched
                                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                  : "bg-amber-50 text-amber-800 ring-amber-200"
                              )}
                            >
                              {matched && (
                                <CheckCircle2 className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                              )}
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {qualificationItems.length > 0 && (
                      <div className="mt-3">
                        <BulletList items={qualificationItems} />
                      </div>
                    )}
                  </div>
                )}

                {niceToHaveItems.length > 0 && (
                  <div>
                    <SectionH icon={Star}>Nice to have</SectionH>
                    <div className="mt-3">
                      <BulletList items={niceToHaveItems} />
                    </div>
                  </div>
                )}

                {educationLabel && educationLabel !== "Not specified" && (
                  <p className="text-[12px] text-slate-500">
                    Education preference: {educationLabel}
                  </p>
                )}
              </div>

              {/* Job facts — inside the same card */}
              <div className="mt-7 border-t border-slate-100 pt-6">
                <ul className="grid gap-4 sm:grid-cols-2">
                  {facts.map((f) => (
                    <FactRow key={f.label} icon={f.icon} label={f.label} value={f.value} />
                  ))}
                </ul>
              </div>
            </section>

            {/* About company */}
            <section id="about-company" className={cn(panel, "p-5 sm:p-6")}>
              <SectionH icon={Building2}>About {company?.name ?? "the company"}</SectionH>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                <CompanyLogo
                  companyName={company?.name ?? "Company"}
                  domain={company?.domain ?? null}
                  logoUrl={company?.logo_url ?? null}
                  className="h-14 w-14 shrink-0 rounded-xl border-0 bg-transparent"
                />
                <div className="min-w-0 flex-1">
                  {page.sections.company_info.items.length > 0 ? (
                    <div className="space-y-3 text-[14px] leading-relaxed text-slate-700">
                      {page.sections.company_info.items.map((p) => (
                        <p key={p}>{p}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[14px] leading-relaxed text-slate-700">
                      {company?.name ?? "This company"} is actively hiring and regularly updates openings.
                    </p>
                  )}
                  {company?.careers_url ? (
                    <a
                      href={company.careers_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      Visit company careers
                    </a>
                  ) : null}
                  {company?.id ? (
                    <Link
                      href={`/companies/${company.id}`}
                      className="ml-4 mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] hover:underline"
                    >
                      <Building2 className="h-3.5 w-3.5" aria-hidden />
                      View immigration profile
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>

            {/* Similar jobs */}
            {similarJobs.length > 0 && (
              <section id="similar-jobs" className={cn(panel, "p-5 sm:p-6")}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <SectionH icon={Briefcase}>Similar jobs</SectionH>
                  <Link href="/dashboard" className="text-[13px] font-semibold text-[#2563EB] hover:underline">
                    View all
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {similarJobs.map((similar) => {
                    const cardSalary = formatSalaryLabel(
                      similar.salary_min,
                      similar.salary_max,
                      similar.salary_currency ?? "USD"
                    )
                    return (
                      <Link
                        key={similar.id}
                        href={`/dashboard/jobs/${similar.id}`}
                        className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/60 transition hover:bg-white hover:shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <CompanyLogo
                            companyName={similar.company?.name ?? "Company"}
                            domain={similar.company?.domain ?? null}
                            logoUrl={similar.company?.logo_url ?? null}
                            className="h-10 w-10 shrink-0 rounded-lg border-0 bg-transparent"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-slate-900">
                              {cleanJobTitle(similar.title)}
                            </p>
                            <p className="truncate text-[12px] text-slate-500">
                              {similar.company?.name ?? "Unknown company"}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                              {similar.location && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3" aria-hidden />
                                  {similar.location}
                                </span>
                              )}
                              {cardSalary && (
                                <span className="inline-flex items-center gap-1">
                                  <Banknote className="h-3 w-3" aria-hidden />
                                  {cardSalary}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Share row */}
            <section className={cn(panel, "p-5")}>
              <h3 className="text-[13px] font-semibold text-slate-900">Share this job</h3>
              <div className="mt-3">
                <JobShareRow jobTitle={displayTitle} />
              </div>
            </section>
          </div>

          {/* ──────────────────── Right panel ──────────────────── */}
          <aside className="xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-4 [&::-webkit-scrollbar]:w-0">
            <JobDetailPanel
              job={job as Parameters<typeof JobDetailPanel>[0]["job"]}
              initialMatchScore={initialMatchScore}
              displayTitle={displayTitle}
              applyUrl={page.apply_url}
              sponsorsConfirmed={sponsorsConfirmed}
              sponsorshipPill={sponsorshipPill}
              showVisaSignals={true}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}
