import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { findAtsPairForDomain, findCompanyIdByAtsPair } from "@/lib/companies/find-by-ats-pair"
import { crawlCareersPage, type RawJob } from "@/lib/crawler"
import { scanBoardWithAdapter } from "@/lib/career-scan/adapter-scan"
import { resolveCareerBoard } from "@/lib/career-scan/resolve-board"
import { detectAtsFromUrl, type AtsDetection } from "@/lib/companies/detect-ats"
import {
  atsIdentifierFor,
  extractUrlsFromHtml,
  findAtsCandidate,
  safeUrl,
} from "@/lib/career-scan/ats-candidate"
import { cleanJobDescription, normalizeJobApplyUrl } from "@/lib/jobs/description"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { isAllowedLocation } from "@/lib/jobs/location-filter"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { extractSkillsFromText } from "@/lib/skills/taxonomy"
import { getScoringContextForUser, upsertMatchScores } from "@/lib/matching/batch-scorer"
import { buildFastScoreResumeContext, computeFastScore } from "@/lib/matching/fast-scorer"
import { employerSponsorshipPill } from "@/lib/jobs/sponsorship-employer-signal"
import type { Company, EmploymentType, Job, SeniorityLevel } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

const HTML_FETCH_TIMEOUT_MS = 8000
// Adapter fetches are the slow part of a scan (a 409-job Oracle board with
// descriptions takes ~18s); the route budget is 60s, so leave room for
// scoring and persistence after it.
const SCAN_TIMEOUT_MS = 25_000
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
    /** Roles dropped for being outside the US/Canada coverage area. */
    skippedOutsideRegion: number
  }
  jobs: ScoutResponseJob[]
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
  if (looksLikeCompanyName(fromTitle)) return fromTitle!
  // The ATS identifier is a board coordinate, not a name. Feeding a Workday slug
  // through titleCase produced live employers called "Conocophillips:Wd1:External"
  // — only the bare tenant form is name-shaped enough to show a user.
  const fromAts = looksLikeBoardCoordinate(args.atsIdentifier) ? null : titleCase(args.atsIdentifier)
  const parsed = safeUrl(args.submittedUrl)
  const fromHost = titleCase(hostBase(parsed?.hostname ?? ""))
  return fromHost ?? fromAts ?? "Company"
}

/** Board coordinates (`tenant:wd1:Site`, `tenant/Site`) must never become names. */
function looksLikeBoardCoordinate(value: string | null | undefined): boolean {
  if (!value) return false
  return value.includes(":") || value.includes("/")
}

/**
 * A page <title> is only a name if it reads like one. Career sites put taglines
 * there ("Make your next move matter" became a company), and leftover separators
 * survive the cleanup ("Global Payments  |").
 */
function looksLikeCompanyName(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.replace(/[\s|·—–-]+$/g, "").trim()
  if (trimmed.length < 2 || trimmed.length > 60) return false
  // Taglines are sentences; names are not.
  if (trimmed.split(/\s+/).length > 5) return false
  if (/\b(your|our|we|us|you|make|join|find|build|next move|welcome|search)\b/i.test(trimmed)) return false
  return true
}

/**
 * Vendor hosts that identify the ATS, not the employer — a domain taken from one
 * of these would attach every customer of that vendor to the same record.
 */
const ATS_VENDOR_HOST_RE =
  /(^|\.)(myworkdayjobs\.com|workdayjobs\.com|greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|phenompeople\.com|eightfold\.ai|avature\.net|adp\.com|ultipro\.com|ukg\.net|smartrecruiters\.com|jobvite\.com|workable\.com|recruitee\.com|bamboohr\.com|rippling\.com|paylocity\.com|dayforcehcm\.com)$/i

function domainForSource(
  submittedUrl: string,
  detection: AtsDetection | null,
  atsIdentifier: string | null
): string {
  const parsed = safeUrl(submittedUrl)
  const host = parsed?.hostname.toLowerCase().replace(/^www\./, "") ?? ""

  // A branded careers host IS the employer's domain (careers.frostbank.com →
  // frostbank.com), and a real domain is what makes logo lookup work at all.
  if (host && !ATS_VENDOR_HOST_RE.test(host)) {
    return host.replace(/^(careers?|jobs?|talent|apply|recruiting|hire|hiring)\./, "")
  }

  // Submitted URL was the vendor's own host, so it tells us nothing about the
  // employer. Fall back to a synthetic key — but built from the board coordinate
  // so it stays stable, and it is only a placeholder: these rows get no logo
  // until a real domain is resolved. Keeping the old `<identifier>.<ats>-scout`
  // shape means existing rows still match on the domain unique key.
  if (detection && atsIdentifier) return `${atsIdentifier}.${detection.atsType}-scout`
  return host || "unknown.local"
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

  // A board another subsystem already claimed belongs to that company. Without
  // this the scout mints its own `<identifier>.<ats>-scout` domain, which can
  // never collide with the `-discovered` or `-tenant` domains minted for the very
  // same board, so pasting a careers URL created a fresh duplicate of an employer
  // already tracked. That is how Metropolis reached five records.
  const claimedId = await findCompanyIdByAtsPair(args.atsType, args.atsIdentifier, pool)
  if (claimedId) {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `UPDATE companies
          SET careers_url = COALESCE(NULLIF(careers_url, ''), $2),
              direct_ats_url = COALESCE(direct_ats_url, $3),
              raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb)
                || jsonb_build_object('career_site_scout', $4::jsonb),
              updated_at = now()
        WHERE id = $1
        RETURNING id, name`,
      [claimedId, args.careersUrl, args.directAtsUrl, JSON.stringify(intake)],
    )
    return rows[0] ?? null
  }

  try {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `INSERT INTO companies (
         name, domain, careers_url, ats_type, ats_identifier, is_active, status,
         freshness_tier, discovered_via, next_harvest_at, direct_ats_url,
         direct_ats_provider, direct_ats_identifier, direct_ats_url_resolved_at,
         raw_ats_config, created_at, updated_at
       ) VALUES (
         -- Created dormant on purpose: is_active=false, no next_harvest_at.
         -- A scan that returns nothing must not enrol a company for harvesting,
         -- so enrolment happens in enrolCompanyForHarvest() only once usable
         -- roles have actually been persisted.
         $1,$2,$3,$4,$5,false,'unknown','tier_2','user_career_site_scout',NULL,
         $6,$4,$5,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END,
         jsonb_build_object('career_site_scout', $7::jsonb), now(), now()
       )
       ON CONFLICT (domain) DO UPDATE
         SET name = COALESCE(NULLIF(companies.name, ''), EXCLUDED.name),
             careers_url = COALESCE(NULLIF(companies.careers_url, ''), EXCLUDED.careers_url),
             ats_type = COALESCE(EXCLUDED.ats_type, companies.ats_type),
             ats_identifier = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
             -- Existing rows keep their current harvest state. Reactivating a
             -- dead board because someone pasted its URL, before knowing whether
             -- it still lists anything, is what put empty boards in the queue.
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
       VALUES ($1,$2,$3,$4,false,now(),now())
       ON CONFLICT (domain) DO UPDATE
         SET careers_url = COALESCE(NULLIF(companies.careers_url, ''), EXCLUDED.careers_url),
             ats_type = COALESCE(EXCLUDED.ats_type, companies.ats_type),
             updated_at = now()
       RETURNING id, name`,
      [args.name, args.domain, args.careersUrl, args.atsType],
    )
    return rows[0] ?? null
  }
}

/**
 * Enrol a company in the harvester — only called once a scan has actually
 * persisted usable roles.
 *
 * Previously `upsertCompanySource` set is_active/next_harvest_at inline, so a
 * careers page that returned nothing (dead board, JS-only listing, or every role
 * outside US/Canada) still put the company in the crawl queue forever. The
 * harvester then re-fetched an empty board on every cycle.
 *
 * Existing companies keep whatever tier and cadence they already had; this only
 * ever activates and brings the next run forward.
 */
async function enrolCompanyForHarvest(companyId: string): Promise<void> {
  await getPostgresPool().query(
    `UPDATE companies
        SET is_active = true,
            status = CASE WHEN status = 'dead' THEN 'active' ELSE COALESCE(status, 'active') END,
            next_harvest_at = LEAST(COALESCE(next_harvest_at, now()), now()),
            updated_at = now()
      WHERE id = $1`,
    [companyId],
  )
}

async function upsertJobsForScout(
  companyId: string,
  companyName: string,
  rawJobs: RawJob[],
  sourceUrl: string,
): Promise<{ jobs: Job[]; skippedOutsideRegion: number }> {
  const pool = getPostgresPool()
  const now = new Date().toISOString()
  const rows: Job[] = []
  let skippedOutsideRegion = 0

  for (const raw of rawJobs) {
    const title = raw.title?.trim()
    const applyUrl = normalizeJobApplyUrl(raw.url)
    if (!title || !applyUrl) continue
    if (isBlockedCrawlTitle(title) || isBlockedApplyUrl(applyUrl)) continue

    // Site Scout covers US and Canada only. A global careers page otherwise
    // returns roles the user cannot take, and every one of them still gets
    // persisted, scored and counted in "N roles found".
    // isAllowedLocation is conservative by design: ambiguous or bare "Remote"
    // strings pass, so a real US role is never dropped for a vague location.
    if (!isAllowedLocation({ location: raw.location, workMode: raw.workMode })) {
      skippedOutsideRegion += 1
      continue
    }

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

  return { jobs: rows, skippedOutsideRegion }
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
  const directIdentifier = atsIdentifierFor(submittedUrl, directDetection)
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

  // Resolve the board before recording anything.
  //
  // People paste `company.com/careers`, not a board URL. Of ten real careers
  // pages, only three carried an ATS link in their served HTML — the rest are
  // JavaScript apps, and following the obvious next hop (`careers.zoll.com`)
  // lands on another one. The resolver guesses the board coordinate from the
  // domain and company name and confirms each guess by actually fetching jobs,
  // which is what stops a wrong guess attaching another employer's roles here.
  const knownAts = await findAtsPairForDomain(domain).catch(() => null)
  const resolution = await resolveCareerBoard({
    submittedUrl,
    pageLinkUrl: linkedAts?.url ?? null,
    submittedIsAts: Boolean(directDetection),
    domain,
    companyName,
    knownAts,
    timeoutMs: SCAN_TIMEOUT_MS,
  }).catch((err) => {
    console.warn("[career-site-scout] board resolution failed", err)
    return { board: null, pending: null }
  })

  const resolvedBoard = resolution.board
  // A board we identified but could not finish reading inside the budget still
  // gets recorded, so the employer is enrolled and the harvester fills the roles
  // in shortly instead of the paste looking like a failure.
  const pendingBoard = resolution.pending

  // What the resolver confirmed outranks what the URL looked like, because it is
  // backed by a board that actually returned jobs.
  // A board found by probing or from a record we hold is still a branded site
  // that we resolved — the user pasted a careers page, not the board.
  const effectiveClassification: IntakeClassification =
    classification === "ats_board"
      ? "ats_board"
      : resolvedBoard
        ? "branded_site_resolved_to_ats"
        : classification

  const boardAtsType = resolvedBoard?.atsType ?? pendingBoard?.atsType ?? selectedDetection?.atsType ?? null
  const boardIdentifier = resolvedBoard?.slug ?? pendingBoard?.slug ?? selectedIdentifier
  const boardUrl = resolvedBoard?.url ?? pendingBoard?.url ?? directAtsUrl
  const careersUrl = boardUrl ?? submittedUrl

  await upsertAtsTenant({
    atsType: boardAtsType,
    atsIdentifier: boardIdentifier,
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
    atsType: boardAtsType,
    atsIdentifier: boardIdentifier,
    directAtsUrl: boardUrl,
    classification: effectiveClassification,
  })

  if (!company) {
    return NextResponse.json({ error: "Could not record career site source" }, { status: 500 })
  }

  let rawJobs: RawJob[] = []
  let outcomeReason: string | null = null
  /** Out-of-region roles dropped before the scan cap, so the count stays honest. */
  let droppedBeforeCap = 0
  const scanUrl = boardUrl ?? null
  // `pendingBoard` means resolution already spent its budget on this board without
  // finishing. Re-scanning it here would spend the rest of the request the same way.
  if (scanUrl && !pendingBoard && (resolvedBoard || selectedDetection)) {
    const limit = Math.min(
      body?.maxJobs && Number.isFinite(body.maxJobs) ? Math.max(1, Math.min(ATS_SCAN_LIMIT, body.maxJobs)) : ATS_SCAN_LIMIT,
      effectiveClassification === "branded_site_resolved_to_ats" ? BRANDED_SCAN_LIMIT : ATS_SCAN_LIMIT,
    )
    try {
      // Prefer the harvester's adapter. crawlCareersPage is a generic HTML/JSON-LD
      // scraper with no adapter dispatch, so a board that is a JavaScript app over
      // a JSON API reads as empty — Oracle Cloud HCM returned `empty_job_list` for
      // a site with 409 live roles. The adapter reads the same API the harvester
      // will use after enrolment, so what the scan shows matches what gets crawled.
      // The resolver already fetched this board to prove it lists jobs; refetching
      // would double the slowest part of the request for no new information.
      const viaAdapter = resolvedBoard ?? (await scanBoardWithAdapter(scanUrl, { timeoutMs: SCAN_TIMEOUT_MS }))
      if (viaAdapter) {
        // Region-filter before the cap, not after. An adapter returns the whole
        // board, so slicing first spends the scan budget on roles that are then
        // discarded — this Oracle board is 409 roles of which 152 are outside
        // US/CA, so a naive slice(0,100) surfaced barely 60 usable ones.
        const inRegion = viaAdapter.jobs.filter((job) =>
          isAllowedLocation({ location: job.location, workMode: job.workMode }),
        )
        droppedBeforeCap = viaAdapter.jobs.length - inRegion.length
        rawJobs = inRegion.slice(0, limit)
        outcomeReason = viaAdapter.jobs.length > 0 ? null : "empty_job_list"
      } else {
        const result = await crawlCareersPage({
          id: company.id,
          companyName,
          careersUrl: scanUrl,
          lastCrawledAt: null,
          atsType: boardAtsType,
          atsIdentifier: boardIdentifier,
          domain,
        })
        rawJobs = result.jobs.slice(0, limit)
        outcomeReason = result.outcomeReason ?? result.outcomeStatus ?? null
      }
    } catch (err) {
      console.warn("[career-site-scout] scan failed", err)
      outcomeReason = err instanceof Error ? err.message : "crawl_failed"
    }
  } else if (pendingBoard) {
    outcomeReason = "board_too_large_harvest_queued"
  } else {
    outcomeReason = htmlFetch.error ?? "no_ats_board_detected"
  }

  if (rawJobs.length > 0) {
    await upsertAtsTenant({
      atsType: boardAtsType,
      atsIdentifier: boardIdentifier,
      sourceUrl: careersUrl,
      sourceType: "user_career_site_scout",
      companyName,
      domain,
      jobCount: rawJobs.length,
    })
  }

  const upserted = rawJobs.length > 0
    ? await upsertJobsForScout(company.id, companyName, rawJobs, careersUrl)
    : { jobs: [], skippedOutsideRegion: 0 }
  const persistedJobs = upserted.jobs

  // Enrol for harvesting ONLY when the scan produced usable roles. A board that
  // returned nothing — dead, JS-only, or entirely outside US/Canada — is left
  // dormant rather than queued for a crawler that would re-fetch it forever.
  // Enrol when the scan produced roles, and also when we identified a real board
  // that was simply too large to read inside the request budget — AutoZone's
  // Oracle site is 10,000 roles. Enrolling hands it to the harvester, which has
  // no such budget. An empty or unidentified board still enrols nothing, which is
  // what keeps dead boards out of the crawl queue.
  const harvestQueued = persistedJobs.length > 0 || Boolean(pendingBoard)
  if (harvestQueued) {
    await enrolCompanyForHarvest(company.id)
  }
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
      atsType: boardAtsType,
      atsIdentifier: boardIdentifier,
      directAtsUrl,
      harvestQueued,
      outcomeReason,
      skippedOutsideRegion: upserted.skippedOutsideRegion + droppedBeforeCap,
    },
    jobs,
  }

  return NextResponse.json(response)
}
