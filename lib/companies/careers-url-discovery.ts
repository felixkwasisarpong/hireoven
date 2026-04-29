import {
  ATS_DOMAIN_SUFFIXES,
  isAtsDomain,
  isTemporaryCareersUrl,
} from "@/lib/companies/ats-domains"

export type CareersUrlConfidence = "high" | "medium" | "low" | "none"

export type CareersUrlScore = {
  url: string
  confidence: CareersUrlConfidence
  reason: string
}

export type DiscoveryProbe = (input: {
  url: string
  signal?: AbortSignal
}) => Promise<{
  ok: boolean
  status: number | null
  html: string | null
}>

const DEFAULT_DISCOVERY_PATHS = [
  "/careers",
  "/careers/jobs",
  "/jobs",
  "/work-with-us",
  "/join-us",
  "/open-positions",
  "/opportunities",
  "/positions",
  "/about/careers",
  "/about/jobs",
]

// Used by the URL-shape scorer: any of these path keywords on a non-ATS host
// is enough to call the URL "medium" confidence.
const CAREERS_PATH_KEYWORD_RE =
  /\/(careers?|jobs?|positions?|openings?|opportunit\w*|requisition\w*|vacancies|join(?:-us)?|work-with-us|hiring|open-positions)\b/i

// Used by the HTML anchor validator: needs to match anchor `href`s, where we
// want concrete job-listing shapes (a /careers anchor is more often nav).
const JOB_LISTING_PATH_RE =
  /\/(job|jobs|positions?|openings?|opportunit\w*|requisition\w*|vacancies)\b/i

const ATS_HOST_RE = new RegExp(
  `(?:${ATS_DOMAIN_SUFFIXES.map((suffix) =>
    suffix.replace(/\./g, "\\.")
  ).join("|")})`,
  "i"
)

const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

function safeUrl(value: string): URL | null {
  try {
    const trimmed = value.trim()
    if (!trimmed) return null
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
}

/**
 * Synchronous, no-network classifier for an existing careers URL string.
 *
 * Returns the strongest confidence we can assign from URL shape alone:
 *   - high:   url is on a known ATS host (e.g. boards.greenhouse.io/{slug}) and
 *             not a temporary/share variant
 *   - medium: url path contains a careers/jobs keyword on a non-ATS host
 *   - low:    https URL with no listing signals (e.g. plain /careers fallback)
 *   - none:   missing, invalid, or temporary/share URL
 */
export function scoreCareersUrl(rawUrl: string | null | undefined): CareersUrlScore {
  if (!rawUrl?.trim()) {
    return { url: "", confidence: "none", reason: "missing" }
  }

  if (isTemporaryCareersUrl(rawUrl)) {
    return {
      url: rawUrl,
      confidence: "none",
      reason: "temporary_or_share_url",
    }
  }

  const url = safeUrl(rawUrl)
  if (!url || url.protocol !== "https:") {
    return { url: rawUrl, confidence: "none", reason: "invalid_or_non_https" }
  }

  const host = url.hostname.toLowerCase()
  if (isAtsDomain(host)) {
    return {
      url: url.toString(),
      confidence: "high",
      reason: "ats_host",
    }
  }

  if (CAREERS_PATH_KEYWORD_RE.test(url.pathname)) {
    return {
      url: url.toString(),
      confidence: "medium",
      reason: "listing_path_keyword",
    }
  }

  return {
    url: url.toString(),
    confidence: "low",
    reason: "https_url_no_listing_signal",
  }
}

function htmlHasJobPostingJsonLd(html: string): boolean {
  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = (match[1] ?? "").trim()
    if (!raw) continue
    if (/"@type"\s*:\s*"JobPosting"/i.test(raw)) return true
    if (/"@type"\s*:\s*\[[^\]]*"JobPosting"[^\]]*\]/i.test(raw)) return true
  }
  return false
}

function htmlHasAtsHostLink(html: string): boolean {
  return ATS_HOST_RE.test(html)
}

function countJobShapeAnchors(html: string): number {
  let count = 0
  const seen = new Set<string>()
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi
  for (const match of html.matchAll(anchorRe)) {
    const href = match[1]
    if (!href) continue
    if (!JOB_LISTING_PATH_RE.test(href)) continue
    if (seen.has(href)) continue
    seen.add(href)
    count += 1
    if (count >= 10) break
  }
  return count
}

/**
 * Validates a careers-page response body for job-listing signals. Pure, so
 * tests can pass synthetic HTML.
 */
export function classifyCareersPageHtml(input: {
  url: string
  html: string
}): { confidence: CareersUrlConfidence; reason: string } {
  if (htmlHasJobPostingJsonLd(input.html)) {
    return { confidence: "high", reason: "json_ld_job_posting" }
  }
  if (htmlHasAtsHostLink(input.html)) {
    return { confidence: "high", reason: "ats_host_link" }
  }
  const anchors = countJobShapeAnchors(input.html)
  if (anchors >= 3) {
    return { confidence: "medium", reason: `job_shape_anchors_${anchors}` }
  }
  if (anchors >= 1) {
    return { confidence: "low", reason: `job_shape_anchors_${anchors}` }
  }
  return { confidence: "low", reason: "no_listing_signals" }
}

/**
 * Probe a list of candidate paths under a domain and return the best
 * confidence-tagged careers URL discovered. The probe function is injected so
 * call sites can supply a real HTTP fetcher (production) or a fixture map
 * (tests). Returns `none` if nothing scored higher than `low`.
 *
 * The probe must enforce its own timeout and never throw — it should resolve
 * with `{ ok: false, status, html: null }` on failure.
 */
export async function discoverCareersUrl(input: {
  domain: string
  probe: DiscoveryProbe
  paths?: string[]
  signal?: AbortSignal
  /** Maximum number of paths to attempt before giving up. Defaults to all. */
  maxAttempts?: number
}): Promise<CareersUrlScore> {
  const domain = input.domain.trim().toLowerCase().replace(/^www\./, "")
  if (!domain) return { url: "", confidence: "none", reason: "missing_domain" }

  const paths = (input.paths ?? DEFAULT_DISCOVERY_PATHS).slice(
    0,
    input.maxAttempts ?? DEFAULT_DISCOVERY_PATHS.length
  )

  let best: CareersUrlScore = { url: "", confidence: "none", reason: "no_candidates_probed" }

  for (const path of paths) {
    if (input.signal?.aborted) break
    const candidateUrl = `https://${domain}${path}`
    const result = await input.probe({ url: candidateUrl, signal: input.signal })
    if (!result.ok || !result.html) {
      // Track the first 4xx/5xx so we can report a reason if nothing better fires.
      if (best.confidence === "none") {
        best = {
          url: candidateUrl,
          confidence: "none",
          reason: `http_${result.status ?? "error"}`,
        }
      }
      continue
    }
    const classification = classifyCareersPageHtml({
      url: candidateUrl,
      html: result.html,
    })

    if (rank(classification.confidence) > rank(best.confidence)) {
      best = {
        url: candidateUrl,
        confidence: classification.confidence,
        reason: classification.reason,
      }
      if (classification.confidence === "high") break
    }
  }

  return best
}

function rank(confidence: CareersUrlConfidence): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}
