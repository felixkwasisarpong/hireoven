/**
 * Career-site scan — URL resolution.
 *
 * Entry point for the user-initiated "scan this company's career site" flow.
 * Turns a pasted URL into a concrete { adapter, slug } the harvester can
 * enumerate, or an explicit, user-presentable reason why it can't.
 *
 * This is deliberately the ONLY place that decides whether a scan may start.
 * It reuses `detectAdapter` so all 58 registered ATS adapters are covered by
 * construction — a newly added adapter becomes scannable with no change here.
 */

import { detectAdapter, type AtsAdapter } from "@/lib/harvester/adapters"

/**
 * Job aggregators and social networks. These are refused rather than scanned:
 * their terms forbid automated collection, and unlike a company's own careers
 * page there is no first-party relationship to justify the fetch. The extension
 * already declines to autofill on these for the same reason.
 */
const AGGREGATOR_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "dice.com",
  "simplyhired.com",
  "careerbuilder.com",
  "talent.com",
  "jobs.google.com",
  "handshake.com",
  "joinhandshake.com",
  "wellfound.com",
  "angel.co",
  "otta.com",
  "levels.fyi",
] as const

export type ScanRefusal =
  | { reason: "invalid_url"; message: string }
  | { reason: "not_http"; message: string }
  | { reason: "aggregator"; message: string; host: string }
  | { reason: "unsupported_ats"; message: string; host: string }

export type ScanTarget = {
  adapter: AtsAdapter
  /** Tenant/board identifier the adapter enumerates (e.g. a Greenhouse board token). */
  slug: string
  atsName: AtsAdapter["name"]
  /** Normalized origin+path, safe to persist and show back to the user. */
  normalizedUrl: string
  host: string
}

export type ResolveResult =
  | { ok: true; target: ScanTarget }
  | { ok: false; refusal: ScanRefusal }

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Accept bare hosts ("acme.com/careers") the way a user would paste them.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** Strip credentials, hash and tracking-only query noise for a stable stored URL. */
function normalize(url: URL): string {
  const clean = new URL(url.toString())
  clean.username = ""
  clean.password = ""
  clean.hash = ""
  return clean.toString()
}

/**
 * Resolve a pasted career-site URL to a scannable ATS target.
 *
 * Never throws — every failure is a typed refusal so the caller can show the
 * user a specific reason instead of a generic error.
 */
export function resolveCareerSite(rawUrl: string): ResolveResult {
  const url = parseUrl(rawUrl)
  if (!url) {
    return {
      ok: false,
      refusal: { reason: "invalid_url", message: "That doesn't look like a web address." },
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      refusal: { reason: "not_http", message: "Only http and https links can be scanned." },
    }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "")

  const aggregator = AGGREGATOR_HOSTS.find((h) => hostMatches(host, h))
  if (aggregator) {
    return {
      ok: false,
      refusal: {
        reason: "aggregator",
        host,
        message:
          "That's a job board rather than a company's own careers page. Paste the employer's careers site instead.",
      },
    }
  }

  const detected = detectAdapter(url.toString())
  if (!detected) {
    return {
      ok: false,
      refusal: {
        reason: "unsupported_ats",
        host,
        message:
          "We couldn't identify the job system behind that page yet. Company careers pages hosted on Greenhouse, Lever, Ashby, Workday and 50+ others are supported.",
      },
    }
  }

  return {
    ok: true,
    target: {
      adapter: detected.adapter,
      slug: detected.slug,
      atsName: detected.adapter.name,
      normalizedUrl: normalize(url),
      host,
    },
  }
}
