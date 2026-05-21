/**
 * crt.sh-driven company discovery for the 5 P0 ATSes.
 *
 *   npx tsx scripts/discover-crtsh.ts --dry-run
 *   npx tsx scripts/discover-crtsh.ts --execute
 *   npx tsx scripts/discover-crtsh.ts --only workable,smartrecruiters
 *
 * For each ATS we query crt.sh for `*.{apex}`, extract customer-style
 * subdomains, synthesize the canonical careers URL, validate via the adapter
 * registry, and INSERT into companies with status='active', freshness_tier=
 * 'tier_3', discovered_via='crt.sh:{ats}'. Idempotent: skips careers_urls that
 * already exist.
 *
 * Slow on purpose: serializes crt.sh queries, sleeps between them.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { discoverHostsForApex, type DiscoveredHost } from "@/lib/harvester/discovery/crtsh"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

type AtsTarget = {
  ats: AtsName
  apex: string
  /** Returns the canonical careers URL for a discovered customer slug, or null
   *  if this ATS doesn't expose customers via subdomain-derivable identifiers.
   *  Async so adapters that need per-host resolution (Workday) can fetch. */
  toCareersUrl: (host: DiscoveredHost) => string | null | Promise<string | null>
  /** Optional override for per-target candidate processing concurrency. */
  synthesisConcurrency?: number
}

type ProbeDecision = {
  admitted: boolean
  jobsFound: number
  reason: string
}

const TARGETS: AtsTarget[] = [
  {
    ats: "workable",
    apex: "workable.com",
    toCareersUrl: ({ slug }) => `https://apply.workable.com/${slug}/`,
  },
  {
    ats: "smartrecruiters",
    apex: "smartrecruiters.com",
    // Legacy SR customers had {slug}.smartrecruiters.com; modern ones live at
    // jobs.smartrecruiters.com/{slug}. Treat the discovered slug as a SR slug.
    toCareersUrl: ({ slug }) => `https://jobs.smartrecruiters.com/${slug}`,
  },
  {
    ats: "greenhouse",
    apex: "greenhouse.io",
    // Most Greenhouse customers use boards.greenhouse.io/{slug}; vanity subdomains
    // are rare. Use the slug as a board token and let the adapter verify.
    toCareersUrl: ({ slug }) => `https://boards.greenhouse.io/${slug}`,
  },
  {
    ats: "lever",
    apex: "lever.co",
    // Lever customers use jobs.lever.co/{slug}; their certs are usually issued
    // for `jobs.lever.co` (a vendor wildcard), so this rarely surfaces real
    // customers. Kept here for symmetry; will mostly be a no-op.
    toCareersUrl: ({ slug }) => `https://jobs.lever.co/${slug}`,
  },
  {
    ats: "ashby",
    apex: "ashbyhq.com",
    toCareersUrl: ({ slug }) => `https://jobs.ashbyhq.com/${slug}`,
  },
  {
    ats: "recruitee",
    apex: "recruitee.com",
    // Recruitee customers live directly at {slug}.recruitee.com.
    toCareersUrl: ({ host }) => `https://${host}/`,
  },
  {
    ats: "teamtailor",
    apex: "teamtailor.com",
    // Teamtailor customers live directly at {slug}.teamtailor.com.
    toCareersUrl: ({ host }) => `https://${host}/`,
  },
  {
    ats: "personio",
    apex: "personio.com",
    // Personio customers nest one level deeper: {slug}.jobs.personio.com(.de).
    // crt.sh on personio.com returns both *.personio.com and *.jobs.personio.com;
    // we only want the latter, where our adapter knows how to harvest.
    toCareersUrl: ({ host }) => {
      const lower = host.toLowerCase()
      if (!lower.endsWith(".jobs.personio.com") && !lower.endsWith(".jobs.personio.de")) {
        return null
      }
      return `https://${lower}/`
    },
  },
  {
    ats: "bamboohr",
    apex: "bamboohr.com",
    // Customers live at {slug}.bamboohr.com; canonical careers page is /careers.
    toCareersUrl: ({ host }) => `https://${host}/careers`,
  },
  {
    ats: "jazzhr",
    apex: "applytojob.com",
    // JazzHR public boards are {slug}.applytojob.com/
    toCareersUrl: ({ host }) => `https://${host}/`,
  },
  // Workday intentionally excluded. Workday issues a single wildcard cert
  // per cluster (`*.wdN.myworkdayjobs.com`), so customer-tenant hostnames
  // (`acme.wd5.…`) never appear in CT logs. crt.sh only returns Workday's
  // own infra labels (`wd117.…`, `dr-wd501.…`, `impl-wd108.…`). Use
  // `discover-github-seeds.ts` or `discover-company-ats-live.ts` for Workday.
]

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run") || !args.has("--execute")
const skipLiveProbe = args.has("--skip-live-probe")
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
const onlyList = onlyArg
  ? new Set(onlyArg.split("=")[1].split(",").map((s) => s.trim().toLowerCase()))
  : null
const candidateConcurrency = Math.max(
  1,
  Number.parseInt(process.env.DISCOVER_CRTSH_CANDIDATE_CONCURRENCY ?? "6", 10)
)
const probeTimeoutMs = Math.max(
  1_000,
  Number.parseInt(process.env.DISCOVER_CRTSH_PROBE_TIMEOUT_MS ?? "8000", 10)
)
const probeMaxAttempts = Math.max(
  1,
  Number.parseInt(process.env.DISCOVER_CRTSH_PROBE_MAX_ATTEMPTS ?? "2", 10)
)
const probeUserAgent =
  process.env.DISCOVER_CRTSH_PROBE_USER_AGENT ??
  "hireoven-discovery/1.0 (+https://hireoven.com; bot@hireoven.com)"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/**
 * crt.sh surfaces every cert SAN under an ATS apex — including the vendor's
 * own internal/dev/CDN subdomains and raw client UUIDs. Those can return a
 * Lever/SR API shape with a transient test job; without this filter we end up
 * persisting fake "companies" like Admin2, 42dev, Cdn, c-<uuid>.hire.lever.co.
 */
const NOISE_SLUG_WORDS = new Set([
  "admin", "auth", "billing", "box", "bugs", "cdn", "cert", "test", "tests",
  "testing", "qa", "stage", "staging", "prod", "sandbox", "demo", "customer",
  "customers", "assets", "argocd", "betest", "cttest", "dbdev", "ctdev",
  "careerdev", "career", "careers", "careerscdncfl", "corporatehelp",
  "corporatesrhelp", "status", "api", "dev", "internal", "infra", "ops",
  "public", "private", "client", "tenant", "account", "template", "sample",
  "hello", "world", "main", "master", "root", "unleash", "boundlessu",
  "bluesteel", "cerebro", "arepa",
])

export function isLikelyNoiseSlug(slug: string): boolean {
  const s = slug.toLowerCase().trim()
  if (!s) return true
  // Lever raw client UUIDs (c-<8>-<4>-<4>-<4>-<12>).
  if (/^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return true
  // Bare hex UUIDs.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return true
  // Numeric / dev-suffixed sluglets like "admin2", "test1", "cert-bel".
  if (/^(admin|test|qa|cert|dev|stage|staging|sandbox|demo)[-_0-9]*$/i.test(s)) return true
  if (/^(test|demo|sandbox|staging)\d+$/i.test(s)) return true
  // Catches "42dev", "123test", "5cert"-style numeric-prefixed infra slugs.
  if (/^\d+(dev|test|qa|cert|stage|demo|sandbox|admin)$/i.test(s)) return true
  // Single common English / infra word, hyphenated variants included.
  const flat = s.replace(/[-_]/g, "")
  if (NOISE_SLUG_WORDS.has(flat) || NOISE_SLUG_WORDS.has(s)) return true
  // Slugs with embedded "cdn"/"cert"/"unleash"/"int-bel" subdomain-style fragments.
  if (/(^|[-.])(cdn|cert|unleash|int-bel|assets)([-.]|$)/i.test(s)) return true
  return false
}

type RunSummary = {
  ats: AtsName
  apex: string
  candidates: number
  validated: number
  probeChecked: number
  probeAccepted: number
  probeRejected: number
  alreadyKnown: number
  inserted: number
  skippedAdapter: number
  /** Candidates where the URL synthesizer returned null (e.g. Workday resolver couldn't find a site). */
  synthesisFailed: number
  durationMs: number
  error: string | null
}

type FetchTextResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number | null; reason: string }

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

async function fetchTextWithRetry(
  url: string,
  init: RequestInit & { accept: string }
): Promise<FetchTextResult> {
  let attempt = 0
  let lastReason = "fetch_error"
  let lastStatus: number | null = null

  while (attempt < probeMaxAttempts) {
    attempt += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs)
    try {
      const response = await fetch(url, {
        ...init,
        method: init.method ?? "GET",
        redirect: "follow",
        headers: {
          "user-agent": probeUserAgent,
          accept: init.accept,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      })
      lastStatus = response.status

      if (response.ok) {
        const body = await response.text()
        return { ok: true, status: response.status, body }
      }

      lastReason = `http_${response.status}`
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= probeMaxAttempts) {
        return { ok: false, status: response.status, reason: lastReason }
      }
      await sleep(250 * attempt)
    } catch (error) {
      lastStatus = null
      lastReason =
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "fetch_error"
      if (attempt >= probeMaxAttempts) {
        return { ok: false, status: null, reason: lastReason }
      }
      await sleep(250 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }

  return { ok: false, status: lastStatus, reason: lastReason }
}

async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit & { accept?: string } = {}
): Promise<
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; reason: string }
> {
  const result = await fetchTextWithRetry(url, {
    ...init,
    accept: init.accept ?? "application/json",
  })
  if (!result.ok) return result
  try {
    return { ok: true, status: result.status, data: JSON.parse(result.body) as T }
  } catch {
    return { ok: false, status: result.status, reason: "invalid_json" }
  }
}

function hasJobPostingJsonLd(html: string): boolean {
  return /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*("JobPosting"|\[[^\]]*?"JobPosting")/i.test(
    html
  )
}

async function liveProbeHasJobs(input: {
  target: AtsTarget
  slug: string
  careersUrl: string
}): Promise<ProbeDecision> {
  const { target, slug, careersUrl } = input

  switch (target.ats) {
    case "greenhouse": {
      const result = await fetchJsonWithRetry<{ jobs?: unknown[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = Array.isArray(result.data?.jobs) ? result.data.jobs.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "lever": {
      const result = await fetchJsonWithRetry<unknown[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = Array.isArray(result.data) ? result.data.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "ashby": {
      const result = await fetchJsonWithRetry<{ jobs?: unknown[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = Array.isArray(result.data?.jobs) ? result.data.jobs.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "smartrecruiters": {
      const result = await fetchJsonWithRetry<{ totalFound?: number; content?: unknown[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?offset=0&limit=1`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound =
        typeof result.data?.totalFound === "number"
          ? result.data.totalFound
          : Array.isArray(result.data?.content)
            ? result.data.content.length
            : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "workable": {
      const result = await fetchJsonWithRetry<{ results?: unknown[] }>(
        `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs?page=1`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = Array.isArray(result.data?.results) ? result.data.results.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "recruitee": {
      const result = await fetchJsonWithRetry<{ offers?: Array<{ status?: string }> }>(
        `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const offers = Array.isArray(result.data?.offers) ? result.data.offers : []
      const jobsFound = offers.filter((offer) => {
        const status = (offer?.status ?? "").toLowerCase()
        return status === "" || status === "published" || status === "open"
      }).length
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "teamtailor": {
      const result = await fetchJsonWithRetry<{ jobs?: unknown[] }>(
        `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.json`
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = Array.isArray(result.data?.jobs) ? result.data.jobs.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "personio": {
      const result = await fetchTextWithRetry(
        `https://${encodeURIComponent(slug)}.jobs.personio.com/xml`,
        { accept: "application/xml,text/xml" }
      )
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const matches = result.body.match(/<position>/gi)
      const jobsFound = matches ? matches.length : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "empty_board" }
    }
    case "bamboohr":
    case "jazzhr": {
      const result = await fetchTextWithRetry(careersUrl, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      })
      if (!result.ok) return { admitted: false, jobsFound: 0, reason: result.reason }
      const jobsFound = hasJobPostingJsonLd(result.body) ? 1 : 0
      return jobsFound > 0
        ? { admitted: true, jobsFound, reason: "live_jobs" }
        : { admitted: false, jobsFound: 0, reason: "no_jobposting_jsonld" }
    }
    default:
      // Shouldn't happen with current TARGETS, but keep future-safe.
      return { admitted: true, jobsFound: 1, reason: "probe_not_required" }
  }
}

async function runForTarget(target: AtsTarget): Promise<RunSummary> {
  const summary: RunSummary = {
    ats: target.ats,
    apex: target.apex,
    candidates: 0,
    validated: 0,
    probeChecked: 0,
    probeAccepted: 0,
    probeRejected: 0,
    alreadyKnown: 0,
    inserted: 0,
    skippedAdapter: 0,
    synthesisFailed: 0,
    durationMs: 0,
    error: null,
  }
  const startedAt = Date.now()

  let hosts: DiscoveredHost[] = []
  try {
    hosts = await discoverHostsForApex(target.apex)
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error)
    summary.durationMs = Date.now() - startedAt
    return summary
  }

  summary.candidates = hosts.length
  if (hosts.length === 0) {
    summary.durationMs = Date.now() - startedAt
    return summary
  }

  const pool = getPostgresPool()
  const synthesisLimit = pLimit(target.synthesisConcurrency ?? candidateConcurrency)

  // Step 1: synthesize and validate in parallel (Workday needs network calls
  // per host; for others toCareersUrl is sync and the parallelism is a no-op).
  type SynthesisResult =
    | { kind: "validated"; host: DiscoveredHost; careersUrl: string; detection: ReturnType<typeof detectAdapter> & object }
    | { kind: "skipped-adapter" }
    | { kind: "synthesis-failed" }

  const validations: SynthesisResult[] = await Promise.all(
    hosts.map((host) =>
      synthesisLimit(async (): Promise<SynthesisResult> => {
        // Drop SANs that obviously aren't real employer slugs before doing
        // network work. Catches vendor infra subdomains and raw client UUIDs
        // that crt.sh surfaces alongside legitimate customer hosts.
        if (isLikelyNoiseSlug(host.slug)) return { kind: "skipped-adapter" }
        const careersUrl = await target.toCareersUrl(host)
        if (!careersUrl) return { kind: "synthesis-failed" }
        const detection = detectAdapter(careersUrl)
        if (!detection || detection.adapter.name !== target.ats) {
          return { kind: "skipped-adapter" }
        }
        return { kind: "validated", host, careersUrl, detection }
      })
    )
  )

  summary.skippedAdapter = validations.filter((v) => v.kind === "skipped-adapter").length
  summary.synthesisFailed = validations.filter((v) => v.kind === "synthesis-failed").length
  const validated = validations.filter(
    (v): v is Extract<SynthesisResult, { kind: "validated" }> => v.kind === "validated"
  )
  summary.validated = validated.length
  if (validated.length === 0) return finalise()

  const knownUrls = new Set<string>()
  if (!dryRun) {
    const urls = validated.map((entry) => entry.careersUrl)
    const { rows } = await pool.query<{ careers_url: string }>(
      `SELECT careers_url
         FROM companies
        WHERE careers_url = ANY($1::text[])`,
      [urls]
    )
    for (const row of rows) knownUrls.add(row.careers_url)
  }
  summary.alreadyKnown = knownUrls.size

  const toProbe = validated.filter((entry) => dryRun || !knownUrls.has(entry.careersUrl))
  summary.probeChecked = toProbe.length

  const liveDecisions = skipLiveProbe
    ? toProbe.map((entry) => ({
        entry,
        decision: { admitted: true, jobsFound: 1, reason: "probe_skipped" } as ProbeDecision,
      }))
    : await Promise.all(
        toProbe.map((entry) =>
          synthesisLimit(async () => ({
            entry,
            decision: await liveProbeHasJobs({
              target,
              slug: entry.detection.slug,
              careersUrl: entry.careersUrl,
            }),
          }))
        )
      )

  summary.probeAccepted = liveDecisions.filter((d) => d.decision.admitted).length
  summary.probeRejected = liveDecisions.filter((d) => !d.decision.admitted).length

  if (dryRun) return finalise()

  // Step 2: serial DB upserts (idempotent SELECT-then-INSERT) for probe-admitted candidates.
  for (const row of liveDecisions) {
    const { entry, decision } = row
    if (!decision.admitted) continue
    try {
      await pool.query(
        `INSERT INTO companies (
           name, domain, careers_url, ats_type, ats_identifier,
           status, freshness_tier, discovered_via, is_active
         )
         VALUES ($1, $2, $3, $4, $5, 'active', 'tier_3', $6, true)
         ON CONFLICT DO NOTHING`,
        [
          titleCase(entry.host.slug),
          entry.host.host,
          entry.careersUrl,
          target.ats,
          entry.detection.slug,
          `crt.sh:${target.ats}`,
        ]
      )
      summary.inserted += 1
    } catch (error) {
      summary.error = error instanceof Error ? error.message : String(error)
      break
    }
  }

  function finalise() {
    summary.durationMs = Date.now() - startedAt
    return summary
  }

  return finalise()
}

async function main() {
  console.log(
    `[discover-crtsh] mode=${dryRun ? "dry-run" : "execute"} only=${onlyList ? [...onlyList].join(",") : "all"} liveProbe=${skipLiveProbe ? "off" : "on"}`
  )

  const targets = TARGETS.filter((t) => !onlyList || onlyList.has(t.ats))
  const summaries: RunSummary[] = []

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    console.log(`[discover-crtsh] querying ${target.apex} (${i + 1}/${targets.length})…`)
    const summary = await runForTarget(target)
    summaries.push(summary)
    console.log(
      `[discover-crtsh] ${target.ats}: candidates=${summary.candidates} validated=${summary.validated} probeChecked=${summary.probeChecked} probeAccepted=${summary.probeAccepted} probeRejected=${summary.probeRejected} known=${summary.alreadyKnown} inserted=${summary.inserted} skipped=${summary.skippedAdapter} synthFailed=${summary.synthesisFailed} duration=${summary.durationMs}ms${summary.error ? ` error=${summary.error}` : ""}`
    )
    if (i < targets.length - 1) await sleep(2_000)
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      candidates: acc.candidates + s.candidates,
      validated: acc.validated + s.validated,
      probeChecked: acc.probeChecked + s.probeChecked,
      probeAccepted: acc.probeAccepted + s.probeAccepted,
      probeRejected: acc.probeRejected + s.probeRejected,
      alreadyKnown: acc.alreadyKnown + s.alreadyKnown,
      inserted: acc.inserted + s.inserted,
      skippedAdapter: acc.skippedAdapter + s.skippedAdapter,
    }),
    {
      candidates: 0,
      validated: 0,
      probeChecked: 0,
      probeAccepted: 0,
      probeRejected: 0,
      alreadyKnown: 0,
      inserted: 0,
      skippedAdapter: 0,
    }
  )

  console.log(
    `[discover-crtsh] totals: candidates=${totals.candidates} validated=${totals.validated} probeChecked=${totals.probeChecked} probeAccepted=${totals.probeAccepted} probeRejected=${totals.probeRejected} known=${totals.alreadyKnown} inserted=${totals.inserted} skipped=${totals.skippedAdapter}`
  )

  if (!dryRun) {
    await getPostgresPool().end()
  }
}

main().catch((error) => {
  console.error("[discover-crtsh] fatal:", error)
  process.exit(1)
})
