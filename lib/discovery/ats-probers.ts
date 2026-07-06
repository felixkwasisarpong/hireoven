/**
 * Company-first ATS probers.
 *
 * `discover-companies` is platform-first: it scans certificate transparency for
 * *.greenhouse.io etc. to find NEW tenants. This module is the complement —
 * given a company we ALREADY know but haven't matched to a real ATS (the ~39k
 * weak/unmatched rows), generate slug variants from its name and probe each
 * platform's public API for a live board. First hit with jobs wins.
 *
 * Each prober is a cheap existence check (1-2 requests, first page only) — NOT a
 * full crawl. Eightfold especially was invisible to platform-first discovery, so
 * this is what turns the manual Eightfold sweep into an automated loop.
 */

import { harvesterFetch } from "@/lib/harvester/http-agent"

export interface AtsProbeHit {
  atsType: string
  identifier: string
  careersUrl: string
  directAtsUrl: string
  jobCount: number
}

type FetchLike = typeof fetch
const TIMEOUT_MS = 8_000
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** Slug candidates derived from a company name: compact, hyphenated, first word. */
export function slugVariants(name: string): string[] {
  const clean = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|company|co|group|holdings|plc|the|and|&)\b/g, " ")
    .trim()
  const compact = clean.replace(/[^a-z0-9]+/g, "")
  const hyphen = clean.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const firstWord = (clean.split(/\s+/)[0] ?? "").replace(/[^a-z0-9]/g, "")
  return [...new Set([compact, hyphen, firstWord])].filter((s) => s.length >= 3 && s.length <= 40)
}

async function getJson<T>(url: string, doFetch: FetchLike, init?: RequestInit): Promise<T | null> {
  try {
    const r = await doFetch(url, {
      ...init,
      headers: { "user-agent": BROWSER_UA, accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

async function probeWorkable(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  // Workable is path-based (apply.workable.com/{slug}) on ONE shared domain, so
  // crt.sh subdomain-scanning can never discover its tenants — company-first
  // probing is the only way. POST v3 accounts/jobs returns {results, total}.
  try {
    const r = await doFetch(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs`, {
      method: "POST",
      headers: { "user-agent": BROWSER_UA, "content-type": "application/json", accept: "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { total?: number; results?: unknown[] }
    const n = d?.total ?? d?.results?.length ?? 0
    if (n < 1) return null
    const url = `https://apply.workable.com/${slug}/`
    return { atsType: "workable", identifier: slug, careersUrl: url, directAtsUrl: url, jobCount: n }
  } catch {
    return null
  }
}

async function probeGreenhouse(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  const d = await getJson<{ jobs?: unknown[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
    doFetch,
  )
  const n = d?.jobs?.length ?? 0
  if (n < 1) return null
  const url = `https://boards.greenhouse.io/${slug}`
  return { atsType: "greenhouse", identifier: slug, careersUrl: url, directAtsUrl: url, jobCount: n }
}

async function probeLever(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  const d = await getJson<unknown[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, doFetch)
  const n = Array.isArray(d) ? d.length : 0
  if (n < 1) return null
  const url = `https://jobs.lever.co/${slug}`
  return { atsType: "lever", identifier: slug, careersUrl: url, directAtsUrl: url, jobCount: n }
}

async function probeAshby(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  const d = await getJson<{ jobs?: unknown[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
    doFetch,
  )
  const n = d?.jobs?.length ?? 0
  if (n < 1) return null
  const url = `https://jobs.ashbyhq.com/${slug}`
  return { atsType: "ashby", identifier: slug, careersUrl: url, directAtsUrl: url, jobCount: n }
}

async function probeSmartRecruiters(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  const d = await getJson<{ totalFound?: number; content?: unknown[] }>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=10`,
    doFetch,
  )
  const n = d?.totalFound ?? d?.content?.length ?? 0
  if (n < 1) return null
  const url = `https://jobs.smartrecruiters.com/${slug}`
  return { atsType: "smartrecruiters", identifier: slug, careersUrl: url, directAtsUrl: url, jobCount: n }
}

/**
 * Eightfold: GET /careers to mint a session (_vs cookie + CSRF), then count the
 * first page of the session-gated pcsx dialect; fall back to the open apply/v2
 * dialect (HSBC/Bayer-style). Mirrors the adapter's dual-dialect logic, first
 * page only.
 */
async function probeEightfold(slug: string, doFetch: FetchLike): Promise<AtsProbeHit | null> {
  const host = `${slug}.eightfold.ai`
  const domain = `${slug}.com`
  let careers: Response
  try {
    careers = await doFetch(`https://${host}/careers`, {
      headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!careers.ok) return null
  const setCookie = careers.headers.get("set-cookie") ?? ""
  const cookie = setCookie.match(/(_vs=[^;]+)/)?.[1]
  const html = await careers.text().catch(() => "")
  const csrf = html.match(/name=["']_csrf["'][^>]*content=["']([^"']+)["']/)?.[1]

  const hit = (jobCount: number): AtsProbeHit => ({
    atsType: "eightfold",
    identifier: slug,
    careersUrl: `https://${host}/careers`,
    directAtsUrl: `https://${host}`,
    jobCount,
  })

  if (cookie && csrf) {
    const d = await getJson<{ status?: number; data?: { count?: number } }>(
      `https://${host}/api/pcsx/search?domain=${domain}&query=&location=&start=0&sort_by=timestamp`,
      doFetch,
      { headers: { cookie, "x-csrf-token": csrf, referer: `https://${host}/careers` } },
    )
    const n = d?.data?.count ?? 0
    if (n > 0) return hit(n)
  }
  const d2 = await getJson<{ count?: number }>(
    `https://${host}/api/apply/v2/jobs?domain=${domain}&num=10&start=0&sort_by=timestamp`,
    doFetch,
  )
  const n2 = d2?.count ?? 0
  if (n2 > 0) return hit(n2)
  return null
}

export interface Prober {
  atsType: string
  probe: (slug: string, doFetch: FetchLike) => Promise<AtsProbeHit | null>
}

/**
 * Ordered so the platforms crt.sh CANNOT discover come first — Workable and
 * Eightfold are the real blind spots (Workable is path-based on one shared
 * domain; Eightfold was never a crt.sh target). greenhouse/lever/ashby/SR are
 * mostly caught platform-first already, so they're the fallback.
 */
export const PROBERS: Prober[] = [
  { atsType: "workable", probe: probeWorkable },
  { atsType: "eightfold", probe: probeEightfold },
  { atsType: "greenhouse", probe: probeGreenhouse },
  { atsType: "lever", probe: probeLever },
  { atsType: "ashby", probe: probeAshby },
  { atsType: "smartrecruiters", probe: probeSmartRecruiters },
]

/**
 * Probe a company name across all platforms + slug variants. Returns the first
 * board that exists AND has jobs (jobCount > 0). Bounded: at most
 * `PROBERS.length × variants` cheap requests, short-circuiting on the first hit.
 */
export async function probeCompanyForAts(
  name: string,
  doFetch: FetchLike = harvesterFetch,
): Promise<AtsProbeHit | null> {
  const slugs = slugVariants(name)
  if (slugs.length === 0) return null
  // Fire every prober × slug concurrently. Sequentially, a no-ATS company (the
  // bulk of the sweep backlog) pays the full timeout of every probe in series
  // (~30s), which timed the sweep out at batch 40. In parallel the cost is the
  // slowest single probe (~TIMEOUT_MS). Pick the best hit, preserving PROBERS
  // priority order, then higher jobCount as a tiebreak.
  const tasks = PROBERS.flatMap((prober, order) =>
    slugs.map((slug) =>
      prober
        .probe(slug, doFetch)
        .then((hit) => (hit ? { order, hit } : null))
        .catch(() => null),
    ),
  )
  const results = await Promise.all(tasks)
  const hits = results.filter(
    (r): r is { order: number; hit: AtsProbeHit } => r !== null,
  )
  if (hits.length === 0) return null
  hits.sort((a, b) => a.order - b.order || b.hit.jobCount - a.hit.jobCount)
  return hits[0].hit
}
