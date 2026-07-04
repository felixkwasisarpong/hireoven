/**
 * POST /api/extension/jobs/save
 *
 * Apex MVP save endpoint. Accepts the new minimal ExtractedJob shape from
 * the Apex Bar and persists it via the same tables (companies / jobs /
 * job_applications) used by the legacy /api/extension/jobs/import route.
 *
 * Idempotent — repeated saves of the same canonical URL by the same user
 * return the existing job_applications row with `created: false, updated: true`.
 *
 * Auth: Bearer <ho_session JWT> (same as all other extension routes).
 * Reuses existing helpers in @/lib/extension/auth and @/lib/postgres/server.
 */

import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { fetchEmbeddedGreenhouseJobDetails } from "@/lib/extension/embedded-greenhouse"
import {
  buildExtensionJobFingerprint,
  isPlaceholderJobTitle,
  normalizeExtensionJobUrl,
} from "@/lib/extension/job-fingerprint"
import { enrichJobWithNormalization } from "@/lib/jobs/enrich-job-with-normalization"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { extensionDashboardUrl } from "@/lib/extension/dashboard-url"

export const runtime = "nodejs"

// ── Request / response shapes (mirror chrome-extension/src/api-types.ts) ──────

type SupportedSite =
  | "linkedin"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "indeed"
  | "glassdoor"
  | "unknown"

interface SaveJobBody {
  source: SupportedSite
  url: string
  canonicalUrl?: string
  sourceUrl?: string
  title?: string
  company?: string
  location?: string
  descriptionText?: string
  salaryText?: string
  employmentType?: string
  applyUrl?: string
  detectedAts?: SupportedSite
  externalJobId?: string
  activelyHiring?: boolean
  postedAt?: string
  confidence?: "high" | "medium" | "low"
  extractedAt?: string
}

interface SaveResultBody {
  jobId: string
  created: boolean
  updated: boolean
  dashboardUrl?: string
}

/**
 * Resolve is_remote / is_hybrid / location so the saved job passes the feed's
 * US-location filter (lib/jobs/usa-job-sql.ts). Same logic as the legacy
 * /import route — defaults to "Remote, United States" + is_remote=true when
 * no location signals exist, so user-saved jobs always show up in the feed.
 */
const US_STATE_RE = new RegExp(
  ",\\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\\s*$",
  "i",
)
function resolveLocation(
  raw: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined,
  workMode: string | null | undefined,
): { location: string | null; isRemote: boolean; isHybrid: boolean } {
  const loc = raw?.trim() || null
  const wm = workMode?.trim().toLowerCase() ?? ""

  if (wm.includes("remote")) return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  if (wm.includes("hybrid")) return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }
  if (wm.includes("on-site") || wm.includes("onsite")) return { location: loc, isRemote: false, isHybrid: false }

  if (loc && /\bremote\b/i.test(loc))  return { location: loc, isRemote: true,  isHybrid: false }
  if (loc && /\bhybrid\b/i.test(loc))  return { location: loc, isRemote: false, isHybrid: true  }
  if (/\bremote\b/i.test(title ?? "")) return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  if (/\bhybrid\b/i.test(title ?? "")) return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }

  if (loc && (US_STATE_RE.test(loc) || /united states/i.test(loc))) {
    return { location: loc, isRemote: false, isHybrid: false }
  }

  if (/\bfully remote\b|\bwork from anywhere\b|\bremote-first\b/i.test(description ?? "")) {
    return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  }
  if (/\bhybrid\b/i.test(description ?? "")) {
    return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }
  }

  // No location clue → default to remote so the saved job is always visible.
  return { location: loc ?? "Remote, United States", isRemote: true, isHybrid: false }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<SaveJobBody>(request)
  if (bodyError) return bodyError

  // Minimal validation
  const url = body.url?.trim()
  if (!url) {
    return extensionError(request, 400, "url is required", { headers: corsHeaders })
  }
  const sourceUrl = body.sourceUrl?.trim() || url
  const canonical = normalizeExtensionJobUrl(body.canonicalUrl ?? sourceUrl)
  const parsedApplyUrl = normalizeExtensionJobUrl(body.applyUrl?.trim() || null)
  const rawTitle = body.title?.trim() || "Unknown Role"
  const rawDescription = body.descriptionText?.trim().slice(0, 12000) || null
  const rawCompany = body.company?.trim() || null
  const ats = body.detectedAts ?? body.source

  const fingerprint = buildExtensionJobFingerprint({
    urls: [body.applyUrl, body.canonicalUrl, sourceUrl, url],
    externalJobId: body.externalJobId ?? null,
  })
  const externalJobId = fingerprint.externalJobIds[0] ?? null

  const shouldEnrichEmbeddedGreenhouse =
    (isPlaceholderJobTitle(rawTitle) || !rawDescription || !rawCompany || !body.location?.trim()) &&
    externalJobId != null
  const embeddedDetails = shouldEnrichEmbeddedGreenhouse
    ? await fetchEmbeddedGreenhouseJobDetails({
        urls: [body.applyUrl, body.canonicalUrl, sourceUrl, url],
        externalJobId,
      })
    : null
  const ghScopedCandidateUrl =
    fingerprint.candidateUrls.find((candidate) => /[?&]gh_jid=/i.test(candidate)) ?? null

  // apply_url priority:
  //   1) explicit applyUrl from extractor
  //   2) embedded Greenhouse resolved absolute URL
  //   3) gh_jid-scoped URL candidate
  //   4) canonical URL
  //   5) normalized source URL
  const applyUrl =
    parsedApplyUrl ??
    normalizeExtensionJobUrl(embeddedDetails?.applyUrl ?? null) ??
    normalizeExtensionJobUrl(ghScopedCandidateUrl) ??
    canonical ??
    normalizeExtensionJobUrl(sourceUrl) ??
    url

  const title =
    isPlaceholderJobTitle(rawTitle) && embeddedDetails?.title?.trim()
      ? embeddedDetails.title.trim()
      : rawTitle
  const extractedCompany = rawCompany ?? embeddedDetails?.company?.trim() ?? null
  const description = rawDescription ?? embeddedDetails?.descriptionText?.trim() ?? null
  const extractedLocation = body.location?.trim() || embeddedDetails?.location?.trim() || null

  if (isBlockedCrawlTitle(title) || isPlaceholderJobTitle(title)) {
    return extensionError(request, 422, "Captured page is not a valid job posting (title).", {
      headers: corsHeaders,
    })
  }
  if (isBlockedApplyUrl(applyUrl)) {
    return extensionError(request, 422, "Captured page is not a valid job posting (URL).", {
      headers: corsHeaders,
    })
  }

  // Resolve location, is_remote, is_hybrid using the same heuristics as
  // /import. Critical for the feed's US-only filter — a job with NULL
  // location and is_remote=false would never appear.
  const { location, isRemote, isHybrid } = resolveLocation(
    extractedLocation,
    title,
    description,
    body.employmentType,
  )

  // Trust the extension's signal first; otherwise re-detect from title +
  // description so older client builds without the flag still surface it.
  // Mirrors chrome-extension/src/extractors/apex-extractor.ts and JobCardV2.
  const ACTIVELY_HIRING_RE =
    /\b(?:actively\s+(?:recruiting|hiring|seeking|reviewing\s+(?:applicants?|applications?|candidates?))|urgently?\s+hiring|hiring\s+now|now\s+hiring|immediate(?:ly)?\s+(?:hire|hiring|need|opening)|urgent(?:ly)?\s+(?:hiring|need)|high(?:ly)?\s+priority\s+role)\b/i
  const activelyHiring =
    body.activelyHiring === true ||
    ACTIVELY_HIRING_RE.test(`${title} ${description ?? ""}`)

  // Last-chance company derivation when extraction missed it.
  //
  // ATS-hosted boards put the company in the path or subdomain — NOT the
  // hostname root. Naively title-casing the host root would yield "Greenhouse",
  // "Lever", "Linkedin" etc. as the company, which is wrong.
  //
  //   greenhouse.io/{company}/jobs/...    → path[0]
  //   lever.co/{company}/{uuid}           → path[0]
  //   ashbyhq.com/{company}/{job}         → path[0]
  //   {company}.myworkdayjobs.com/...     → subdomain
  //   linkedin.com / indeed.com / glassdoor.com → unknown (no reliable URL clue)
  //   any other host → treat as a company-branded careers page
  const urlSlugCompany: string | null = (() => {
    const titleCase = (s: string) =>
      s.replace(/[-_+]/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase())
    try {
      const u = new URL(applyUrl)
      const host = u.hostname.toLowerCase().replace(/^www\./, "")
      const path = u.pathname

      // Path-segment ATSes
      if (host === "greenhouse.io" || host.endsWith(".greenhouse.io") ||
          host.endsWith(".lever.co") || host.endsWith(".ashbyhq.com") ||
          host === "lever.co" || host === "ashbyhq.com") {
        const seg = path.split("/").filter(Boolean)[0]
        return seg ? titleCase(decodeURIComponent(seg)) : null
      }

      // Subdomain ATSes (Workday)
      if (host.endsWith(".myworkdayjobs.com") || host.endsWith(".workdayjobs.com")) {
        const sub = host.split(".")[0]
        return sub ? titleCase(sub) : null
      }

      // Job boards — URL doesn't carry the company reliably
      if (host.endsWith("linkedin.com") || host.endsWith("indeed.com") || host.endsWith("glassdoor.com")) {
        return null
      }

      // Company-branded careers page → use the registrable domain root
      const parts = host.split(".")
      const root = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
      return root ? titleCase(root) : null
    } catch {
      return null
    }
  })()
  const companyName: string | null = extractedCompany ?? urlSlugCompany

  const pool = getPostgresPool()

  // ── 1. Resolve company ──────────────────────────────────────────────────────

  // companies.domain has a UNIQUE NOT NULL constraint. Naively using the
  // apply URL's host would collide for every job-board hosted job (every
  // LinkedIn save would be domain="linkedin.com"). The "company domain" is
  // the actual employer site — which we don't know from a job-board URL.
  //
  // For ATS-hosted boards we use the path segment (e.g. greenhouse.io/anthropic
  // → "anthropic.unknown" placeholder) and for company-branded careers pages
  // we use the host root. Real domain enrichment can later UPDATE these
  // placeholders when better data arrives.
  const { companyDomain, careersUrl } = (() => {
    try {
      const u = new URL(applyUrl)
      const host = u.hostname.toLowerCase().replace(/^www\./, "")
      const isJobBoard =
        host.endsWith("linkedin.com") ||
        host.endsWith("indeed.com") ||
        host.endsWith("glassdoor.com")
      const isAtsHost =
        host === "greenhouse.io" || host.endsWith(".greenhouse.io") ||
        host === "lever.co" || host.endsWith(".lever.co") ||
        host === "ashbyhq.com" || host.endsWith(".ashbyhq.com") ||
        host.endsWith(".myworkdayjobs.com") || host.endsWith(".workdayjobs.com")

      if (isJobBoard || isAtsHost) {
        // Synthetic per-company placeholder so the unique constraint holds
        // across many companies on the same job board / ATS host.
        const slug = (companyName ?? "unknown")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        return {
          companyDomain: `${slug || "unknown"}.apex-placeholder`,
          careersUrl: `${u.protocol}//${u.host}`,
        }
      }
      // Branded careers page: real company domain.
      return { companyDomain: host, careersUrl: `${u.protocol}//${u.host}` }
    } catch {
      return { companyDomain: "unknown.apex-placeholder", careersUrl: applyUrl }
    }
  })()

  let companyId: string | null = null
  if (companyName) {
    const existing = await pool
      .query<{ id: string }>(
        `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [companyName],
      )
      .catch((err: unknown) => {
        console.error("[extension/jobs/save] company SELECT failed:", err)
        return null
      })

    if (existing?.rows[0]) {
      companyId = existing.rows[0].id
    } else {
      const created = await pool
        .query<{ id: string }>(
          `INSERT INTO companies (name, is_active, ats_type, domain, careers_url)
           VALUES ($1, true, $2, $3, $4)
           RETURNING id`,
          [companyName, ats, companyDomain, careersUrl],
        )
        .catch((err: unknown) => {
          console.error("[extension/jobs/save] company INSERT failed:", err)
          return null
        })
      companyId = created?.rows[0]?.id ?? null
    }
  }

  // ── 2. Upsert job by apply_url / external_id ──────────────────────────────

  const existingJob = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE apply_url = $1
          OR ($2::text IS NOT NULL AND external_id = $2::text)
       LIMIT 1`,
      [applyUrl, externalJobId],
    )
    .catch(() => null)

  let jobId: string | null = existingJob?.rows[0]?.id ?? null
  let jobUpdated = false

  if (!jobId) {
    const inserted = await pool
      .query<{ id: string }>(
        `INSERT INTO jobs (
           company_id, title, location, description,
           apply_url, is_remote, is_hybrid, is_active, external_id,
           publication_status,
           raw_data,
           first_detected_at, last_seen_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, true, $8,
           $9,
           $10::jsonb,
           NOW(), NOW()
         )
         RETURNING id`,
        [
          companyId,
          title,
          location,
          description,
          applyUrl,
          isRemote,
          isHybrid,
          externalJobId,
          publicationStatusForJob({ description, skills: [] }),
          JSON.stringify({
            captureSource: "apex-mvp",
            captureAdapter: ats,
            sourceUrl,
            applyUrl,
            canonicalUrl: canonical,
            canonicalSourceUrl: normalizeExtensionJobUrl(sourceUrl),
            canonicalApplyUrl: applyUrl,
            externalJobId,
            employmentType: body.employmentType,
            salaryText: body.salaryText,
            // Field name matches what JobCardV2 reads from raw_data.
            activelyHiring,
            // Posting time as the page presented it. The normalizer will
            // promote this onto the `posted_at` canonical field where present.
            postedAt: body.postedAt ?? null,
            extractedAt: body.extractedAt,
          }),
        ],
      )
      .catch((err: unknown) => {
        console.error("[extension/jobs/save] insert jobs failed:", err)
        return null
      })
    jobId = inserted?.rows[0]?.id ?? null

    // Race-loss recovery: another save may have inserted between our SELECT and INSERT.
    if (!jobId) {
      const retry = await pool
        .query<{ id: string }>(
          `SELECT id
           FROM jobs
           WHERE apply_url = $1
              OR ($2::text IS NOT NULL AND external_id = $2::text)
           LIMIT 1`,
          [applyUrl, externalJobId],
        )
        .catch(() => null)
      jobId = retry?.rows[0]?.id ?? null
    }
  } else {
    // Backfill company_id when we now have a company and the row didn't.
    // Also merge the activelyHiring flag into raw_data on every re-save so a
    // job that wasn't urgent before but is now updates correctly.
    // Build the merge patch dynamically so postedAt is only written when present.
    const rawPatch: Record<string, unknown> = { activelyHiring }
    if (body.postedAt) rawPatch.postedAt = body.postedAt
    if (externalJobId) rawPatch.externalJobId = externalJobId
    if (canonical) rawPatch.canonicalUrl = canonical
    rawPatch.canonicalApplyUrl = applyUrl
    rawPatch.canonicalSourceUrl = normalizeExtensionJobUrl(sourceUrl)
    rawPatch.applyUrl = applyUrl

    await pool
      .query(
        `UPDATE jobs
         SET company_id = COALESCE(company_id, $2::uuid),
             title = CASE
               WHEN lower(coalesce(title, '')) IN ('', 'unknown role', 'no job found', 'open role')
               THEN COALESCE(NULLIF(trim($3), ''), title)
               ELSE title
             END,
             location = COALESCE(NULLIF(trim(location), ''), $4),
             description = CASE
               WHEN lower(coalesce(trim(description), '')) IN ('', 'no job found', 'no job found.')
               THEN COALESCE(NULLIF(trim($5), ''), description)
               ELSE description
             END,
             external_id = COALESCE(NULLIF(trim(external_id), ''), $6),
             raw_data = COALESCE(raw_data, '{}'::jsonb) || $7::jsonb,
             publication_status = CASE
               WHEN $8 = 'published' THEN 'published'
               ELSE publication_status
             END,
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          jobId,
          companyId,
          title,
          location,
          description,
          externalJobId,
          JSON.stringify(rawPatch),
          publicationStatusForJob({ description, skills: [] }),
        ],
      )
      .catch(() => null)
    jobUpdated = true
  }

  if (!jobId) {
    return extensionError(request, 500, "Could not persist job. Please try again.", {
      headers: corsHeaders,
    })
  }

  // ── 3. Idempotent application record ───────────────────────────────────────

  const existingApp = await pool
    .query<{ id: string }>(
      `SELECT id FROM job_applications
       WHERE user_id = $1::uuid AND job_id = $2::uuid AND is_archived = false
       LIMIT 1`,
      [user.sub, jobId],
    )
    .catch(() => null)

  let created = false
  if (!existingApp?.rows[0]) {
    const applicationId = randomUUID()
    const initialTimeline = JSON.stringify([
      {
        id: randomUUID(),
        type: "status_change",
        status: "saved",
        date: new Date().toISOString(),
        auto: true,
        note: "Saved via Hireoven Apex",
      },
    ])

    try {
      // job_applications.company_name has a NOT NULL constraint. When we
      // genuinely couldn't derive a company (e.g. LinkedIn search-pane URLs
      // where neither DOM nor <title> parsing succeeded), insert a clearly
      // marked placeholder rather than failing the save. The dashboard
      // doesn't render this column for the job-detail page (it uses the
      // companies JOIN), so the placeholder is only visible on list views
      // until the user re-saves with better extraction.
      const companyNameForInsert = companyName ?? "—"

      await pool.query(
        `INSERT INTO job_applications (
           id, user_id, job_id, status,
           company_name, job_title, apply_url,
           timeline, interviews, is_archived, source,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, 'saved',
           $4, $5, $6,
           $7::jsonb, '[]'::jsonb, false, 'extension-apex',
           NOW(), NOW()
         )`,
        [
          applicationId,
          user.sub,
          jobId,
          companyNameForInsert,
          title,
          applyUrl,
          initialTimeline,
        ],
      )
      created = true
    } catch (err) {
      console.error("[extension/jobs/save] application insert failed:", err)
      return extensionError(request, 500, "Failed to save job. Please try again.", {
        headers: corsHeaders,
      })
    }
  } else if (companyName) {
    // Re-save on an existing row: backfill stale company_name set to NULL or
    // the legacy "Unknown Company" placeholder. Never overwrite a user-edited
    // or already-good value.
    await pool
      .query(
        `UPDATE job_applications
         SET company_name = $2,
             job_title = COALESCE(NULLIF(trim(job_title), ''), $3, job_title),
             updated_at = NOW()
         WHERE id = $1::uuid
           AND (company_name IS NULL OR company_name = '' OR company_name = 'Unknown Company')`,
        [existingApp.rows[0].id, companyName, title],
      )
      .catch((err: unknown) => {
        console.error("[extension/jobs/save] application backfill failed:", err)
        return null
      })
  }

  // Run the same normalization pipeline as the legacy /import route. This
  // populates the structured sections (about_role, responsibilities,
  // requirements, etc.) the dashboard reads — without it, the job page shows
  // "We are still extracting this role summary…" as a placeholder.
  try {
    await enrichJobWithNormalization(pool, jobId)
  } catch (e) {
    console.error("[extension/jobs/save] normalization enrichment:", e)
  }

  // Location safety net. The normalizer truthfully strips "Remote, United
  // States" when the JD has no remote signal. We keep saved jobs addressable
  // in the tracker by backfilling US location text, but publication_status
  // still controls whether the row appears in discovery feeds.
  await pool
    .query(
      `UPDATE jobs
       SET location = 'United States',
           updated_at = NOW()
       WHERE id = $1::uuid
         AND COALESCE(NULLIF(trim(location), ''), '') = ''
         AND is_remote = false
         AND is_hybrid = false`,
      [jobId],
    )
    .catch((err: unknown) => {
      console.error("[extension/jobs/save] location fallback failed:", err)
      return null
    })

  const result: SaveResultBody = {
    jobId,
    created,
    updated: !created || jobUpdated,
    dashboardUrl: extensionDashboardUrl(request, jobId),
  }

  return NextResponse.json(result, {
    status: created ? 201 : 200,
    headers: corsHeaders,
  })
}
