import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  GraduationCap,
  HeartPulse,
  Laptop,
  MapPin,
  PiggyBank,
  Plane,
  Share2,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import JobDetailSidebar from "@/components/jobs/JobDetailSidebar"
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
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company, Job } from "@/types"

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

function inferDepartment(title: string, description: string | null) {
  const blob = `${title}\n${description ?? ""}`
  const rules = [
    { label: "Product", pattern: /\bproduct\b/i },
    {
      label: "Engineering",
      pattern: /\b(engineer|developer|software|platform|frontend|backend)\b/i,
    },
    { label: "Data", pattern: /\b(data|analytics|machine learning|ai)\b/i },
    { label: "Design", pattern: /\b(design|ux|ui|research)\b/i },
    {
      label: "Sales",
      pattern: /\b(sales|account executive|business development)\b/i,
    },
    { label: "Marketing", pattern: /\b(marketing|growth|brand)\b/i },
    { label: "Operations", pattern: /\b(operations|supply chain|logistics)\b/i },
    { label: "Finance", pattern: /\b(finance|accounting|controller)\b/i },
    { label: "HR", pattern: /\b(hr|human resources|talent|recruit)\b/i },
  ]

  for (const rule of rules) {
    if (rule.pattern.test(blob)) return rule.label
  }

  return "General"
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

export default async function DashboardJobDetailPage({ params }: Props) {
  const { id } = await params
  const pool = getPostgresPool()

  const jobResult = await pool.query(
    `SELECT j.*, to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1::uuid AND j.is_active = true
     LIMIT 1`,
    [id]
  )
  const rawJob = jobResult.rows[0]
  if (!rawJob) notFound()

  const job = rawJob as unknown as Job & { company: Company | null }
  const company = job.company

  const normalized = resolveJobNormalization(
    job as unknown as PersistedJobForNormalization
  )

  const page = normalized.pageView
  const displayTitle = page.title
  const postedLabel = page.posted_at_label ?? "Recently posted"
  const employmentLabel = page.employment_label
  const seniorityLabel = page.seniority_label
  const salaryLabel = page.salary_label
  const experienceLabel =
    extractExperienceLabel(job.description) ??
    (seniorityLabel
      ? EXPERIENCE_BY_SENIORITY[(job.seniority_level ?? "") as string]
      : null) ??
    "Not specified"
  const educationLabel = extractEducationLabel(job.description) ?? "Not specified"
  const departmentLabel = job.department ?? inferDepartment(displayTitle, job.description)

  const aboutRole =
    page.sections.about_role.items.length > 0
      ? page.sections.about_role.items
      : [
          "We are still extracting this role summary from the source posting.",
        ]

  const responsibilities =
    page.sections.responsibilities.items.length > 0
      ? page.sections.responsibilities.items
      : ["Role responsibilities are still being parsed from the source page."]

  const requirements =
    page.sections.requirements.items.length > 0
      ? page.sections.requirements.items
      : ["Requirements are still being parsed from the source page."]

  const preferredQualifications = page.sections.preferred_qualifications.items

  const benefitsAndCompensation = dedupe(
    [...page.sections.benefits.items, ...page.sections.compensation.items],
    9
  )

  const companyInfo =
    page.sections.company_info.items.length > 0
      ? page.sections.company_info.items
      : [
          `${company?.name ?? "This company"} is actively hiring and regularly updates openings on its careers page.`,
        ]

  const applicationInfo = page.sections.application_info.items

  const tools = page.skills.slice(0, 10)

  const similarSql = `SELECT j.id, j.title, j.location, j.salary_min, j.salary_max, j.salary_currency,
       jsonb_build_object('name', c.name, 'domain', c.domain, 'logo_url', c.logo_url) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.is_active = true`

  const similarByTitleResult =
    page.normalized_title && page.normalized_title.length > 0
      ? await pool.query<SimilarJob>(`${similarSql} AND j.normalized_title = $1 AND j.id <> $2::uuid LIMIT 3`, [
          page.normalized_title,
          id,
        ])
      : { rows: [] as SimilarJob[] }

  const similarByCompanyResult = job.company_id
    ? await pool.query<SimilarJob>(`${similarSql} AND j.company_id = $1 AND j.id <> $2::uuid LIMIT 6`, [
        job.company_id,
        id,
      ])
    : { rows: [] as SimilarJob[] }

  const similarMap = new Map<string, SimilarJob>()
  for (const entry of similarByTitleResult.rows ?? []) {
    similarMap.set(entry.id, entry)
  }
  for (const entry of similarByCompanyResult.rows ?? []) {
    if (similarMap.size >= 3) break
    similarMap.set(entry.id, entry)
  }
  const similarJobs = [...similarMap.values()].slice(0, 3)

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "qualifications", label: "Qualifications" },
    { id: "benefits", label: "Skills & Benefits" },
    { id: "company", label: "Company" },
  ]

  return (
    <main className="app-page">
      <div className="app-shell max-w-[1240px] space-y-5 px-4 py-4 sm:px-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-strong"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to search
        </Link>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="surface-panel rounded-xl p-5 sm:p-6">
            <header className="border-b border-border pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <CompanyLogo
                    companyName={company?.name ?? "Company"}
                    domain={company?.domain ?? null}
                    logoUrl={company?.logo_url ?? null}
                    className="h-20 w-20"
                  />

                  <div className="min-w-0">
                    <h1 className="text-4xl font-semibold tracking-tight text-strong">{displayTitle}</h1>
                    <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-strong">
                      <span className="text-strong">{company?.name ?? "Unknown company"}</span>
                      <BadgeCheck className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      {page.location ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4" />
                          {page.location}
                        </span>
                      ) : null}
                      {employmentLabel ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Briefcase className="h-4 w-4" />
                          {employmentLabel}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-4 w-4" />
                        Posted {postedLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Actively Hiring
                      </span>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        {page.sponsorship_label}
                      </span>
                      {seniorityLabel ? (
                        <span className="rounded-full border border-border bg-surface-alt px-3 py-1 text-xs font-medium text-muted-foreground">
                          {seniorityLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={page.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
                    aria-label="Open application"
                    title="Open application"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground"
                    aria-label="Share"
                    title="Share"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </header>

            <nav className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-border pb-3">
              {tabs.map((tab, index) => (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  className={`text-sm font-medium transition-colors hover:text-primary ${
                    index === 0 ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {tab.label}
                </a>
              ))}
            </nav>

            <section id="overview" className="scroll-mt-24 space-y-6 py-6">
              <div>
                <h2 className="text-[30px] font-semibold tracking-tight text-strong">About the role</h2>
                <div className="mt-3 space-y-3">
                  {aboutRole.map((paragraph) => (
                    <p key={paragraph} className="text-[17px] leading-8 text-muted-foreground">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>

              <div className="section-divider-grid rounded-xl">
                <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <Building2 className="h-4 w-4 text-blue-700" />
                      Department
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{departmentLabel}</p>
                  </div>
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <Sparkles className="h-4 w-4 text-blue-700" />
                      Experience
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{experienceLabel}</p>
                  </div>
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <Wrench className="h-4 w-4 text-blue-700" />
                      Level
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{seniorityLabel ?? "Not specified"}</p>
                  </div>
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <GraduationCap className="h-4 w-4 text-blue-700" />
                      Education
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{educationLabel}</p>
                  </div>
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <Briefcase className="h-4 w-4 text-blue-700" />
                      Employment Type
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{employmentLabel ?? "Not specified"}</p>
                  </div>
                  <div className="section-divider-item">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-strong">
                      <Globe className="h-4 w-4 text-blue-700" />
                      Work Authorization
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">
                      {page.sponsorship_label}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="text-3xl font-semibold tracking-tight text-strong">Responsibilities</h3>
                <ul className="mt-4 space-y-2.5">
                  {responsibilities.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-[16px] leading-7 text-muted-foreground">
                      <CheckCircle2 className="mt-[2px] h-4 w-4 flex-shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="qualifications" className="scroll-mt-24 border-t border-border py-6">
              <div className="space-y-8">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-strong">Minimum Requirements</h3>
                  <ul className="mt-4 space-y-2.5">
                    {requirements.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-[15px] leading-7 text-muted-foreground">
                        <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {preferredQualifications.length > 0 ? (
                  <div>
                    <h3 className="text-2xl font-semibold tracking-tight text-strong">Preferred Qualifications</h3>
                    <ul className="mt-4 space-y-2.5">
                      {preferredQualifications.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-[15px] leading-7 text-muted-foreground">
                          <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>

            <section id="benefits" className="scroll-mt-24 border-t border-border py-6">
              <h3 className="text-2xl font-semibold tracking-tight text-strong">Skills from this posting</h3>
              {tools.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {tools.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full border border-border bg-surface-alt px-3 py-1 text-sm font-medium text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
                  No explicit skills list was found in the source posting.
                </p>
              )}

              <h3 className="mt-7 text-2xl font-semibold tracking-tight text-strong">Benefits &amp; Compensation</h3>
              {benefitsAndCompensation.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {benefitsAndCompensation.map((item, index) => {
                    const icon =
                      index % 6 === 0 ? (
                        <HeartPulse className="h-4 w-4 text-blue-700" />
                      ) : index % 6 === 1 ? (
                        <PiggyBank className="h-4 w-4 text-blue-700" />
                      ) : index % 6 === 2 ? (
                        <Plane className="h-4 w-4 text-blue-700" />
                      ) : index % 6 === 3 ? (
                        <Users className="h-4 w-4 text-blue-700" />
                      ) : index % 6 === 4 ? (
                        <BookOpen className="h-4 w-4 text-blue-700" />
                      ) : (
                        <Laptop className="h-4 w-4 text-blue-700" />
                      )

                    return (
                      <div
                        key={item}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-muted-foreground"
                      >
                        {icon}
                        <span>{item}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
                  No explicit benefits or compensation section was found in the source posting.
                </p>
              )}

              <div className="mt-5 rounded-lg border border-border bg-surface-alt px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                This role&apos;s details are sourced and normalized from the original careers page. Final offer terms depend on level and location.
              </div>
            </section>

            <section id="company" className="scroll-mt-24 border-t border-border py-6">
              <h3 className="text-2xl font-semibold tracking-tight text-strong">
                About {company?.name ?? "the company"}
              </h3>
              <div className="mt-3 space-y-3">
                {companyInfo.map((paragraph) => (
                  <p key={paragraph} className="text-[15px] leading-7 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>

              {applicationInfo.length > 0 ? (
                <div className="mt-6 rounded-lg border border-border bg-surface-alt p-4">
                  <h4 className="text-sm font-semibold text-strong">Application info</h4>
                  <ul className="mt-3 space-y-2">
                    {applicationInfo.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {similarJobs.length > 0 ? (
              <section className="border-t border-border pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-2xl font-semibold tracking-tight text-strong">Similar jobs you might like</h3>
                  <Link href="/dashboard" className="text-sm font-semibold text-primary hover:text-primary-hover">
                    View all
                  </Link>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                        className="rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-alt"
                      >
                        <div className="flex items-start gap-2.5">
                          <CompanyLogo
                            companyName={similar.company?.name ?? "Company"}
                            domain={similar.company?.domain ?? null}
                            logoUrl={similar.company?.logo_url ?? null}
                            className="h-9 w-9"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-strong">{cleanJobTitle(similar.title)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {similar.company?.name ?? "Unknown company"}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {similar.location ?? "Location not specified"}
                            </p>
                            {cardSalary ? (
                              <p className="mt-1 text-xs font-medium text-muted-foreground">{cardSalary}</p>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <div className="toolbar-strip border-t border-border pt-6">
              <AutofillButton jobId={job.id} size="default" className="justify-center" />
              <Link
                href={`/dashboard/cover-letter/${job.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-strong transition-colors hover:bg-surface-alt"
              >
                Write cover letter
              </Link>
              <a
                href={page.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Apply directly
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </section>

          <JobDetailSidebar
            jobId={job.id}
            companyName={company?.name ?? "Company"}
            applyUrl={page.apply_url}
            salaryLabel={salaryLabel}
            sponsorsH1b={job.sponsors_h1b}
            sponsorshipScore={job.sponsorship_score}
            skills={page.skills}
            highlights={page.highlights}
            companySummary={companyInfo[0] ?? null}
          />
        </div>
      </div>
    </main>
  )
}
