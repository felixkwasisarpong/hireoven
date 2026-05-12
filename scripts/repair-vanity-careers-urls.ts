/**
 * Repair companies whose `ats_type` was detected via HTML signature but
 * whose `careers_url` is a vanity domain that doesn't match the harvester's
 * URL pattern. Fetches the vanity page, extracts the embedded ATS URL
 * (iframe src, JS config, bare links), updates `careers_url`.
 *
 * Usage:
 *   npx tsx scripts/repair-vanity-careers-urls.ts                 # dry-run
 *   npx tsx scripts/repair-vanity-careers-urls.ts --execute
 *   npx tsx scripts/repair-vanity-careers-urls.ts --execute --limit=500
 *   npx tsx scripts/repair-vanity-careers-urls.ts --execute --ats=workday
 *
 * After this runs, the harvester worker's URL-pattern detection works for
 * the repaired companies and they move from legacy-crawler-only to the
 * worker's fast lane.
 *
 * Per-ATS host patterns: each entry lists the host regex the harvester
 * adapter expects. The repair script extracts ALL URLs from the HTML,
 * filters to ones matching the expected pattern, picks the most specific
 * (longest path), and writes it back to careers_url.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "500", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "8", 10))
const atsFilter = getArg("--ats=") ?? null

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; HireovenCareersUrlRepair/1.0; +https://hireoven.com)"
const FETCH_TIMEOUT_MS = 10_000
const URL_REGEX = /https?:\/\/[^\s"'<>(){}\\]+/g

// Per-ATS configuration: which host pattern the harvester adapter expects,
// AND the predicate that decides if the URL is "harvester-ready" (i.e.,
// the worker's claim filter / detectFromUrl will match it).
type AtsConfig = {
  ats: string
  // Returns true if a URL is already in the canonical form the worker handles.
  isWorkerReady: (url: URL) => boolean
  // Filter candidate URLs extracted from HTML — keep only those that look
  // like the right ATS for THIS company.
  matchesAts: (url: URL) => boolean
  // Score a candidate URL — higher is better. Used to pick the most specific
  // when multiple match.
  scoreCandidate: (url: URL) => number
}

function basicScore(url: URL): number {
  // Prefer URLs with a non-trivial path (`/jobs`, `/external`, etc.)
  return url.pathname.length + (url.search ? 1 : 0)
}

/**
 * Asset / JS / legal / privacy paths that some embed snippets reference.
 * These look like ATS URLs by host but are not actual job-board endpoints.
 */
const NEVER_USE_PATH_RE =
  /\/(legal|privacy|terms|cookie|cookies|gdpr|trust|policy|policies|login|signin|sign-in|register|signup|sign-up|connect|samlAuthnRequest|servlet|script|scripts|icims2|js|css|fonts|images?|assets?|static|cdn|api)(\/|$)/i
const NEVER_USE_FILE_RE = /\.(js|mjs|cjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map|json)(\?|$)/i

/**
 * Asset / API hosts to outright reject even before path inspection.
 */
const REJECT_HOST_RE =
  /^(cdn\d*|cookie-policy-scripts|images?|assets?|static|api|www|developer|docs|help|support|status|trust|legal|policy)\./i

function isUsableAtsPath(u: URL): boolean {
  const path = u.pathname + (u.search || "")
  if (NEVER_USE_PATH_RE.test(path)) return false
  if (NEVER_USE_FILE_RE.test(u.pathname)) return false
  return true
}

function rejectAssetHost(u: URL, atsApex: string): boolean {
  // www.icims.com is the marketing site; api.greenhouse.io is the API.
  const host = u.hostname.toLowerCase()
  if (host === atsApex) return true // bare apex like "icims.com" is never the board
  return REJECT_HOST_RE.test(host)
}

/**
 * Strip job-specific tail segments so we always write a board-root URL,
 * not a deep link that 404s once the job is closed.
 */
function stripJobTail(u: URL, ats: string): URL {
  const out = new URL(u.toString())
  out.search = ""
  out.hash = ""
  // Final pathname trim — strip trailing odd chars that survive URL parsing
  // (e.g. unescaped `&` from `&amp;` in source HTML).
  out.pathname = out.pathname.replace(/[&;,.'"()]+$/, "")
  const parts = out.pathname.split("/").filter(Boolean)
  switch (ats) {
    case "greenhouse": {
      // /<tenant>/jobs/<id> → /<tenant>
      const jobsIdx = parts.findIndex((p) => p === "jobs" || p === "embed")
      if (jobsIdx > 0) {
        out.pathname = "/" + parts.slice(0, jobsIdx).join("/")
      }
      return out
    }
    case "lever": {
      // /<tenant>/<job-uuid> → /<tenant>
      if (parts.length >= 2 && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(parts[1])) {
        out.pathname = "/" + parts[0]
      }
      return out
    }
    case "ashby": {
      // /<tenant>/<job-uuid>[/application] → /<tenant>
      // Also strip /embed, /form/<...>, /talent-community
      if (parts.length >= 2) {
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(parts[1]) ||
          /^(embed|form|talent-community|application)$/i.test(parts[1])
        ) {
          out.pathname = "/" + parts[0]
        }
      }
      return out
    }
    case "workday": {
      // Workday board URLs are at most `/<locale>?/<site>`. Strip anything
      // beyond that: /job/..., /jobAlerts, /jobs, digit segments,
      // refreshFacet, candidate UUIDs.
      const isLocale = (p: string) => /^[a-z]{2}(-[a-z]{2,3})?$/i.test(p)
      const start = parts.length > 0 && isLocale(parts[0]) ? 0 : -1
      // Site is the first non-locale segment.
      const siteIdx = start >= 0 ? 1 : 0
      if (parts[siteIdx]) {
        out.pathname = "/" + parts.slice(0, siteIdx + 1).join("/")
      }
      return out
    }
    case "smartrecruiters": {
      // Reject community / talent-pool buckets; only keep root tenant paths
      const dashLast = parts[parts.length - 1] || ""
      if (/community|career-site|talent-pool/i.test(dashLast)) {
        // Drop the trailing community segment
        out.pathname = "/" + parts.slice(0, -1).join("/")
      }
      return out
    }
    default:
      return out
  }
}

const ATS_CONFIGS: Record<string, AtsConfig> = {
  workday: {
    ats: "workday",
    isWorkerReady: (u) => {
      const host = u.hostname.toLowerCase()
      if (!/^[a-z0-9-]+\.wd[0-9]{1,3}\.myworkdayjobs\.com$/.test(host)) return false
      // The harvester requires the site segment in the path.
      const parts = u.pathname.split("/").filter(Boolean)
      const isLocale = (p: string) => /^[a-z]{2}(-[a-z]{2,3})?$/i.test(p)
      const start = parts.length > 0 && isLocale(parts[0]) ? 1 : 0
      return Boolean(parts[start])
    },
    matchesAts: (u) =>
      /^[a-z0-9-]+\.wd[0-9]{1,3}\.myworkdayjobs\.com$/.test(u.hostname.toLowerCase()) &&
      isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  icims: {
    ats: "icims",
    isWorkerReady: () => false, // No iCIMS adapter yet — any iCIMS URL is an improvement over a vanity domain
    matchesAts: (u) => {
      const host = u.hostname.toLowerCase()
      const isIcims = host.endsWith(".icims.com") || host === "icims.com"
      if (!isIcims) return false
      if (rejectAssetHost(u, "icims.com")) return false
      // Reject internal/employee/region-specific portals — they require auth
      // or are scoped to non-public audiences. Subdomain = everything before
      // ".icims.com".
      const sub = host.replace(/\.icims\.com$/, "")
      if (
        /^(internal|faculty|facultycareers|alumni|retiree|login|signin)-/.test(sub)
      )
        return false
      // Any "employee(s)" anywhere in the subdomain (mxemployees-, caemployees-,
      // fremployees-, employees-, -employees-, etc.).
      if (/employee/.test(sub)) return false
      return isUsableAtsPath(u)
    },
    scoreCandidate: (u) => {
      // Prefer canonical public boards over regional variants.
      const host = u.hostname.toLowerCase()
      let bonus = 0
      if (host.startsWith("careers-")) bonus += 10
      else if (host.startsWith("uscareers-")) bonus += 8
      else if (host.startsWith("earlycareers-")) bonus += 5
      return basicScore(u) + bonus
    },
  },
  greenhouse: {
    ats: "greenhouse",
    isWorkerReady: (u) => /^(boards|job-boards)\.greenhouse\.io$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) => {
      const host = u.hostname.toLowerCase()
      // api.greenhouse.io is the API host, not a board
      if (host === "api.greenhouse.io") return false
      if (!host.endsWith("greenhouse.io")) return false
      return isUsableAtsPath(u)
    },
    scoreCandidate: basicScore,
  },
  lever: {
    ats: "lever",
    isWorkerReady: (u) => u.hostname.toLowerCase() === "jobs.lever.co",
    matchesAts: (u) => u.hostname.toLowerCase() === "jobs.lever.co" && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  ashby: {
    ats: "ashby",
    isWorkerReady: (u) => u.hostname.toLowerCase() === "jobs.ashbyhq.com",
    matchesAts: (u) => u.hostname.toLowerCase() === "jobs.ashbyhq.com" && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  smartrecruiters: {
    ats: "smartrecruiters",
    isWorkerReady: (u) => /^(jobs|careers)\.smartrecruiters\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) => {
      const host = u.hostname.toLowerCase()
      if (!host.endsWith("smartrecruiters.com")) return false
      // join.smartrecruiters.com is the talent-community signup site
      if (host === "join.smartrecruiters.com") return false
      return isUsableAtsPath(u)
    },
    scoreCandidate: basicScore,
  },
  workable: {
    ats: "workable",
    isWorkerReady: (u) =>
      /^(apply|jobs)\.workable\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) =>
      u.hostname.toLowerCase().endsWith("workable.com") && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  recruitee: {
    ats: "recruitee",
    isWorkerReady: (u) => /\.recruitee\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) =>
      u.hostname.toLowerCase().endsWith("recruitee.com") && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  teamtailor: {
    ats: "teamtailor",
    isWorkerReady: (u) => /\.teamtailor\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) =>
      u.hostname.toLowerCase().endsWith("teamtailor.com") && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  personio: {
    ats: "personio",
    isWorkerReady: (u) =>
      /\.jobs\.personio\.(com|de)$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) =>
      /\.jobs\.personio\.(com|de)$/.test(u.hostname.toLowerCase()) && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
  bamboohr: {
    ats: "bamboohr",
    isWorkerReady: (u) => /\.bamboohr\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) => {
      const host = u.hostname.toLowerCase()
      if (!host.endsWith("bamboohr.com")) return false
      // bamboohr.com/js/embed.js → not a board
      if (NEVER_USE_FILE_RE.test(u.pathname)) return false
      return true
    },
    scoreCandidate: basicScore,
  },
  jazzhr: {
    ats: "jazzhr",
    isWorkerReady: (u) => /\.applytojob\.com$/.test(u.hostname.toLowerCase()),
    matchesAts: (u) =>
      u.hostname.toLowerCase().endsWith("applytojob.com") && isUsableAtsPath(u),
    scoreCandidate: basicScore,
  },
}

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  ats_type: string
}

async function loadCandidates(): Promise<CompanyRow[]> {
  const pool = getPostgresPool()
  const params: unknown[] = [limit]
  let atsClause = `ats_type = ANY($2::text[])`
  if (atsFilter) {
    params.push([atsFilter])
  } else {
    params.push(Object.keys(ATS_CONFIGS))
  }

  const { rows } = await pool.query<CompanyRow>(
    `WITH shared AS (
       SELECT careers_url
         FROM companies
        WHERE status = 'active'
          AND duplicate_of_company_id IS NULL
          AND careers_url IS NOT NULL
          AND ${atsClause}
        GROUP BY careers_url
       HAVING count(*) > 1
     )
     SELECT id, name, careers_url, ats_type
       FROM companies
      WHERE status = 'active'
        AND duplicate_of_company_id IS NULL
        AND careers_url IS NOT NULL
        AND ${atsClause}
        AND careers_url NOT IN (SELECT careers_url FROM shared)
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    params
  )
  return rows
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  // Wallclock timeout — guards against stalled body reads where AbortController
  // alone doesn't unblock the await.
  const wallclock = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), FETCH_TIMEOUT_MS + 2_000)
  )
  try {
    const body = await Promise.race([
      (async () => {
        const response = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "user-agent": DEFAULT_USER_AGENT,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        })
        if (!response.ok) return null
        return await response.text()
      })(),
      wallclock,
    ])
    return body
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

function safeUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

/**
 * Extract the tenant slug from a candidate ATS URL. Examples:
 *   careers-heart.icims.com         → "heart"
 *   boards.greenhouse.io/cerebral   → "cerebral"
 *   jobs.lever.co/wavicledata       → "wavicledata"
 *   jobs.ashbyhq.com/Sierra/...     → "sierra"
 *   foo.wd1.myworkdayjobs.com/...   → "foo"
 *   foo.bamboohr.com                → "foo"
 */
function extractTenant(u: URL, ats: string): string | null {
  const host = u.hostname.toLowerCase()
  const firstPath = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase()
  switch (ats) {
    case "icims": {
      // careers-<tenant>.icims.com or <tenant>.icims.com
      const m = host.match(/^(?:careers-|earlycareers-|career-)?([a-z0-9-]+)\.icims\.com$/)
      return m?.[1] ?? null
    }
    case "greenhouse": {
      // boards.greenhouse.io/<tenant> | job-boards.greenhouse.io/<tenant>
      if (/^(boards|job-boards)\.greenhouse\.io$/.test(host)) return firstPath ?? null
      // Embed JS: ?for=<tenant>
      const forParam = u.searchParams.get("for")
      if (forParam) return forParam.toLowerCase()
      return null
    }
    case "lever":
    case "ashby":
      return firstPath ?? null
    case "workday": {
      const m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
      return m?.[1] ?? null
    }
    case "smartrecruiters": {
      // jobs.smartrecruiters.com/<tenant>
      return firstPath ?? null
    }
    case "workable":
      return firstPath ?? null
    case "recruitee":
    case "teamtailor":
    case "personio":
    case "bamboohr":
    case "jazzhr": {
      const m = host.match(/^([a-z0-9-]+)\./)
      return m?.[1] ?? null
    }
    default:
      return null
  }
}

/**
 * Token-level overlap between the discovered tenant slug and the company
 * (company name + careers_url apex). Lower-cases, splits on punctuation,
 * removes generic stopwords ("the", "inc", "llc", "of", "and"), and returns
 * the count of shared >=4-char tokens.
 *
 * This guards against placeholder companies — e.g. "Tony Blair Institute" with
 * careers_url=https://change.org/careers picking up jobs.ashbyhq.com/change.
 * The tenant "change" must overlap with "tony", "blair", or "institute" (none
 * do), so the repair is rejected.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "in",
  "on",
  "to",
  "a",
  "an",
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "company",
  "co",
  "group",
  "international",
  "intl",
  "global",
  "services",
  "service",
  "systems",
  "solutions",
  "technologies",
  "technology",
  "tech",
  "industries",
  "holdings",
  "partners",
  "associates",
  "institute",
  "foundation",
  "university",
  "college",
  "hospital",
  "health",
  "medical",
  "center",
  "centre",
  "national",
  "american",
  "us",
  "usa",
  "north",
  "south",
  "east",
  "west",
])

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  )
}

function companyTokens(name: string, careersHost: string | null): Set<string> {
  const set = tokenize(name)
  if (careersHost) {
    // Strip TLD and "www.": e.g. "tonyblair.org" → "tonyblair"
    const apex = careersHost.replace(/^www\./, "").split(".")[0]
    for (const t of tokenize(apex)) set.add(t)
  }
  return set
}

function tenantOverlaps(tenant: string, companyName: string, careersHost: string | null): boolean {
  const t = tenant.toLowerCase()
  if (t.length < 3) return false
  const tokens = companyTokens(companyName, careersHost)
  // Exact match, or tenant is a substring of any token / vice versa
  for (const tok of tokens) {
    if (tok === t) return true
    if (tok.length >= 4 && (t.includes(tok) || tok.includes(t))) return true
  }
  return false
}

function findRepairUrl(
  html: string,
  config: AtsConfig,
  base: URL,
  companyName: string
): { url: URL; rejectedWrongTenant: number } {
  const seen = new Set<string>()
  const matches: URL[] = []
  let rejectedWrongTenant = 0

  for (const m of html.matchAll(URL_REGEX)) {
    const raw = m[0].replace(/[),.;'"&]+$/, "")
    if (seen.has(raw)) continue
    seen.add(raw)
    const u = safeUrl(raw, base.toString())
    if (!u) continue
    if (!config.matchesAts(u)) continue
    matches.push(u)
  }

  if (matches.length === 0) return { url: null as unknown as URL, rejectedWrongTenant }

  // Filter to candidates whose tenant overlaps with the company. If NONE
  // overlap, fall back to taking the best-scoring candidate ONLY when the
  // careers_url host is non-generic (i.e. looks like the company's own
  // domain) — otherwise reject as a placeholder/wrong-tenant match.
  const careersHost = base.hostname.toLowerCase()
  const overlapping = matches.filter((u) => {
    const t = extractTenant(u, config.ats)
    return t ? tenantOverlaps(t, companyName, careersHost) : false
  })

  let chosen: URL[]
  if (overlapping.length > 0) {
    chosen = overlapping
  } else {
    rejectedWrongTenant = matches.length
    return { url: null as unknown as URL, rejectedWrongTenant }
  }

  chosen.sort((a, b) => config.scoreCandidate(b) - config.scoreCandidate(a))
  const best = stripJobTail(chosen[0], config.ats)
  // Ensure stripping didn't break match
  if (!config.matchesAts(best)) return { url: null as unknown as URL, rejectedWrongTenant }
  return { url: best, rejectedWrongTenant }
}

async function main() {
  console.log(
    `[repair-vanity-urls] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} ats=${atsFilter ?? "all"}`
  )

  const candidates = await loadCandidates()
  console.log(`[repair-vanity-urls] loaded ${candidates.length} candidates`)

  let alreadyReady = 0
  let repaired = 0
  let fetchFailed = 0
  let noUrlFound = 0
  let wrongTenant = 0
  let noChange = 0
  let badAtsType = 0
  let updated = 0

  const pool = getPostgresPool()
  const limiter = pLimit(concurrency)

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const config = ATS_CONFIGS[row.ats_type]
        if (!config) {
          badAtsType += 1
          return
        }

        const currentUrl = safeUrl(row.careers_url)
        if (currentUrl && config.isWorkerReady(currentUrl)) {
          alreadyReady += 1
          return
        }

        if (!currentUrl) {
          fetchFailed += 1
          return
        }

        const html = await fetchHtml(currentUrl.toString())
        if (!html) {
          fetchFailed += 1
          return
        }

        const result = findRepairUrl(html, config, currentUrl, row.name)
        if (!result.url) {
          if (result.rejectedWrongTenant > 0) wrongTenant += 1
          else noUrlFound += 1
          return
        }

        const newHref = result.url.toString()
        // No-op: discovered URL equals current. The original is already the
        // best representation; nothing to update.
        if (newHref === row.careers_url) {
          noChange += 1
          return
        }
        repaired += 1
        console.log(
          `${dryRun ? "[dry-run] " : ""}${row.name} (${row.ats_type}): ${row.careers_url} → ${newHref}`
        )

        if (dryRun) return

        await pool.query(
          `UPDATE companies
              SET careers_url = $1,
                  next_harvest_at = now(),
                  updated_at = now()
            WHERE id = $2`,
          [newHref, row.id]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[repair-vanity-urls] alreadyReady=${alreadyReady} repaired=${repaired} noChange=${noChange} wrongTenant=${wrongTenant} fetchFailed=${fetchFailed} noUrlFound=${noUrlFound} badAtsType=${badAtsType} updated=${dryRun ? 0 : updated}`
  )

  await pool.end()
}

main().catch((error) => {
  console.error("[repair-vanity-urls] fatal:", error)
  process.exit(1)
})
