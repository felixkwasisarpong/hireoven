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
  /** Optional override of the default in-script concurrency for this ATS's
   *  URL synthesis step. Workday needs network calls; the path-based ATSes
   *  don't, so the default 1 is fine for them. */
  synthesisConcurrency?: number
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
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
const onlyList = onlyArg
  ? new Set(onlyArg.split("=")[1].split(",").map((s) => s.trim().toLowerCase()))
  : null

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

type RunSummary = {
  ats: AtsName
  apex: string
  candidates: number
  validated: number
  alreadyKnown: number
  inserted: number
  skippedAdapter: number
  /** Candidates where the URL synthesizer returned null (e.g. Workday resolver couldn't find a site). */
  synthesisFailed: number
  durationMs: number
  error: string | null
}

async function runForTarget(target: AtsTarget): Promise<RunSummary> {
  const summary: RunSummary = {
    ats: target.ats,
    apex: target.apex,
    candidates: 0,
    validated: 0,
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
  const synthesisLimit = pLimit(target.synthesisConcurrency ?? 1)

  // Step 1: synthesize and validate in parallel (Workday needs network calls
  // per host; for others toCareersUrl is sync and the parallelism is a no-op).
  type SynthesisResult =
    | { kind: "validated"; host: DiscoveredHost; careersUrl: string; detection: ReturnType<typeof detectAdapter> & object }
    | { kind: "skipped-adapter" }
    | { kind: "synthesis-failed" }

  const validations: SynthesisResult[] = await Promise.all(
    hosts.map((host) =>
      synthesisLimit(async (): Promise<SynthesisResult> => {
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
  summary.validated = validations.filter((v) => v.kind === "validated").length

  if (dryRun) return finalise()

  // Step 2: serial DB upserts (idempotent SELECT-then-INSERT).
  for (const entry of validations) {
    if (!entry || entry.kind !== "validated") continue
    try {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM companies WHERE careers_url = $1 LIMIT 1`,
        [entry.careersUrl]
      )
      if (rows.length > 0) {
        summary.alreadyKnown += 1
        continue
      }
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
    `[discover-crtsh] mode=${dryRun ? "dry-run" : "execute"} only=${onlyList ? [...onlyList].join(",") : "all"}`
  )

  const targets = TARGETS.filter((t) => !onlyList || onlyList.has(t.ats))
  const summaries: RunSummary[] = []

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    console.log(`[discover-crtsh] querying ${target.apex} (${i + 1}/${targets.length})…`)
    const summary = await runForTarget(target)
    summaries.push(summary)
    console.log(
      `[discover-crtsh] ${target.ats}: candidates=${summary.candidates} validated=${summary.validated} known=${summary.alreadyKnown} inserted=${summary.inserted} skipped=${summary.skippedAdapter} synthFailed=${summary.synthesisFailed} duration=${summary.durationMs}ms${summary.error ? ` error=${summary.error}` : ""}`
    )
    if (i < targets.length - 1) await sleep(2_000)
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      candidates: acc.candidates + s.candidates,
      validated: acc.validated + s.validated,
      alreadyKnown: acc.alreadyKnown + s.alreadyKnown,
      inserted: acc.inserted + s.inserted,
      skippedAdapter: acc.skippedAdapter + s.skippedAdapter,
    }),
    { candidates: 0, validated: 0, alreadyKnown: 0, inserted: 0, skippedAdapter: 0 }
  )

  console.log(
    `[discover-crtsh] totals: candidates=${totals.candidates} validated=${totals.validated} known=${totals.alreadyKnown} inserted=${totals.inserted} skipped=${totals.skippedAdapter}`
  )

  if (!dryRun) {
    await getPostgresPool().end()
  }
}

main().catch((error) => {
  console.error("[discover-crtsh] fatal:", error)
  process.exit(1)
})
