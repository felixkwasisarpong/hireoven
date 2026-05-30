/**
 * resolveCareerSource — the front half of the discovery flow as one function.
 *
 *   SourceSignal {name, domainHint?, location?}
 *     → resolveDomain()            (lib/discovery/resolve-domain)
 *     → discoverCareersUrl()       (lib/companies/careers-url-discovery)
 *     → detectAdapter / detectAtsFromHtml
 *     → USA confirmation           (lib/discovery/usa-confirm + JobPosting JSON-LD)
 *     → computeConfidence()        (lib/discovery/confidence-score)
 *
 * Pure with respect to the DB: it takes a SourceSignal, performs at most a
 * handful of HTTP requests, and returns a scored ResolvedSource. Persistence
 * (companies vs discovered_candidates) lives in persistResolvedSource() so the
 * resolution logic stays unit-testable without a pool. Mirrors the
 * discover-lever-tenants insert/gate split.
 */

import type { Pool } from "pg"
import { buildCrawlerRequestHeaders, detectBlockedHtml } from "@/lib/crawler/http"
import {
  discoverCareersUrl,
  type DiscoveryProbe,
} from "@/lib/companies/careers-url-discovery"
import { detectAtsFromHtml } from "@/lib/companies/ats-signatures"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { isUsaLocation } from "@/lib/discovery/usa-confirm"
import { resolveDomain, type ResolveDomainInput } from "@/lib/discovery/resolve-domain"
import type { SourceSignal } from "@/lib/discovery/source-signal"

export type ResolvedSource = {
  signal: SourceSignal
  decision: "enroll" | "hold" | "reject"
  score: number
  atsType: string | null
  atsIdentifier: string | null
  careersUrl: string | null
  domain: string | null
  usaConfirmed: boolean
  rejectedReason: string | null
  /** Human-readable per-stage log for auditing weak resolutions. */
  trace: string[]
}

const PROBE_TIMEOUT_MS = 8_000

/**
 * Real-HTTP DiscoveryProbe: fetches a candidate URL, returns its HTML unless
 * it's a block page or non-HTML. Reuses the crawler's header/block helpers so
 * discovery traffic looks identical to the main crawler. Never throws.
 */
export function createHttpProbe(opts: { timeoutMs?: number } = {}): DiscoveryProbe {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  return async ({ url, signal }) => {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: buildCrawlerRequestHeaders(),
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      })
      if (res.status < 200 || res.status >= 400) {
        return { ok: false, status: res.status, html: null }
      }
      const contentType = res.headers.get("content-type") ?? ""
      if (!/text\/html|json|\+xml/.test(contentType)) {
        return { ok: true, status: res.status, html: null }
      }
      const html = await res.text()
      if (detectBlockedHtml(html)) return { ok: false, status: res.status, html: null }
      return { ok: true, status: res.status, html }
    } catch {
      return { ok: false, status: null, html: null }
    }
  }
}

const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** Walk parsed JSON-LD (objects, arrays, @graph) and collect JobPosting nodes. */
function collectJobPostings(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectJobPostings(child, out)
    return
  }
  if (!node || typeof node !== "object") return
  const obj = node as Record<string, unknown>
  const type = obj["@type"]
  const isJobPosting =
    type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))
  if (isJobPosting) out.push(obj)
  if (Array.isArray(obj["@graph"])) collectJobPostings(obj["@graph"], out)
}

function jobPostingIsUsa(posting: Record<string, unknown>): boolean {
  // jobLocation.address.addressCountry — the structured path Google/ATS emit.
  const loc = posting.jobLocation as { address?: { addressCountry?: unknown; addressRegion?: unknown; addressLocality?: unknown } } | undefined
  const addr = Array.isArray(loc) ? (loc[0]?.address ?? {}) : (loc?.address ?? {})
  const country = String(addr?.addressCountry ?? "")
  if (/^(us|usa|united states)/i.test(country.trim())) return true
  const flat = `${addr?.addressLocality ?? ""}, ${addr?.addressRegion ?? ""}`.trim()
  return isUsaLocation(flat)
}

/** Scan a careers page's JSON-LD for JobPosting nodes + how many are USA. */
function scanCareersHtml(html: string): { postings: number; usaPostings: number } {
  let postings = 0
  let usaPostings = 0
  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = (match[1] ?? "").trim()
    if (!raw) continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    const found: Record<string, unknown>[] = []
    collectJobPostings(parsed, found)
    for (const p of found) {
      postings += 1
      if (jobPostingIsUsa(p)) usaPostings += 1
    }
  }
  return { postings, usaPostings }
}

export type ResolveCareerSourceInput = {
  signal: SourceSignal
  probe?: DiscoveryProbe
  knownDomainForName?: ResolveDomainInput["knownDomainForName"]
  /** Previous rejected retries for this candidate (from discovered_candidates). */
  priorRejections?: number
  outerSignal?: AbortSignal
}

export async function resolveCareerSource(
  input: ResolveCareerSourceInput
): Promise<ResolvedSource> {
  const { signal } = input
  const probe = input.probe ?? createHttpProbe()
  const trace: string[] = []

  const base = (extra: Partial<ResolvedSource>): ResolvedSource => ({
    signal,
    decision: "reject",
    score: 0,
    atsType: null,
    atsIdentifier: null,
    careersUrl: null,
    domain: null,
    usaConfirmed: false,
    rejectedReason: null,
    trace,
    ...extra,
  })

  // ── 1. Domain ───────────────────────────────────────────────────────────────
  const domain = await resolveDomain({
    companyName: signal.companyName,
    domainHint: signal.domainHint,
    knownDomainForName: input.knownDomainForName,
    signal: input.outerSignal,
  })
  trace.push(`domain:${domain.source}:${domain.confidence}:${domain.domain ?? "-"}`)
  if (!domain.domain) {
    return base({ decision: "reject", rejectedReason: "domain_unresolved" })
  }

  // ── 2. Careers page ──────────────────────────────────────────────────────────
  const careers = await discoverCareersUrl({
    domain: domain.domain,
    probe,
    signal: input.outerSignal,
  })
  trace.push(`careers:${careers.confidence}:${careers.reason}:${careers.url || "-"}`)

  // ── 3. ATS detection ─────────────────────────────────────────────────────────
  let atsType: string | null = null
  let atsIdentifier: string | null = null
  let scan = { postings: 0, usaPostings: 0 }
  let careersReachable = false

  if (careers.url && careers.confidence !== "none") {
    const urlDet = detectAdapter(careers.url)
    if (urlDet) {
      atsType = urlDet.adapter.name
      atsIdentifier = urlDet.slug
      trace.push(`ats:url:${atsType}:${atsIdentifier}`)
    }
    // Fetch the winning page once for JSON-LD USA + (if needed) HTML ATS.
    const page = await probe({ url: careers.url, signal: input.outerSignal })
    if (page.ok && page.html) {
      careersReachable = true
      scan = scanCareersHtml(page.html)
      if (!atsType) {
        const htmlDet = detectAtsFromHtml({ url: careers.url, html: page.html })
        if (htmlDet) {
          atsType = htmlDet.atsType
          trace.push(`ats:html:${atsType}`)
        }
      }
    }
  }

  // Prefer the canonical board URL when we recovered a slug.
  const careersUrl =
    (atsType && atsIdentifier && canonicalCareersUrl(atsType as never, atsIdentifier)) ||
    careers.url ||
    null

  // ── 4. USA confirmation ──────────────────────────────────────────────────────
  const usaFromSample = isUsaLocation(signal.sampleLocation)
  const checkedJobs = scan.postings > 0 || Boolean(signal.sampleLocation)
  const usaConfirmed = usaFromSample || scan.usaPostings > 0
  const usaRejected = checkedJobs && !usaConfirmed
  trace.push(`usa:confirmed=${usaConfirmed}:sample=${usaFromSample}:jsonld=${scan.usaPostings}/${scan.postings}`)

  // ── 5. Score (existing gate + the §4 compute-waste factors) ──────────────────
  const directoryOnly = !atsType && !careersReachable
  const customAtsNoJsonLd = !atsType && careersReachable && scan.postings === 0

  const { score, decision, rejectedReason } = computeConfidence({
    atsMatch: Boolean(atsType),
    apiHttp200: careersReachable,
    jobsFound: scan.postings,
    usaConfirmed,
    usaJobCount: scan.usaPostings,
    fromCuratedSeed: false,
    fromCommonCrawl: false,
    isJobDetailPageOnly: false,
    isDnsFailure: false,
    isLoginRedirect: false,
    isLikelyTrial: false,
    isHttpError: careers.confidence === "none" && !careersReachable,
    priorRejections: input.priorRejections ?? 0,
    // §4 additions (optional fields — see confidence-score.ts):
    usaRejected,
    directoryOnly,
    customAtsNoJsonLd,
  })
  trace.push(`score:${score}:${decision}`)

  return base({
    decision,
    score,
    atsType,
    atsIdentifier,
    careersUrl,
    domain: domain.domain,
    usaConfirmed,
    rejectedReason,
  })
}

/**
 * Persist a ResolvedSource through the same gate the probe scripts use:
 *   enroll → companies (tier_2, next_harvest_at=now() so the worker picks it
 *            up within one tick — matching the "jobs within minutes" goal)
 *   hold   → discovered_candidates, re-verify in 7 days
 *   reject → discovered_candidates with rejected_reason, no retry
 *
 * Returns the action actually taken (an enroll can collapse to a no-op on the
 * unique-domain / unique-(ats_type,ats_identifier) constraints).
 */
export async function persistResolvedSource(
  pool: Pool,
  r: ResolvedSource
): Promise<"enrolled" | "held" | "rejected" | "noop"> {
  if (r.decision === "enroll" && r.atsType && r.careersUrl) {
    const res = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at)
       VALUES ($1,$2,$3,$4,$5,true,'active','tier_2',$6,now())
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [
        r.signal.companyName,
        r.domain ?? `${r.atsIdentifier}.${r.atsType}-signal`,
        r.careersUrl,
        r.atsType,
        r.atsIdentifier,
        `signal:${r.signal.source}`,
      ]
    )
    return res.rowCount && res.rowCount > 0 ? "enrolled" : "noop"
  }

  const nextRetry =
    r.decision === "hold" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
  await pool.query(
    `INSERT INTO discovered_candidates
       (raw_url, ats_type, ats_identifier, normalized_url, source,
        confidence_score, usa_confirmed, rejected_reason, next_retry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
    [
      r.careersUrl ?? `signal:${r.signal.source}:${r.signal.companyName}`,
      r.atsType,
      r.atsIdentifier,
      r.careersUrl,
      `signal:${r.signal.source}`,
      r.score,
      r.usaConfirmed,
      r.rejectedReason,
      nextRetry,
    ]
  )
  return r.decision === "hold" ? "held" : "rejected"
}
