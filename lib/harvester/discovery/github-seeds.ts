/**
 * GitHub seed-list discovery.
 *
 * Curated repos (SimplifyJobs, speedyapply, etc.) maintain markdown tables
 * with hundreds of links pointing directly to ATS job boards. Each one is a
 * row of free coverage — every link that detectAdapter() recognises gives us
 * an `(atsType, slug)` pair we may not have seeded by hand.
 *
 * The extraction is intentionally dumb: pull every URL from the markdown
 * blob, ask the adapter registry which (if any) matches, dedupe across the
 * full corpus by `(atsType, slug)`. Anything that doesn't match a known
 * adapter URL pattern is ignored.
 *
 * Not parsed: company names, role titles, anything in the surrounding
 * markdown table. We use the slug itself as a placeholder name; downstream
 * jobs from the actual harvest carry the real company name in `raw_data`.
 */

import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const URL_REGEX = /https?:\/\/[^\s\[\]()<>"',{}|\\^`]+/g
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_USER_AGENT =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

export type GitHubSeedCandidate = {
  atsType: AtsName
  slug: string
  /** Canonical URL the harvester will store and re-detect. */
  careersUrl: string
}

export type FetchSeedOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

/**
 * Strip trailing punctuation that often clings to URLs in markdown.
 */
function trimTrailing(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"]+$/, "")
}

export function extractCandidates(text: string): GitHubSeedCandidate[] {
  const matches = text.match(URL_REGEX) ?? []
  const seen = new Map<string, GitHubSeedCandidate>()

  for (const raw of matches) {
    const url = trimTrailing(raw)
    const detection = detectAdapter(url)
    if (!detection) continue
    const atsType = detection.adapter.name as AtsName
    const canonical = canonicalCareersUrl(atsType, detection.slug)
    if (!canonical) continue
    const key = `${atsType}:${detection.slug}`
    if (seen.has(key)) continue
    seen.set(key, { atsType, slug: detection.slug, careersUrl: canonical })
  }

  return [...seen.values()]
}

export async function fetchSeedSource(
  url: string,
  options: FetchSeedOptions = {}
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(url, {
      headers: { "user-agent": options.userAgent ?? DEFAULT_USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type SeedSource = {
  /** Display label for logs/telemetry. */
  name: string
  /** Raw text URL to fetch (usually raw.githubusercontent.com/...). */
  url: string
}

export type SeedRunSummary = {
  source: SeedSource
  ok: boolean
  candidates: number
  bytesRead: number
  error: string | null
}

export async function fetchAndExtract(
  source: SeedSource,
  options: FetchSeedOptions = {}
): Promise<{ candidates: GitHubSeedCandidate[]; summary: SeedRunSummary }> {
  const text = await fetchSeedSource(source.url, options)
  if (!text) {
    return {
      candidates: [],
      summary: {
        source,
        ok: false,
        candidates: 0,
        bytesRead: 0,
        error: "fetch failed or non-2xx response",
      },
    }
  }
  const candidates = extractCandidates(text)
  return {
    candidates,
    summary: {
      source,
      ok: true,
      candidates: candidates.length,
      bytesRead: text.length,
      error: null,
    },
  }
}

/** Default seed sources. Override via --source=URL or env on the script. */
export const DEFAULT_SEED_SOURCES: SeedSource[] = [
  {
    name: "SimplifyJobs/New-Grad-Positions",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
  },
  {
    name: "SimplifyJobs/Summer2025-Internships",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/README.md",
  },
  {
    name: "SimplifyJobs/Summer2026-Internships",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
  },
  {
    name: "speedyapply/2025-AI-College-Jobs",
    url: "https://raw.githubusercontent.com/speedyapply/2025-AI-College-Jobs/main/README.md",
  },
  {
    name: "speedyapply/2025-SWE-College-Jobs",
    url: "https://raw.githubusercontent.com/speedyapply/2025-SWE-College-Jobs/main/README.md",
  },
  {
    name: "vanshb03/Summer2026-Internships",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md",
  },
  {
    name: "vanshb03/New-Grad-2025",
    url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2025/dev/README.md",
  },
  {
    name: "SimplifyJobs/New-Grad-Positions-2026",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
  },
]
