import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Home as HomeIcon,
  MapPin,
  Plane,
} from "lucide-react"
import JobDetailPanel from "@/components/jobs/JobDetailPanel"
import JobShareRow from "@/components/jobs/JobShareRow"
import { ScoutMiniPanel } from "@/components/scout/ScoutMiniPanel"
import CompanyLogo from "@/components/ui/CompanyLogo"
import {
  formatSalaryLabel,
  resolveJobNormalization,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import {
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
  normalizeSkillKey,
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
  intern: "0 – 1 years",
  junior: "1 – 3 years",
  mid: "3 – 6 years",
  senior: "5+ years",
  staff: "8+ years",
  principal: "10+ years",
  director: "10+ years",
  vp: "12+ years",
  exec: "12+ years",
}

function isLikelyAtomicSkill(value: string) {
  const cleaned = value.trim()
  if (!cleaned) return false
  if (cleaned.length > 48) return false
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length > 6) return false
  return true
}

// Scan qualification/requirement bullets for technology-looking tokens that the
// taxonomy didn't recognise. Signals: internal uppercase (JavaScript, LangChain),
// tech characters (+, #, ., /), or a digit (v3, ES2022). Rejects plain English
// sentences, marketing copy, and HR phrases.
const COMMON_NONTECHNICAL_RE = /^(experience|knowledge|understanding|familiarity|ability|skills?|proficien|proven|strong|excellent|good|great|solid|deep|broad|extensive|working|hands.on|exposure|background|expertise|passion|interest|commitment|focus|emphasis|attention|detail|track record|plus|bonus|nice to have|preferred|required|must|will|can|should|years?|degree|bachelor|master|phd|equivalent|certification|team|cross.functional|stakeholder|communication|collaboration|problem.solving|analytical|leadership|mentoring|writing|verbal|interpersonal|organizational|adaptable|startup|fast.paced|agile|scrum|kanban|sprint|culture|values?|mission|impact|growth|scale|diversity|equity|inclusion|equal|opportunity|accommodation|applicant|candidate|employee|employer|company|organization|position|role|job|work|workplace|office|remote|hybrid|onsite|benefits?|compensation|salary|equity|stock|pto|vacation|insurance|401k|medical|dental|vision|parental|leave|wellness|reimbursement|stipend|learning|development|progress|starts?|believe|join|help|build|make|shape|thrive|succeed|advance)\b/i

function extractTechTokensFromText(items: string[]): string[] {
  const found: string[] = []
  for (const item of items) {
    // Split on common list delimiters and contextual words
    const segments = item.split(/[,;()\[\]"']|\s+(?:and|or|with|using|including|such as|like|e\.g\.)\s+/i)
    for (const seg of segments) {
      const token = seg.trim().replace(/[.:!?]+$/, "").trim()
      if (!token || token.length < 2 || token.length > 40) continue
      const words = token.split(/\s+/)
      if (words.length > 4) continue
      // Must look like a technology name
      const hasTechSignal =
        /[A-Z]/.test(token.slice(1)) ||   // internal uppercase: JavaScript, PyTorch
        /[+#./]/.test(token) ||            // tech chars: C++, C#, Next.js, CI/CD
        /\d/.test(token)                    // version/number: ES2022, Python 3
      if (!hasTechSignal) continue
      // Reject if it reads like a plain English phrase
      if (COMMON_NONTECHNICAL_RE.test(words[0])) continue
      found.push(token)
    }
  }
  return found
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
  { id: "job-details", label: "Job details", icon: FileText },
  { id: "about-company", label: "About company", icon: Building2 },
  { id: "similar-jobs", label: "Similar jobs", icon: Briefcase },
]

// ─── Local primitives ───────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">
      {children}
    </h2>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2.5 text-[14px] leading-[1.7] text-slate-600">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span aria-hidden className="mt-[0.55em] h-[5px] w-[5px] shrink-0 rounded-full bg-orange-400/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

const div = "border-t border-slate-100"

// ─── Page ───────────────────────────────────────────────────────────────────

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
    (seniorityLabel ? EXPERIENCE_BY_SENIORITY[(job.seniority_level ?? "") as string] : null) ??
    "Not specified"

  const aboutRole =
    page.sections.about_role.items.length > 0
      ? page.sections.about_role.items
      : ["We are still extracting this role summary from the source posting."]

  const responsibilities = page.sections.responsibilities.items.length > 0
    ? page.sections.responsibilities.items
    : []

  const requiredItems = dedupe([
    ...page.sections.requirements.items,
    ...page.sections.qualifications.items,
  ])
  const preferredItems = dedupe(page.sections.preferred_qualifications.items)
  // Display-level guards — correct for already-stored jobs where the normalizer
  // may have mis-routed or fragmented content before these fixes were deployed.
  const DISPLAY_NOISE_RE =
    /\b(travel\s+\d|requires?\s+travel|\d+%\s+of\s+the\s+time|performed\s+in\s+an\s+office|office\s+setting|sit\s+and\s+stand|standard\s+office\s+equipment|incumbent|mental\/physical|physical\s+requirements?|lift(?:ing)?\s+\d|sedentary|varies?\s+(?:upon|depending\s+on)\s+the\s+needs\s+of\s+the\s+department|may\s+vary\s+depending\s+on\s+job[- ]related\s+factors|work\s+hours?)\b/i

  const DISPLAY_EEO_RE =
    /\b(equal\s+opportunity|eeo\s+employer|without\s+regard\s+to\s+race|protected\s+veteran|affirmative\s+action|criminal\s+histor|eeoc\s+guidelines)\b/i

  const DISPLAY_BENEFITS_RE =
    /\b(medical|dental|vision|401\s?\(k\)|fsa|hsa|life\s+insurance|paid\s+time\s+off|wellness\s+program|comprehensive\s+benefits?\s+package)\b/i

  function cleanItems(items: string[], opts: { rejectBenefits?: boolean } = {}): string[] {
    const seen = new Set<string>()
    return items.filter((item) => {
      const t = item.trim()
      if (t.length < 15) return false
      // Drop sentence fragments (start mid-sentence)
      if (/^[a-z]/.test(t)) return false
      // Drop noise
      if (DISPLAY_NOISE_RE.test(t)) return false
      // Drop EEO boilerplate in wrong sections
      if (DISPLAY_EEO_RE.test(t)) return false
      // Optionally drop benefits content (for visa section)
      if (opts.rejectBenefits && DISPLAY_BENEFITS_RE.test(t)) return false
      // Deduplicate by lowercased content
      const key = t.toLowerCase().replace(/\s+/g, " ")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const benefitItems = cleanItems(page.sections.benefits.items)
  const compensationItems = cleanItems(page.sections.compensation.items)
  const explicitSkillSignals = normalizeSkillList(
    [...(job.skills ?? []), ...page.skills].filter((value): value is string => typeof value === "string"),
    48
  ).filter(isLikelyAtomicSkill)
  const extractedSkillSignals = extractSkillsFromText(
    displayTitle,
    job.title,
    ...page.sections.skills.items,
    ...page.sections.requirements.items,
    ...page.sections.qualifications.items,
    ...page.sections.preferred_qualifications.items,
    ...page.sections.responsibilities.items
  )
  const consolidatedJobSkills = normalizeSkillList(
    [
      ...explicitSkillSignals,
      ...extractedSkillSignals,
    ],
    40
  )

  const sponsorshipPill = employerSponsorshipPill({ ...job, company })
  const sponsorsConfirmed = employerLikelySponsorsH1b({ ...job, company })

  const visaItems = cleanItems(page.sections.visa.items, { rejectBenefits: true })

  const showVisaJdSection =
    visaItems.length > 0 ||
    page.visa_card_label !== null ||
    sponsorsConfirmed

  const workModel = job.is_remote ? "Remote" : job.is_hybrid ? "Hybrid" : "On-site"
  const workModelLong = job.is_remote ? "Remote-first" : job.is_hybrid ? "Hybrid" : "On-site"

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
           WHERE user_id = $1 AND parse_status = 'complete'
           ORDER BY is_primary DESC, updated_at DESC
           LIMIT 1`,
          [session.sub]
        )
      : Promise.resolve({ rows: [] as ResumeSkillRow[] }),
    page.normalized_title && page.normalized_title.length > 0
      ? pool.query<SimilarJob>(
          `${similarSql} AND j.normalized_title = $1 AND j.id <> $2::uuid LIMIT 4`,
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

  const resumeSkillLabels = normalizeSkillList([
    ...(resumeSkillResult.rows[0]?.top_skills ?? []),
    ...getSkillsBucketValues(resumeSkillResult.rows[0]?.skills ?? null),
    ...extractSkillsFromText(resumeSkillResult.rows[0]?.raw_text ?? null),
  ])

  const taxonomyKeySet = new Set(consolidatedJobSkills.map(normalizeSkillKey))
  const resumeRawText = (resumeSkillResult.rows[0]?.raw_text ?? "").toLowerCase()

  // Fallback: extract technology-looking tokens from qualification/requirement
  // bullets that the taxonomy didn't capture (Prisma, tRPC, LangChain, etc.).
  // Uses the tech-signal heuristic — not raw section items — to avoid marketing
  // copy ("Progress starts with you.") appearing as skills.
  const fallbackTokens = normalizeSkillList(
    extractTechTokensFromText([
      ...page.sections.qualifications.items,
      ...page.sections.requirements.items,
      ...page.sections.preferred_qualifications.items,
      ...page.sections.skills.items,
    ]),
    32
  )
  const fallbackSkillPills = fallbackTokens
    .filter((s) => !taxonomyKeySet.has(normalizeSkillKey(s)))
    .map((skill) => ({
      skill,
      matched: resumeRawText.length > 0 && resumeRawText.includes(skill.toLowerCase()),
    }))

  const requirementSkillPills = [
    ...consolidatedJobSkills.map((skill) => ({
      skill,
      matched: resumeSkillLabels.some((resumeSkill) => skillMatches(skill, resumeSkill)),
    })),
    ...fallbackSkillPills,
  ]

  const similarMap = new Map<string, SimilarJob>()
  for (const entry of similarByTitleResult.rows ?? []) similarMap.set(entry.id, entry)
  for (const entry of similarByCompanyResult.rows ?? []) {
    if (similarMap.size >= 4) break
    similarMap.set(entry.id, entry)
  }
  const similarJobs = [...similarMap.values()].slice(0, 4)

  return (
    <main className="min-h-full bg-slate-50 pb-20">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-[#0C1222]">
        {/* Ambient glows */}
        <div
          className="pointer-events-none absolute -left-48 -top-48 h-[520px] w-[520px] rounded-full bg-orange-600/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-0 bottom-0 h-72 w-72 rounded-full bg-orange-500/5 blur-3xl"
          aria-hidden
        />

        <div className="mx-auto w-full max-w-[1340px] px-4 pt-5 sm:px-6 lg:px-8">
          {/* Back */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 transition hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
            Back to jobs
          </Link>

          {/* Identity row */}
          <div className="mt-6 flex items-start justify-between gap-6 pb-7">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              {/* Logo */}
              <div className="shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-sm">
                <CompanyLogo
                  companyName={company?.name ?? "Company"}
                  domain={company?.domain ?? null}
                  logoUrl={company?.logo_url ?? null}
                  className="h-[60px] w-[60px] rounded-xl border-0 sm:h-[68px] sm:w-[68px]"
                />
              </div>

              <div className="min-w-0">
                <h1 className="text-[22px] font-bold leading-tight tracking-tight text-white sm:text-[28px] lg:text-[30px]">
                  {displayTitle}
                </h1>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-300">
                  {company?.id ? (
                    <Link
                      href={`/companies/${company.id}`}
                      className="font-semibold text-slate-200 transition hover:text-white"
                    >
                      {company.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-200">{company?.name ?? "Unknown company"}</span>
                  )}
                  {company?.id && (
                    <BadgeCheck className="h-4 w-4 text-sky-400" strokeWidth={2.5} aria-hidden />
                  )}
                  {page.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} aria-hidden />
                      {page.location}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <HomeIcon className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} aria-hidden />
                    {workModel}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} aria-hidden />
                    {employmentLabel}
                  </span>
                </div>

                {salaryLabel && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-orange-400">
                    <Banknote className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    {salaryLabel}
                  </p>
                )}

                {/* Quick meta strip */}
                <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                  <span>{postedLabel}</span>
                  <span>·</span>
                  <span>{experienceLabel}</span>
                  {sponsorsConfirmed && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Plane className="h-3 w-3" strokeWidth={2} aria-hidden />
                        H-1B sponsor signal
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* CTA — desktop */}
            <div className="hidden shrink-0 flex-col items-end gap-2.5 sm:flex">
              <a
                href={page.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-[14px] font-bold text-white shadow-[0_4px_24px_rgba(249,115,22,0.35)] transition hover:bg-orange-400 active:scale-[0.98]"
              >
                Apply Now
                <ExternalLink className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              </a>
            </div>
          </div>

          {/* Tab strip */}
          <nav className="border-t border-white/8">
            <div className="flex gap-0.5">
              {TABS.map((tab, index) => {
                const Icon = tab.icon
                return (
                  <a
                    key={tab.id}
                    href={`#${tab.id}`}
                    className={cn(
                      "relative inline-flex h-10 items-center gap-1.5 px-4 text-[12.5px] font-semibold transition",
                      index === 0 ? "text-white" : "text-slate-500 hover:text-slate-200"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                    {tab.label}
                    {index === 0 && (
                      <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-orange-400" />
                    )}
                  </a>
                )
              })}
            </div>
          </nav>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-[1340px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">

          {/* ──────────── Main column ──────────── */}
          <div className="min-w-0">
            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60">

              {/* About the role */}
              <section id="job-details" className="px-6 py-7">
                <SectionHead>About the role</SectionHead>
                <div className="mt-3 space-y-3 text-[14px] leading-[1.7] text-slate-600">
                  {aboutRole.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>
              </section>

              {/* What you'll do */}
              {responsibilities.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>What you&apos;ll do</SectionHead>
                  <BulletList items={responsibilities} />
                </section>
              )}

              {/* Required qualifications */}
              {(requiredItems.length > 0 || requirementSkillPills.length > 0) && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Required qualifications</SectionHead>

                  {requirementSkillPills.length > 0 && (
                    <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/60">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">Skills</p>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {requirementSkillPills.filter((s) => s.matched).length} / {requirementSkillPills.length} matched
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {requirementSkillPills.map(({ skill, matched }) => (
                          <span
                            key={skill}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12.5px] font-medium ring-1",
                              matched
                                ? "bg-white text-emerald-700 ring-emerald-200"
                                : "bg-white text-slate-500 ring-slate-200"
                            )}
                          >
                            {matched && (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} aria-hidden />
                            )}
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {requiredItems.length > 0 && <BulletList items={requiredItems} />}
                </section>
              )}

              {/* Preferred qualifications */}
              {preferredItems.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Preferred qualifications</SectionHead>
                  <BulletList items={preferredItems} />
                </section>
              )}

              {/* Benefits & Compensation */}
              {(benefitItems.length > 0 || compensationItems.length > 0) && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Benefits &amp; compensation</SectionHead>
                  <BulletList items={[...compensationItems, ...benefitItems]} />
                </section>
              )}

              {/* Visa / sponsorship */}
              {showVisaJdSection && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Sponsorship &amp; visa</SectionHead>
                  {visaItems.length > 0 ? (
                    <BulletList items={visaItems} />
                  ) : (
                    <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
                      {sponsorsConfirmed
                        ? "This employer has a historical H-1B sponsorship signal based on LCA records. Verify current policy before applying."
                        : "The job description mentions visa or authorization requirements. Review the full posting for details."}
                    </p>
                  )}
                </section>
              )}

              {/* About company */}
              <section id="about-company" className={cn("px-6 py-7", div)}>
                <SectionHead>About {company?.name ?? "the company"}</SectionHead>
                <div className="mt-4 flex gap-4">
                  <CompanyLogo
                    companyName={company?.name ?? "Company"}
                    domain={company?.domain ?? null}
                    logoUrl={company?.logo_url ?? null}
                    className="h-12 w-12 shrink-0 rounded-xl border-0 bg-transparent"
                  />
                  <div className="min-w-0 flex-1">
                    {page.sections.company_info.items.length > 0 ? (
                      <div className="space-y-3 text-[14px] leading-[1.7] text-slate-600">
                        {page.sections.company_info.items.map((p) => (
                          <p key={p}>{p}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[14px] leading-[1.7] text-slate-600">
                        {company?.name ?? "This company"} is actively hiring and regularly updates openings.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                      {company?.careers_url && (
                        <a
                          href={company.careers_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-orange-600 transition hover:text-orange-500 hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          Careers page
                        </a>
                      )}
                      {company?.id && (
                        <Link
                          href={`/companies/${company.id}`}
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-orange-600 transition hover:text-orange-500 hover:underline"
                        >
                          <Building2 className="h-3.5 w-3.5" aria-hidden />
                          Immigration profile
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Similar jobs */}
              {similarJobs.length > 0 && (
                <section id="similar-jobs" className={cn("px-6 py-7", div)}>
                  <div className="flex items-center justify-between gap-2">
                    <SectionHead>Similar jobs</SectionHead>
                    <Link
                      href="/dashboard"
                      className="text-[12.5px] font-semibold text-orange-600 transition hover:text-orange-500 hover:underline"
                    >
                      View all →
                    </Link>
                  </div>
                  <div className="mt-3 space-y-0.5">
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
                          className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50"
                        >
                          <CompanyLogo
                            companyName={similar.company?.name ?? "Company"}
                            domain={similar.company?.domain ?? null}
                            logoUrl={similar.company?.logo_url ?? null}
                            className="h-9 w-9 shrink-0 rounded-lg border-0 bg-transparent"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-slate-900">
                              {cleanJobTitle(similar.title)}
                            </p>
                            <p className="truncate text-[12px] text-slate-400">
                              {similar.company?.name ?? "Unknown company"}
                              {similar.location ? ` · ${similar.location}` : ""}
                            </p>
                          </div>
                          {cardSalary && (
                            <span className="shrink-0 text-[11.5px] font-medium text-slate-400">
                              {cardSalary}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Share */}
              <div className={cn("px-6 py-5", div)}>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    Share this role
                  </p>
                  <JobShareRow jobTitle={displayTitle} />
                </div>
              </div>
            </div>
          </div>

          {/* ──────────── Sidebar ──────────── */}
          <aside className="xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-4 [&::-webkit-scrollbar]:w-0">
            <JobDetailPanel
              job={job as Parameters<typeof JobDetailPanel>[0]["job"]}
              initialMatchScore={initialMatchScore}
              displayTitle={displayTitle}
              applyUrl={page.apply_url}
              sponsorsConfirmed={sponsorsConfirmed}
              sponsorshipPill={sponsorshipPill}
            />
          </aside>
        </div>
      </div>

      <ScoutMiniPanel
        pagePath={`/dashboard/jobs/${id}`}
        jobId={id}
        companyId={company?.id ?? undefined}
        suggestionChips={["Should I apply?", "What should I fix first?"]}
      />
    </main>
  )
}
