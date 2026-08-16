import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { crawlCareersPage, type RawJob } from "@/lib/crawler"
import { detectAtsFromUrl, type AtsDetection } from "@/lib/companies/detect-ats"
import { cleanJobDescription, normalizeJobApplyUrl } from "@/lib/jobs/description"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { extractSkillsFromText } from "@/lib/skills/taxonomy"
import { getScoringContextForUser, upsertMatchScores } from "@/lib/matching/batch-scorer"
import { buildFastScoreResumeContext, computeFastScore } from "@/lib/matching/fast-scorer"
import { employerSponsorshipPill } from "@/lib/jobs/sponsorship-employer-signal"
import type { Company, EmploymentType, Job, SeniorityLevel } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

const HTML_FETCH_TIMEOUT_MS = 8000
const ATS_SCAN_LIMIT = Math.max(10, Number.parseInt(process.env.CAREER_SITE_SCOUT_ATS_LIMIT ?? "100", 10))
const BRANDED_SCAN_LIMIT = Math.max(10, Number.parseInt(process.env.CAREER_SITE_SCOUT_BRANDED_LIMIT ?? "50", 10))

type IntakeClassification =
  | "ats_board"
  | "branded_site_resolved_to_ats"
  | "branded_site_recorded"
  | "unsupported_or_blocked_site"

type ScoutResponseJob = {
  jobId: string
  jobTitle: string
  company: string | null
  matchScore: number | null
  applyUrl: string | null
  sponsorshipSignal: string | null
  /**
   * Semantic strength of the sponsorship signal, so the client can colour the
   * pill without the API shipping CSS classes.
   */
  sponsorshipTone: "sponsors" | "strong" | "moderate" | "limited" | "unknown"
  location: string | null
  isRemote: boolean
  status: "pending"
  matchedSkills: string[]
  missingSkills: string[]
  alreadyTracked: boolean
}

type ScoutResponse = {
  source: {
    submittedUrl: string
    scannedUrl: string | null
    classification: IntakeClassification
    companyId: string | null
    companyName: string | null
    domain: string | null
    atsType: string | null
    atsIdentifier: string | null
    directAtsUrl: string | null
    harvestQueued: boolean
    outcomeReason: string | null
  }
  jobs: ScoutResponseJob[]
}

function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    return parsed
  } catch {
    return null
  }
}

function normalizeSubmittedUrl(raw: string): string | null {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`
  const parsed = safeUrl(withScheme)
  if (!parsed) return null
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/"
  return parsed.toString()
}

function hostBase(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".")
  if (parts.length <= 2) return parts[0] ?? hostname
  const first = parts[0]
  if (/^(careers?|jobs?|talent|apply|recruiting|hire|hiring)$/i.test(first)) {
    return parts[1] ?? first
  }
  return parts[parts.length - 2] ?? first
}

function titleCase(value: string | null | undefined): string | null {
  const cleaned = decodeURIComponent(value ?? "")
    .replace(/[-_+.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 180)
}

function companyNameGuess(args: {
  submittedUrl: string
  html?: string | null
  atsIdentifier?: string | null
}): string {
  const fromTitle = args.html?.match(/<title[^>]*>([^<]{2,160})<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .replace(/\b(careers?|jobs?|open roles?|opportunities)\b/gi, "")
    .replace(/[|:;-]+$/g, "")
    .trim()
  if (fromTitle && fromTitle.length >= 2 && fromTitle.length <= 90) return fromTitle
  const fromAts = titleCase(args.atsIdentifier)
  if (fromAts) return fromAts
  const parsed = safeUrl(args.submittedUrl)
  return titleCase(hostBase(parsed?.hostname ?? "Company")) ?? "Company"
}

function fallbackAtsIdentifier(url: string, detection: AtsDetection | null): string | null {
  if (detection?.atsIdentifier) return detection.atsIdentifier
  const parsed = safeUrl(url)
  if (!parsed || !detection) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (detection.atsType === "workday") return host.split(".")[0] || null
  if (detection.atsType === "icims") return host.split(".")[0]?.replace(/^careers?-?/i, "") || null
  if (parts[0]) return parts[0]
  return host.split(".")[0] || null
}

function domainForSource(url: string, detection: AtsDetection | null, atsIdentifier: string | null): string {
  const parsed = safeUrl(url)
  const host = parsed?.hostname.toLowerCase().replace(/^www\./, "") ?? "unknown.local"
  const isKnownAts = Boolean(detection)
  if (isKnownAts && atsIdentifier) return `${atsIdentifier}.${detection!.atsType}-scout`
  return host
}

async function fetchHtml(url: string): Promise<{ html: string | null; status: number | null; error: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Hireoven Career Site Scout/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    const type = res.headers.get("content-type") ?? ""
    if (!type.includes("html") && !type.includes("text/plain")) {
      return { html: null, status: res.status, error: "non_html_response" }
    }
    const html = await res.text()
    return { html, status: res.status, error: res.ok ? null : `http_${res.status}` }
  } catch (err) {
    return { html: null, status: null, error: err instanceof Error ? err.message : "fetch_failed" }
  } finally {
    clearTimeout(timeout)
  }
}

function extractUrlsFromHtml(html: string, baseUrl: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const re = /\b(?:href|src)=["']([^"']{1,1500})["']/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue
    try {
      const url = new URL(raw, baseUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") continue
      url.hash = ""
      const normalized = url.toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
    } catch {
      // ignore malformed links
    }
  }
  return urls
}

function findAtsCandidate(urls: string[]): { url: string; detection: AtsDetection; identifier: string | null } | null {
  for (const url of urls) {
    const detection = detectAtsFromUrl(url)
    if (!detection) continue
    return { url, detection, identifier: fallbackAtsIdentifier(url, detection) }
  }
  return null
}

function inferEmploymentType(raw: string | null | undefined): EmploymentType | null {
  const text = raw?.toLowerCase() ?? ""
  if (/\bintern(ship)?\b/.test(text)) return "internship"
  if (/\bpart[-\s]?time\b/.test(text)) return "parttime"
  if (/\bcontract|temporary|freelance\b/.test(text)) return "contract"
  if (/\bfull[-\s]?time\b/.test(text)) return "fulltime"
  return null
}

function inferSeniority(title: string, description: string | null): SeniorityLevel | null {
  const text = `${title} ${description ?? ""}`.toLowerCase()
  if (/\bintern(ship)?\b|co[-\s]?op|apprentice/.test(text)) return "intern"
  if (/\bjunior\b|\bjr\.?\b|entry[-\s]?level|associate/.test(text)) return "junior"
  if (/\bsenior\b|\bsr\.?\b|\blead\b/.test(text)) return "senior"
  if (/\bstaff\b/.test(text)) return "staff"
  if (/\bprincipal\b/.test(text)) return "principal"
  if (/\bdirector\b/.test(text)) return "director"
  if (/\bvp\b|vice president/.test(text)) return "vp"
  if (/\bchief\b|cto|ceo|cio|coo|cfo|executive/.test(text)) return "exec"
  if (/\bmid[-\s]?level\b/.test(text)) return "mid"
  return null
}

function inferWorkMode(location: string | null | undefined, description: string | null | undefined) {
  const text = `${location ?? ""} ${description ?? ""}`.toLowerCase()
  return {
    isRemote: /\bremote|work from anywhere\b/.test(text),
    isHybrid: /\bhybrid\b/.test(text),
  }
}

function sponsorshipFromDescription(description: string | null | undefined) {
  const text = description ?? ""
  if (!text.trim()) return { sponsors: null as boolean | null, score: 65, signal: null as string | null, requiresAuthorization: false }
  if (/\b(?:will not sponsor|no visa sponsorship|cannot sponsor|unable to sponsor|without sponsorship|u\.?s\.? citizenship required|must be authorized to work)\b/i.test(text)) {
    return { sponsors: false, score: 0, signal: "No sponsorship", requiresAuthorization: true }
  }
  if (/\b(?:h-?1b|visa sponsorship|will sponsor|sponsorship available|sponsor eligible candidate)\b/i.test(text)) {
    return { sponsors: true, score: 90, signal: "Sponsorship mentioned", requiresAuthorization: false }
  }
  return { sponsors: null, score: 65, signal: null, requiresAuthorization: false }
}

function externalIdFor(raw: RawJob, url: string): string {
  const explicit = raw.externalId?.trim()
  if (explicit) return explicit.slice(0, 240)
  return crypto.createHash("sha1").update(url).digest("hex")
}

async function upsertAtsTenant(args: {
  atsType: string | null
  atsIdentifier: string | null
  sourceUrl: string
  sourceType: string
  companyName: string
  domain: string
  jobCount: number
}) {
  if (!args.atsType || !args.atsIdentifier) return null
  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ats_tenants
         (ats_type, ats_identifier, source_url, source_type, company_name_guess,
          domain_guess, confidence, job_count, status, last_checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,85,$7,'discovered',now())
       ON CONFLICT (ats_type, ats_identifier) DO UPDATE
         SET source_url = COALESCE(EXCLUDED.source_url, ats_tenants.source_url),
             source_type = COALESCE(EXCLUDED.source_type, ats_tenants.source_type),
             company_name_guess = COALESCE(EXCLUDED.company_name_guess, ats_tenants.company_name_guess),
             domain_guess = COALESCE(EXCLUDED.domain_guess, ats_tenants.domain_guess),
             job_count = GREATEST(ats_tenants.job_count, EXCLUDED.job_count),
             last_checked_at = now(),
             updated_at = now()
       RETURNING id`,
      [args.atsType, args.atsIdentifier, args.sourceUrl, args.sourceType, args.companyName, args.domain, args.jobCount],
    )
    return rows[0]?.id ?? null
  } catch (err) {
    console.warn("[career-site-scout] ats_tenants upsert failed", err)
    return null
  }
}

async function upsertCompanySource(args: {
  name: string
  domain: string
  submittedUrl: string
  careersUrl: string
  atsType: string | null
  atsIdentifier: string | null
  directAtsUrl: string | null
  classification: IntakeClassification
}) {
  const pool = getPostgresPool()
  const intake = {
    submitted_url: args.submittedUrl,
    careers_url: args.careersUrl,
    direct_ats_url: args.directAtsUrl,
    classification: args.classification,
    checked_at: new Date().toISOString(),
  }

  try {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `INSERT INTO companies (
         name, domain, careers_url, ats_type, ats_identifier, is_active, status,
         freshness_tier, discovered_via, next_harvest_at, direct_ats_url,
         direct_ats_provider, direct_ats_identifier, direct_ats_url_resolved_at,
         raw_ats_config, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,true,'active','tier_2','user_career_site_scout',now(),
         $6,$4,$5,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END,
         jsonb_build_object('career_site_scout', $7::jsonb), now(), now()
       )
       ON CONFLICT (domain) DO UPDATE
         SET name = COALESCE(NULLIF(companies.name, ''), EXCLUDED.name),
             careers_url = COALESCE(NULLIF(companies.careers_url, ''), EXCLUDED.careers_url),
             ats_type = COALESCE(EXCLUDED.ats_type, companies.ats_type),
             ats_identifier = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
             is_active = true,
             status = CASE WHEN companies.status = 'inactive' THEN 'active' ELSE companies.status END,
             next_harvest_at = LEAST(COALESCE(companies.next_harvest_at, now()), now()),
             direct_ats_url = COALESCE(EXCLUDED.direct_ats_url, companies.direct_ats_url),
             direct_ats_provider = COALESCE(EXCLUDED.direct_ats_provider, companies.direct_ats_provider),
             direct_ats_identifier = COALESCE(EXCLUDED.direct_ats_identifier, companies.direct_ats_identifier),
             direct_ats_url_resolved_at = CASE
               WHEN EXCLUDED.direct_ats_url IS NOT NULL THEN now()
               ELSE companies.direct_ats_url_resolved_at
             END,
             raw_ats_config = COALESCE(companies.raw_ats_config, '{}'::jsonb)
               || jsonb_build_object('career_site_scout', $7::jsonb),
             updated_at = now()
       RETURNING id, name`,
      [
        args.name,
        args.domain,
        args.careersUrl,
        args.atsType,
        args.atsIdentifier,
        args.directAtsUrl,
        JSON.stringify(intake),
      ],
    )
    return rows[0] ?? null
  } catch (err) {
    console.warn("[career-site-scout] extended company upsert failed, falling back", err)
    const { rows } = await pool.query<{ id: string; name: string }>(
      `INSERT INTO companies (name, domain, careers_url, ats_type, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,now(),now())
       ON CONFLICT (domain) DO UPDATE
         SET careers_url = COALESCE(NULLIF(companies.careers_url, ''), EXCLUDED.careers_url),
             ats_type = COALESCE(EXCLUDED.ats_type, companies.ats_type),
             is_active = true,
             updated_at = now()
       RETURNING id, name`,
      [args.name, args.domain, args.careersUrl, args.atsType],
    )
    return rows[0] ?? null
  }
}

async function upsertJobsForScout(companyId: string, companyName: string, rawJobs: RawJob[], sourceUrl: string): Promise<Job[]> {
  const pool = getPostgresPool()
  const now = new Date().toISOString()
  const rows: Job[] = []

  for (const raw of rawJobs) {
    const title = raw.title?.trim()
    const applyUrl = normalizeJobApplyUrl(raw.url)
    if (!title || !applyUrl) continue
    if (isBlockedCrawlTitle(title) || isBlockedApplyUrl(applyUrl)) continue

    const description = cleanJobDescription(raw.description ?? null)
    const textForSkills = `${title} ${description ?? ""}`.trim()
    const skills = textForSkills.length >= 40 ? extractSkillsFromText(textForSkills).slice(0, 40) : []
    const workMode = inferWorkMode(raw.location, description)
    const sponsorship = sponsorshipFromDescription(description)
    const externalId = externalIdFor(raw, applyUrl)
    const publicationStatus = publicationStatusForJob({ description, skills })

    const result = await pool.query<Job>(
      `INSERT INTO jobs (
         company_id, title, normalized_title, apply_url, location, employment_type,
         seniority_level, is_remote, is_hybrid, requires_authorization, salary_min,
         salary_max, salary_currency, description, external_id, sponsors_h1b,
         sponsorship_score, visa_language_detected, skills, publication_status,
         is_active, first_detected_at, last_seen_at, raw_data, created_at, updated_at
       ) VALUES (
         $1,$2,lower($2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         true,now(),now(),$20::jsonb,now(),now()
       )
       ON CONFLICT (company_id, external_id)
         WHERE external_id IS NOT NULL AND company_id IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         apply_url = EXCLUDED.apply_url,
         location = COALESCE(EXCLUDED.location, jobs.location),
         employment_type = COALESCE(EXCLUDED.employment_type, jobs.employment_type),
         seniority_level = COALESCE(EXCLUDED.seniority_level, jobs.seniority_level),
         is_remote = EXCLUDED.is_remote,
         is_hybrid = EXCLUDED.is_hybrid,
         requires_authorization = EXCLUDED.requires_authorization,
         salary_min = COALESCE(EXCLUDED.salary_min, jobs.salary_min),
         salary_max = COALESCE(EXCLUDED.salary_max, jobs.salary_max),
         salary_currency = COALESCE(EXCLUDED.salary_currency, jobs.salary_currency),
         description = COALESCE(NULLIF(EXCLUDED.description, ''), jobs.description),
         sponsors_h1b = COALESCE(EXCLUDED.sponsors_h1b, jobs.sponsors_h1b),
         sponsorship_score = GREATEST(COALESCE(jobs.sponsorship_score, 0), COALESCE(EXCLUDED.sponsorship_score, 0)),
         visa_language_detected = COALESCE(EXCLUDED.visa_language_detected, jobs.visa_language_detected),
         skills = CASE WHEN array_length(EXCLUDED.skills, 1) IS NULL THEN jobs.skills ELSE EXCLUDED.skills END,
         publication_status = CASE
           WHEN EXCLUDED.publication_status = 'published' THEN 'published'
           ELSE COALESCE(jobs.publication_status, EXCLUDED.publication_status)
         END,
         is_active = true,
         last_seen_at = now(),
         raw_data = COALESCE(jobs.raw_data, '{}'::jsonb) || EXCLUDED.raw_data,
         updated_at = now()
       RETURNING *`,
      [
        companyId,
        title,
        applyUrl,
        raw.location ?? null,
        inferEmploymentType(raw.employmentType ?? null),
        inferSeniority(title, description),
        workMode.isRemote,
        workMode.isHybrid,
        sponsorship.requiresAuthorization,
        raw.salaryMin ?? null,
        raw.salaryMax ?? null,
        raw.salaryCurrency ?? "USD",
        description,
        externalId,
        sponsorship.sponsors,
        sponsorship.score,
        sponsorship.signal,
        skills.length > 0 ? skills : null,
        publicationStatus,
        JSON.stringify({
          source: "career_site_scout",
          sourceUrl,
          capturedAt: now,
          company: companyName,
          raw: {
            title: raw.title,
            url: raw.url,
            externalId: raw.externalId ?? null,
            location: raw.location ?? null,
            postedAt: raw.postedAt ?? null,
            workMode: raw.workMode ?? null,
            employmentType: raw.employmentType ?? null,
            salaryRange: raw.salaryRange ?? null,
          },
        }),
      ],
    )
    if (result.rows[0]) rows.push(result.rows[0])
  }

  return rows
}

async function scoreJobsForUser(userId: string, jobs: Job[]) {
  const context = await getScoringContextForUser(userId)
  if (!context || jobs.length === 0) return new Map<string, ReturnType<typeof computeFastScore>>()
  const resumeContext = buildFastScoreResumeContext(context.resume)
  const scores = jobs.map((job) =>
    computeFastScore({
      resume: context.resume,
      job,
      profile: context.profile,
      resumeContext,
      targetField: context.resume.target_field,
    }),
  )
  await upsertMatchScores(scores).catch((err) => {
    console.warn("[career-site-scout] score upsert failed", err)
  })
  return new Map(scores.map((score) => [score.job_id, score]))
}

/** The company columns `employerSponsorshipPill` blends in. Single indexed lookup. */
async function loadCompanySponsorship(companyId: string) {
  const { rows } = await getPostgresPool().query<{
    sponsors_h1b: boolean | null
    sponsorship_confidence: number | null
  }>(
    `SELECT sponsors_h1b, sponsorship_confidence FROM companies WHERE id = $1 LIMIT 1`,
    [companyId],
  )
  return rows[0] ?? null
}

/**
 * Map the shared employer pill to a scout signal.
 *
 * The route previously read `job.sponsors_h1b` alone, which is a tri-state that
 * is NULL on every freshly scanned job — enrichment hasn't run yet — so the pill
 * never rendered. `employerSponsorshipPill` is the same helper the job detail
 * page uses and additionally reads `sponsorship_score`, `requires_authorization`
 * and company history, all of which are populated at scan time.
 */
function sponsorshipSignalFor(
  job: Job,
  company: { sponsors_h1b: boolean | null; sponsorship_confidence: number | null } | null,
): { label: string | null; tone: ScoutResponseJob["sponsorshipTone"] } {
  const pill = employerSponsorshipPill({
    ...job,
    company: company as unknown as Company,
  })
  switch (pill.label) {
    case "H-1B sponsorship likely":   return { label: "Sponsors H-1B", tone: "sponsors" }
    case "Strong sponsorship signal": return { label: "Strong sponsor signal", tone: "strong" }
    case "Moderate sponsorship signal": return { label: "Moderate signal", tone: "moderate" }
    case "Limited sponsorship signal": return { label: "No sponsorship", tone: "limited" }
    default:                          return { label: "Sponsorship unclear", tone: "unknown" }
  }
}

async function trackedJobIds(userId: string, jobIds: string[]) {
  if (jobIds.length === 0) return new Set<string>()
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ job_id: string }>(
    `SELECT job_id
     FROM job_applications
     WHERE user_id = $1::uuid
       AND job_id = ANY($2::uuid[])
       AND is_archived = false`,
    [userId, jobIds],
  )
  return new Set(rows.map((row) => row.job_id))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null) as { url?: string; maxJobs?: number } | null
  const submittedUrl = body?.url ? normalizeSubmittedUrl(body.url) : null
  if (!submittedUrl) return NextResponse.json({ error: "A valid career site URL is required" }, { status: 400 })

  const directDetection = detectAtsFromUrl(submittedUrl)
  const directIdentifier = fallbackAtsIdentifier(submittedUrl, directDetection)
  const htmlFetch = directDetection ? { html: null, status: null, error: null } : await fetchHtml(submittedUrl)
  const html = htmlFetch.html
  const linkedAts = html ? findAtsCandidate(extractUrlsFromHtml(html, submittedUrl)) : null

  const selectedDetection = directDetection ?? linkedAts?.detection ?? null
  const selectedIdentifier = directIdentifier ?? linkedAts?.identifier ?? null
  const directAtsUrl = directDetection ? submittedUrl : linkedAts?.url ?? null
  const classification: IntakeClassification =
    directDetection
      ? "ats_board"
      : linkedAts
        ? "branded_site_resolved_to_ats"
        : htmlFetch.error && !html
          ? "unsupported_or_blocked_site"
          : "branded_site_recorded"

  const companyName = companyNameGuess({
    submittedUrl,
    html,
    atsIdentifier: selectedIdentifier,
  })
  const domain = domainForSource(submittedUrl, directDetection, selectedIdentifier)
  const careersUrl = directAtsUrl ?? submittedUrl

  await upsertAtsTenant({
    atsType: selectedDetection?.atsType ?? null,
    atsIdentifier: selectedIdentifier,
    sourceUrl: careersUrl,
    sourceType: "user_career_site_scout",
    companyName,
    domain,
    jobCount: 0,
  })

  const company = await upsertCompanySource({
    name: companyName,
    domain,
    submittedUrl,
    careersUrl,
    atsType: selectedDetection?.atsType ?? null,
    atsIdentifier: selectedIdentifier,
    directAtsUrl,
    classification,
  })

  if (!company) {
    return NextResponse.json({ error: "Could not record career site source" }, { status: 500 })
  }

  let rawJobs: RawJob[] = []
  let outcomeReason: string | null = null
  const scanUrl = directAtsUrl ?? null
  if (scanUrl && selectedDetection) {
    try {
      const result = await crawlCareersPage({
        id: company.id,
        companyName,
        careersUrl: scanUrl,
        lastCrawledAt: null,
        atsType: selectedDetection.atsType,
        atsIdentifier: selectedIdentifier,
        domain,
      })
      const limit = Math.min(
        body?.maxJobs && Number.isFinite(body.maxJobs) ? Math.max(1, Math.min(ATS_SCAN_LIMIT, body.maxJobs)) : ATS_SCAN_LIMIT,
        classification === "branded_site_resolved_to_ats" ? BRANDED_SCAN_LIMIT : ATS_SCAN_LIMIT,
      )
      rawJobs = result.jobs.slice(0, limit)
      outcomeReason = result.outcomeReason ?? result.outcomeStatus ?? null
    } catch (err) {
      console.warn("[career-site-scout] crawl failed", err)
      outcomeReason = err instanceof Error ? err.message : "crawl_failed"
    }
  } else {
    outcomeReason = htmlFetch.error ?? "no_ats_board_detected"
  }

  if (rawJobs.length > 0) {
    await upsertAtsTenant({
      atsType: selectedDetection?.atsType ?? null,
      atsIdentifier: selectedIdentifier,
      sourceUrl: careersUrl,
      sourceType: "user_career_site_scout",
      companyName,
      domain,
      jobCount: rawJobs.length,
    })
  }

  const persistedJobs = rawJobs.length > 0
    ? await upsertJobsForScout(company.id, companyName, rawJobs, careersUrl)
    : []
  // employerSponsorshipPill blends the job row with company-level history.
  // upsertCompanySource only returns id/name, so pull the two fields the
  // blend needs — without them every scanned job looks unsponsored.
  const sponsorshipCompany = await loadCompanySponsorship(company.id)
  const scoresByJob = await scoreJobsForUser(user.id, persistedJobs)
  const tracked = await trackedJobIds(user.id, persistedJobs.map((job) => job.id))

  const jobs: ScoutResponseJob[] = persistedJobs
    .map((job) => {
      const score = scoresByJob.get(job.id)
      const breakdown = score?.score_breakdown
      const sponsorship = sponsorshipSignalFor(job, sponsorshipCompany)
      return {
        jobId: job.id,
        jobTitle: job.title,
        company: company.name ?? companyName,
        matchScore: score?.overall_score ?? null,
        applyUrl: job.apply_url,
        sponsorshipSignal: sponsorship.label,
        sponsorshipTone: sponsorship.tone,
        location: job.location,
        isRemote: job.is_remote,
        status: "pending" as const,
        matchedSkills: breakdown?.matchedSkills?.slice(0, 6) ?? [],
        missingSkills: breakdown?.missingSkills?.slice(0, 6) ?? [],
        alreadyTracked: tracked.has(job.id),
      }
    })
    .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))

  const response: ScoutResponse = {
    source: {
      submittedUrl,
      scannedUrl: scanUrl,
      classification,
      companyId: company.id,
      companyName: company.name ?? companyName,
      domain,
      atsType: selectedDetection?.atsType ?? null,
      atsIdentifier: selectedIdentifier,
      directAtsUrl,
      harvestQueued: true,
      outcomeReason,
    },
    jobs,
  }

  return NextResponse.json(response)
}
