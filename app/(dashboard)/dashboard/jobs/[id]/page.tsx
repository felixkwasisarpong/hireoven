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
  Sparkles,
  Share2,
  Users,
  Wrench,
} from "lucide-react"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import JobDetailSidebar from "@/components/jobs/JobDetailSidebar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { parseJobDescriptionSections, type JobDescriptionSection } from "@/lib/jobs/description"
import {
  extractEducationLabel,
  extractExperienceLabel,
  inferJobMetadata,
} from "@/lib/jobs/metadata"
import { cleanJobTitle } from "@/lib/jobs/title"
import { createClient } from "@/lib/supabase/server"
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

function formatEmploymentLabel(value: Job["employment_type"]) {
  if (!value) return null
  if (value === "fulltime") return "Full-time"
  if (value === "parttime") return "Part-time"
  if (value === "internship") return "Internship"
  if (value === "contract") return "Contract"
  return value
}

function formatSeniorityLabel(value: Job["seniority_level"]) {
  if (!value) return null
  if (value === "staff") return "Staff+"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDetectedTime(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function formatSalaryRange(job: Pick<Job, "salary_min" | "salary_max" | "salary_currency">) {
  if (job.salary_min == null || job.salary_max == null) return null
  const sym =
    job.salary_currency === "USD" || !job.salary_currency ? "$" : `${job.salary_currency} `
  return `${sym}${Math.round(job.salary_min / 1000)}K - ${sym}${Math.round(job.salary_max / 1000)}K`
}

function headingKind(value: string | null) {
  const heading = (value ?? "").toLowerCase().trim()
  if (!heading) return "unknown"
  if (/(about|overview|job details|role summary)/i.test(heading)) return "overview"
  if (/(what you'll do|what you will do|responsibilit|day-to-day|impact)/i.test(heading))
    return "responsibilities"
  if (/(minimum|basic|required|must have|requirement)/i.test(heading)) return "minimum"
  if (/(preferred|nice to have|ideal|plus)/i.test(heading)) return "preferred"
  if (/(benefits|perks|compensation)/i.test(heading)) return "benefits"
  if (/(about us|about company|company)/i.test(heading)) return "company"
  return "unknown"
}

function toBulletSentences(paragraphs: string[]) {
  return paragraphs
    .flatMap((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 24)
    )
    .map((sentence) => sentence.replace(/\.$/, "").trim())
}

function uniqTrimmed(values: string[], max: number) {
  const out: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function bucketDescriptionSections(sections: JobDescriptionSection[]) {
  const overview: string[] = []
  const responsibilities: string[] = []
  const minimumRequirements: string[] = []
  const preferredQualifications: string[] = []
  const benefits: string[] = []
  const company: string[] = []

  for (const section of sections) {
    const kind = headingKind(section.heading)
    const bullets = section.bullets.length > 0 ? section.bullets : toBulletSentences(section.paragraphs)

    if (kind === "overview") {
      overview.push(...section.paragraphs)
      continue
    }

    if (kind === "responsibilities") {
      responsibilities.push(...bullets)
      continue
    }

    if (kind === "minimum") {
      minimumRequirements.push(...bullets)
      continue
    }

    if (kind === "preferred") {
      preferredQualifications.push(...bullets)
      continue
    }

    if (kind === "benefits") {
      benefits.push(...bullets)
      continue
    }

    if (kind === "company") {
      company.push(...section.paragraphs)
      continue
    }

    if (overview.length < 3) overview.push(...section.paragraphs.slice(0, 2))
    if (responsibilities.length < 6) responsibilities.push(...section.bullets)
  }

  const fallbackBullets = uniqTrimmed(
    sections.flatMap((section) =>
      section.bullets.length > 0 ? section.bullets : toBulletSentences(section.paragraphs)
    ),
    12
  )

  return {
    overview: uniqTrimmed(overview, 3),
    responsibilities:
      responsibilities.length > 0 ? uniqTrimmed(responsibilities, 8) : fallbackBullets.slice(0, 6),
    minimumRequirements:
      minimumRequirements.length > 0
        ? uniqTrimmed(minimumRequirements, 8)
        : fallbackBullets.slice(0, 6),
    preferredQualifications:
      preferredQualifications.length > 0 ? uniqTrimmed(preferredQualifications, 8) : [],
    benefits: uniqTrimmed(benefits, 6),
    company: uniqTrimmed(company, 2),
  }
}

function inferDepartment(title: string, description: string | null) {
  const blob = `${title}\n${description ?? ""}`
  const rules = [
    { label: "Product", pattern: /\bproduct\b/i },
    { label: "Engineering", pattern: /\b(engineer|developer|software|platform|frontend|backend)\b/i },
    { label: "Data", pattern: /\b(data|analytics|machine learning|ai)\b/i },
    { label: "Design", pattern: /\b(design|ux|ui|research)\b/i },
    { label: "Sales", pattern: /\b(sales|account executive|business development)\b/i },
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

function inferBenefits(description: string | null) {
  if (!description) return []
  const rules = [
    { label: "Health, dental, and vision insurance", pattern: /\b(health|dental|vision|medical)\b/i },
    { label: "401(k) with company match", pattern: /\b401\s?\(k\)|retirement\b/i },
    { label: "Flexible PTO", pattern: /\b(pto|paid time off|vacation)\b/i },
    { label: "Parental leave", pattern: /\bparental leave|maternity|paternity\b/i },
    { label: "Learning and development stipend", pattern: /\b(learning|development|training|tuition)\b/i },
    { label: "Bonus or equity eligibility", pattern: /\b(bonus|equity|stock|rsu)\b/i },
  ]
  return rules.filter((rule) => rule.pattern.test(description)).map((rule) => rule.label)
}

function workAuthorizationLabel(job: Job, inferredRequired: boolean | null) {
  if (job.requires_authorization || inferredRequired) return "United States (Required)"
  if (job.sponsors_h1b) return "Sponsorship supported"
  return "Not specified"
}

export default async function DashboardJobDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: rawJob, error } = await supabase
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", id)
    .eq("is_active", true)
    .single()

  if (error || !rawJob) notFound()

  const job = rawJob as unknown as Job & { company: Company | null }
  const company = job.company

  const displayTitle = cleanJobTitle(job.title)
  const descriptionSections = parseJobDescriptionSections(job.description)
  const content = bucketDescriptionSections(descriptionSections)
  const inferred = inferJobMetadata({
    title: displayTitle,
    description: job.description,
    location: job.location,
  })

  const employmentLabel =
    formatEmploymentLabel(job.employment_type) ??
    formatEmploymentLabel(inferred.employmentType as Job["employment_type"])
  const seniorityLabel =
    formatSeniorityLabel(job.seniority_level) ??
    formatSeniorityLabel(inferred.seniorityLevel as Job["seniority_level"])
  const salaryLabel =
    formatSalaryRange(job) ??
    (inferred.salaryMin && inferred.salaryMax
      ? formatSalaryRange({
          salary_min: inferred.salaryMin,
          salary_max: inferred.salaryMax,
          salary_currency: inferred.salaryCurrency ?? "USD",
        } as Pick<Job, "salary_min" | "salary_max" | "salary_currency">)
      : null)

  const experienceLabel =
    extractExperienceLabel(job.description) ??
    (seniorityLabel ? EXPERIENCE_BY_SENIORITY[(job.seniority_level ?? inferred.seniorityLevel ?? "") as string] : null) ??
    "Not specified"
  const educationLabel = extractEducationLabel(job.description) ?? "Not specified"
  const departmentLabel = job.department ?? inferDepartment(displayTitle, job.description)
  const benefits =
    content.benefits.length > 0 ? content.benefits : inferBenefits(job.description).slice(0, 6)
  const tools = (job.skills ?? []).slice(0, 10)
  const postedLabel = formatDetectedTime(job.first_detected_at)
  const highlightList = uniqTrimmed(
    [
      job.is_hybrid || inferred.isHybrid ? "Hybrid work model" : null,
      job.is_remote || inferred.isRemote ? "Remote-friendly role" : null,
      employmentLabel ? `${employmentLabel} position` : null,
      job.location ? `${job.location} location` : null,
      salaryLabel ? `${salaryLabel} total compensation` : null,
      job.sponsors_h1b ? "H1B sponsorship available" : null,
      ...benefits.slice(0, 2),
    ].filter(Boolean) as string[],
    5
  )

  const selectSimilar =
    "id, title, location, salary_min, salary_max, salary_currency, company:companies(name, domain, logo_url)"

  const similarByTitleResult =
    job.normalized_title && job.normalized_title.length > 0
      ? await supabase
          .from("jobs")
          .select(selectSimilar)
          .eq("is_active", true)
          .eq("normalized_title", job.normalized_title)
          .neq("id", id)
          .limit(3)
      : { data: [] as unknown[], error: null }

  const similarByCompanyResult = await supabase
    .from("jobs")
    .select(selectSimilar)
    .eq("is_active", true)
    .eq("company_id", job.company_id)
    .neq("id", id)
    .limit(6)

  const similarMap = new Map<string, SimilarJob>()
  for (const entry of (similarByTitleResult.data ?? []) as SimilarJob[]) {
    similarMap.set(entry.id, entry)
  }
  for (const entry of (similarByCompanyResult.data ?? []) as SimilarJob[]) {
    if (similarMap.size >= 3) break
    similarMap.set(entry.id, entry)
  }
  const similarJobs = [...similarMap.values()].slice(0, 3)

  const tabs = [
    { id: "overview", label: "Overview", visible: true },
    { id: "qualifications", label: "Qualifications", visible: true },
    { id: "benefits", label: "Benefits", visible: true },
    { id: "company", label: "Company", visible: true },
  ].filter((tab) => tab.visible)

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
                      {job.location ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4" />
                          {job.location}
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
                      {job.sponsors_h1b ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          H1B Sponsorship Available
                        </span>
                      ) : null}
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
                    href={job.apply_url}
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
                  {(content.overview.length > 0
                    ? content.overview
                    : [
                        "We are looking for someone who can drive outcomes quickly, collaborate cross-functionally, and ship high-impact work.",
                      ]
                  ).map((paragraph) => (
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
                      {workAuthorizationLabel(job, inferred.requiresAuthorization)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="text-3xl font-semibold tracking-tight text-strong">What you&apos;ll do</h3>
                {content.responsibilities.length > 0 ? (
                  <ul className="mt-4 space-y-2.5">
                    {content.responsibilities.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-[16px] leading-7 text-muted-foreground">
                        <CheckCircle2 className="mt-[2px] h-4 w-4 flex-shrink-0 text-emerald-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[16px] leading-7 text-muted-foreground">
                    We are still extracting role responsibilities from the source posting.
                  </p>
                )}
              </div>
            </section>

            <section id="qualifications" className="scroll-mt-24 border-t border-border py-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-strong">Minimum Requirements</h3>
                  <ul className="mt-4 space-y-2.5">
                    {(content.minimumRequirements.length > 0
                      ? content.minimumRequirements
                      : ["Requirements are still being parsed from the source page."]
                    ).map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-[15px] leading-7 text-muted-foreground">
                        <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-strong">Preferred Qualifications</h3>
                  <ul className="mt-4 space-y-2.5">
                    {(content.preferredQualifications.length > 0
                      ? content.preferredQualifications
                      : content.minimumRequirements.slice(0, 4)
                    ).map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-[15px] leading-7 text-muted-foreground">
                        <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="benefits" className="scroll-mt-24 border-t border-border py-6">
              <h3 className="text-2xl font-semibold tracking-tight text-strong">Tools &amp; Technologies</h3>
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
                  Tools are still being extracted from the source posting.
                </p>
              )}

              <h3 className="mt-7 text-2xl font-semibold tracking-tight text-strong">Compensation &amp; Benefits</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {benefits.slice(0, 6).map((item, index) => {
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

              <div className="mt-5 rounded-lg border border-border bg-surface-alt px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                This role&apos;s details are sourced and normalized from the original careers page. Final offer terms depend on level and location.
              </div>
            </section>

            <section id="company" className="scroll-mt-24 border-t border-border py-6">
              <h3 className="text-2xl font-semibold tracking-tight text-strong">About {company?.name ?? "the company"}</h3>
              <div className="mt-3 space-y-3">
                {(content.company.length > 0
                  ? content.company
                  : [
                      `${company?.name ?? "This company"} is actively hiring and regularly updates openings on its careers page.`,
                    ]
                ).map((paragraph) => (
                  <p key={paragraph} className="text-[15px] leading-7 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
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
                    const cardSalary = formatSalaryRange({
                      salary_min: similar.salary_min,
                      salary_max: similar.salary_max,
                      salary_currency: similar.salary_currency ?? "USD",
                    } as Pick<Job, "salary_min" | "salary_max" | "salary_currency">)

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
                            <p className="mt-1 truncate text-xs text-muted-foreground">{similar.location ?? "Location not specified"}</p>
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
                href={job.apply_url}
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
            applyUrl={job.apply_url}
            salaryLabel={salaryLabel}
            sponsorsH1b={job.sponsors_h1b}
            sponsorshipScore={job.sponsorship_score}
            skills={job.skills ?? []}
            highlights={highlightList}
            companySummary={content.company[0] ?? null}
          />
        </div>
      </div>
    </main>
  )
}
