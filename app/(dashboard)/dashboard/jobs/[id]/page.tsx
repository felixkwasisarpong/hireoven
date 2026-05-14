export const dynamic = "force-dynamic"

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
  deriveAboutRoleParagraphs,
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
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extractSkillsFromText,
  filterSkillsByTextEvidence,
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
  id: string
  updated_at: string
  skills: Skills | null
  top_skills: string[] | null
  raw_text: string | null
}

type CachedScoreRow = {
  overall_score: number
  skills_score: number | null
  seniority_score: number | null
  education_score: number | null
  role_fit_score: number | null
  location_score: number | null
  employment_type_score: number | null
  sponsorship_score: number | null
  domain_score: number | null
  matching_skills_count: number
  total_required_skills: number
  skills_match_rate: number | null
  is_seniority_match: boolean | null
  is_education_match: boolean | null
  is_role_fit_match: boolean | null
  is_location_match: boolean | null
  is_employment_type_match: boolean | null
  is_sponsorship_compatible: boolean | null
  score_method: string
  computed_at: string
  resume_version: number
  resume_id: string
  resume_updated_at: string
  user_id: string
  job_id: string
  id: string
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

// Scan qualification/requirement bullets for technology-looking tokens the
// taxonomy didn't recognise. Optimized for precision over recall — the
// taxonomy already covers the common case, this is just for niche tools
// (LangChain, Prisma, tRPC, etc.). Better to drop a real skill than to surface
// "ABILITIES" or "Excellent personal".

// Words that, on their own, are abstract nouns or prose connectives. Catches
// the leading word of items lifted from sentences like "Proficiency with X"
// or "Excellent personal communication". `^…$` is intentional — these match
// only when the *whole* token is the rejected word.
const NON_TECHNICAL_WORD_RE =
  /^(experience|expertise|knowledge|understanding|familiarity|proficiency|proficient|ability|abilities|skill|skills|capability|capabilities|aptitude|attitude|mindset|background|exposure|interest|passion|commitment|focus|attention|excellence|excellent|good|great|solid|strong|deep|broad|extensive|effective|efficient|outstanding|exceptional|proven|demonstrated|hands-on|working|writing|verbal|written|communication|collaboration|teamwork|leadership|mentoring|stakeholder|cross-functional|interpersonal|analytical|organizational|adaptability|adaptable|willingness|willing|ability|able|personal|professional|technical|professional|engineering|application|applications|protocol|protocols|requirement|requirements|qualification|qualifications|degree|bachelor|bachelors|master|masters|phd|years?|year|months?|month|day|days|culture|values?|mission|opportunity|equity|equal|accommodation|insurance|medical|dental|vision|salary|compensation|benefits?|perks?|preferred|required|must|will|can|should|the|a|an|or|and|with|in|on|of|for|to|by|as|e\.g\.?|i\.e\.?|etc\.?|vs\.?|inc\.?|ltd\.?|co\.?|n\/a|tbd|cv|resume)$/i

// Tokens that look like specific named tools, platforms, or skills (any domain).
// Accepts:
//   • CamelCase single words: JavaScript, HubSpot, QuickBooks
//   • Tokens with punctuation: C++, Next.js, CI/CD, FP&A
//   • All-caps acronyms 2–8 chars: AWS, SEO, CRM, EHR, GD&T
//   • Mixed-case-with-digit: ES2022, Python3, S3
//   • Known non-tech proper nouns: Salesforce, Figma, Tableau, etc.
// Tokens that look like dates, prices, or other pure-numeric noise — reject
// regardless of any tech-name heuristic below. Common JD bottoms have things
// like "between 5/4/2026 and 7/10/2026" or "$170,000 - $200,000".
const NUMERIC_NOISE_RE = /^[\d./\-:$,%()\s]+$/

function looksLikeNamedSkillToken(token: string): boolean {
  const words = token.split(/\s+/)
  if (words.length > 1) {
    return words.every(looksLikeNamedSkillToken)
  }

  if (NUMERIC_NOISE_RE.test(token)) return false
  if (NON_TECHNICAL_WORD_RE.test(token)) return false

  // CamelCase (applies to all domains: HubSpot, Salesforce, QuickBooks, PyTorch)
  if (/^[A-Z][a-z]+[A-Z]/.test(token)) return true

  // Special characters common in tool/skill names — but require at least one
  // letter so dates / version strings / prices don't slip through.
  if (/[+#./&]/.test(token) && /[A-Za-z]/.test(token)) return true

  // All-caps acronym (2–8 chars): AWS, SEO, CRM, EHR, SQL, CAD
  if (/^[A-Z]{2,8}$/.test(token)) return true

  // Letter+digit mix: S3, K8s, ES2022, Python3
  if (/^[A-Za-z]+\d/.test(token) || /\d[A-Za-z]/.test(token)) return true

  return false
}

function extractUnknownSkillTokens(items: string[]): string[] {
  const found: string[] = []
  for (const item of items) {
    const segments = item.split(
      /[,;()\[\]"']|\s+(?:and|or|with|using|including|such as|like|e\.g\.)\s+/i
    )
    for (const seg of segments) {
      const token = seg.trim().replace(/[.:!?]+$/, "").trim()
      if (!token || token.length < 2 || token.length > 40) continue
      const words = token.split(/\s+/)
      if (words.length > 4) continue
      if (!looksLikeNamedSkillToken(token)) continue
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

const div = "border-t border-slate-100 first:border-t-0"

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
       WHERE j.id = $1::uuid AND j.is_active = true AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
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

  const aboutRole = deriveAboutRoleParagraphs(
    page.sections.about_role.items,
    page.clean_description
  )

  // Display-level guards — correct for already-stored jobs where the normalizer
  // may have mis-routed or fragmented content before these fixes were deployed.
  const DISPLAY_NOISE_RE =
    /\b(travel\s+\d|requires?\s+travel|\d+%\s+of\s+the\s+time|performed\s+in\s+an\s+office|office\s+setting|sit\s+and\s+stand|standard\s+office\s+equipment|incumbent|mental\/physical|physical\s+requirements?|lift(?:ing)?\s+\d|sedentary|varies?\s+(?:upon|depending\s+on)\s+the\s+needs\s+of\s+the\s+department|may\s+vary\s+depending\s+on\s+job[- ]related\s+factors|work\s+hours?|the\s+employee\s+is\s+required|while\s+performing\s+the\s+duties|essential\s+functions\s+of\s+this\s+job|reasonable\s+accommodations\s+may\s+be\s+made)\b/i

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
      // Drop sentences that are pure heading lead-ins (end with colon, no payload)
      if (/^[^.!?]{0,140}:\s*$/.test(t)) return false
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

  // The same display guards apply to every prose section — fragments and
  // boilerplate are not specific to benefits/comp/visa.
  const responsibilities = cleanItems(page.sections.responsibilities.items)
  const requiredItems = cleanItems(dedupe(page.sections.requirements.items))
  const preferredItems = cleanItems(dedupe(page.sections.preferred_qualifications.items))
  const benefitItems = cleanItems(page.sections.benefits.items)
  const compensationItems = cleanItems(page.sections.compensation.items)
  const explicitSkillSignals = normalizeSkillList(
    [...(job.skills ?? []), ...page.skills].filter((value): value is string => typeof value === "string"),
    48
  ).filter(isLikelyAtomicSkill)
  const extractedSkillSignals = extractSkillsFromText(
    displayTitle,
    job.title,
    page.clean_description,
    ...page.sections.skills.items,
    ...page.sections.requirements.items,
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
  const displayJobSkills = filterSkillsByTextEvidence(
    consolidatedJobSkills,
    displayTitle,
    job.title,
    page.clean_description,
    ...page.sections.skills.items,
    ...page.sections.requirements.items,
    ...page.sections.preferred_qualifications.items
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

  // Score algorithm version stamp — bump when scoring logic changes to bust the cache.
  const SCORE_ALGORITHM_VERSION = new Date("2026-05-14T16:00:00.000Z").getTime()

  const [cachedScoreResult, resumeSkillResult, similarByTitleResult, similarByCompanyResult] = await Promise.all([
    // Lightweight cache check — joins match score with resume updated_at in one query.
    // Avoids loading the full resume/profile on cache hits.
    session?.sub
      ? pool.query<CachedScoreRow>(
          `SELECT jms.*, r.updated_at AS resume_updated_at
           FROM job_match_scores jms
           JOIN resumes r ON r.id = jms.resume_id
             AND r.is_primary = true AND r.parse_status = 'complete'
           WHERE jms.user_id = $1 AND jms.job_id = $2
           ORDER BY jms.computed_at DESC
           LIMIT 1`,
          [session.sub, id]
        )
      : Promise.resolve({ rows: [] as CachedScoreRow[] }),
    session?.sub
      ? pool.query<ResumeSkillRow>(
          `SELECT id, updated_at, skills, top_skills, raw_text
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

  // Resolve match score: cache hit only on the critical path. On a cache miss
  // we leave this `undefined` so JobDetailPanel fetches via /api/match/score
  // after first paint — avoids stalling navigation behind a fresh compute.
  let initialMatchScore: JobMatchScore | null | undefined = undefined

  if (session?.sub) {
    const cached = cachedScoreResult.rows[0] ?? null
    const resumeRow = resumeSkillResult.rows[0] ?? null

    const isCacheFresh = cached && resumeRow && (() => {
      const resumeVersion = Math.floor(new Date(resumeRow.updated_at).getTime() / 1000)
      const computedAt = new Date(cached.computed_at).getTime()
      return cached.resume_version === resumeVersion && computedAt >= SCORE_ALGORITHM_VERSION
    })()

    if (isCacheFresh && cached) {
      // Fast path: cache hit — reconstruct skill pills from already-fetched resume skills
      const jobSkills = filterSkillsByTextEvidence(
        normalizeSkillList(
          (job.skills?.length ? job.skills : displayJobSkills) ?? []
        ),
        job.title,
        job.description ?? "",
        ...page.sections.skills.items,
        ...page.sections.requirements.items,
        ...page.sections.preferred_qualifications.items
      )
      const resumeLabels = normalizeSkillList([
        ...(resumeRow?.top_skills ?? []),
        ...getSkillsBucketValues(resumeRow?.skills ?? null),
      ])
      const resumeLabelKeys = new Set(resumeLabels.map(s => normalizeSkillKey(s)))
      const matchedSkills = jobSkills.filter(s => resumeLabelKeys.has(normalizeSkillKey(s)) || resumeLabels.some(r => skillMatches(s, r)))
      const missingSkills = jobSkills.filter(s => !matchedSkills.includes(s))

      initialMatchScore = {
        ...cached,
        score_breakdown: {
          overallScore: cached.overall_score,
          skillsScore: cached.skills_score,
          experienceScore: cached.seniority_score,
          seniorityScore: null,
          locationScore: null,
          employmentTypeScore: null,
          sponsorshipScore: cached.sponsorship_score,
          visaFitScore: null,
          freshnessScore: null,
          matchedSkills,
          missingSkills,
          totalRequiredSkills: cached.total_required_skills,
          scoreMethod: cached.score_method as "fast" | "deep",
          confidence: "medium",
          concerns: [],
          computedAt: cached.computed_at,
        },
      } as unknown as JobMatchScore
    }
    // Cache miss: leave `initialMatchScore` undefined so the client fetches
    // and computes after first paint via the /api/match/score endpoint.
  }

  const resumeSkillLabels = normalizeSkillList([
    ...(resumeSkillResult.rows[0]?.top_skills ?? []),
    ...getSkillsBucketValues(resumeSkillResult.rows[0]?.skills ?? null),
    ...extractSkillsFromText(resumeSkillResult.rows[0]?.raw_text ?? null),
  ])

  const taxonomyKeySet = new Set(displayJobSkills.map(normalizeSkillKey))
  const resumeRawText = (resumeSkillResult.rows[0]?.raw_text ?? "").toLowerCase()

  // Fallback: extract technology-looking tokens from qualification/requirement
  // bullets that the taxonomy didn't capture (Prisma, tRPC, LangChain, etc.).
  // Uses the tech-signal heuristic — not raw section items — to avoid marketing
  // copy ("Progress starts with you.") appearing as skills.
  const fallbackTokens = normalizeSkillList(
    extractUnknownSkillTokens([
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
    ...displayJobSkills.map((skill) => ({
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
            <div className="flex gap-0.5 overflow-x-auto">
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
            <div id="job-details" className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60 scroll-mt-4">

              {/* About the role */}
              {aboutRole.length > 0 && (
                <section className="px-6 py-7">
                  <SectionHead>About the role</SectionHead>
                  <div className="mt-3 space-y-3 text-[14px] leading-[1.7] text-slate-600">
                    {aboutRole.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </div>
                </section>
              )}

              {/* What you'll do */}
              {responsibilities.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>What you&apos;ll do</SectionHead>
                  <BulletList items={responsibilities} />
                </section>
              )}

              {/* Requirements */}
              {(requiredItems.length > 0 || requirementSkillPills.length > 0) && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Requirements</SectionHead>

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

              {/* Nice to have */}
              {preferredItems.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Nice to have</SectionHead>
                  <BulletList items={preferredItems} />
                </section>
              )}

              {/* Compensation */}
              {compensationItems.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Compensation</SectionHead>
                  <BulletList items={compensationItems} />
                </section>
              )}

              {/* Benefits & perks */}
              {benefitItems.length > 0 && (
                <section className={cn("px-6 py-7", div)}>
                  <SectionHead>Benefits &amp; perks</SectionHead>
                  <BulletList items={benefitItems} />
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
                    {page.sections.company_info.items.length > 0 && (
                      <div className="space-y-3 text-[14px] leading-[1.7] text-slate-600">
                        {page.sections.company_info.items.map((p) => (
                          <p key={p}>{p}</p>
                        ))}
                      </div>
                    )}
                    <div className={cn(
                      "flex flex-wrap gap-x-4 gap-y-2",
                      page.sections.company_info.items.length > 0 ? "mt-3" : ""
                    )}>
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
