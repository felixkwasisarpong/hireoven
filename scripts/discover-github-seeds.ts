/**
 * GitHub-seed-list discovery.
 *
 *   npx tsx scripts/discover-github-seeds.ts --dry-run      # default
 *   npx tsx scripts/discover-github-seeds.ts --execute
 *   npx tsx scripts/discover-github-seeds.ts --execute --only=workday,greenhouse
 *   npx tsx scripts/discover-github-seeds.ts --execute --exclude=icims
 *   npx tsx scripts/discover-github-seeds.ts --source=https://raw.githubusercontent.com/owner/repo/branch/README.md
 *
 * Fetches each curated README, extracts every URL that detectAdapter matches,
 * dedupes by (atsType, slug) across all sources, and INSERTs new companies
 * with discovered_via='github-seed:{source-name}', freshness_tier='tier_3'.
 * Idempotent. `--only` / `--exclude` filter by ATS adapter name.
 */

import { loadEnvConfig } from "@next/env"
import {
  DEFAULT_SEED_SOURCES,
  fetchAndExtract,
  type GitHubSeedCandidate,
  type SeedRunSummary,
  type SeedSource,
} from "@/lib/harvester/discovery/github-seeds"
import { getPostgresPool } from "@/lib/postgres/server"
import { isAtsDomain } from "@/lib/companies/ats-domains"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const sourceOverrides = args
  .filter((a) => a.startsWith("--source="))
  .map((a) => a.slice("--source=".length))
  .filter(Boolean)

const onlyArg = args.find((a) => a.startsWith("--only="))
const onlyAts = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
  : null
const excludeArg = args.find((a) => a.startsWith("--exclude="))
const excludeAts = excludeArg
  ? new Set(excludeArg.slice("--exclude=".length).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
  : null

const sources: SeedSource[] = sourceOverrides.length
  ? sourceOverrides.map((url, idx) => ({ name: `cli-source-${idx}`, url }))
  : DEFAULT_SEED_SOURCES

function titleCase(slug: string): string {
  const compact = slug.split(":")[0] // for workday slugs like "nvidia:wd5:Site"
  return compact
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

function placeholderDomain(candidate: GitHubSeedCandidate): string {
  try {
    return new URL(candidate.careersUrl).hostname
  } catch {
    return candidate.careersUrl
  }
}

const DOMAIN_LABEL_STOPWORDS = new Set([
  "app",
  "apply",
  "career",
  "careers",
  "docs",
  "events",
  "jobs",
  "portal",
  "sales",
  "support",
  "trust",
  "webinars",
  "www",
])
const WORKDAY_SITE_STOPWORDS = new Set([
  "career",
  "careers",
  "external",
  "ext",
  "gateway",
  "job",
  "jobs",
  "page",
  "portal",
  "rec",
  "site",
  "wd",
  "workday",
])

function cleanLabel(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function labelToComDomain(rawLabel: string | null | undefined): string | null {
  const label = cleanLabel(rawLabel)
  if (!label) return null
  if (label.length < 4 || label.length > 40) return null
  if (/^\d+$/.test(label)) return null
  if (DOMAIN_LABEL_STOPWORDS.has(label)) return null
  return `${label}.com`
}

function workdaySiteDomain(atsIdentifier: string): string | null {
  const parts = atsIdentifier.split(":")
  if (parts.length < 3) return null
  const site = parts.slice(2).join(":")
  const tokens = site
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !WORKDAY_SITE_STOPWORDS.has(token))
  if (tokens.length >= 2) return labelToComDomain(tokens.slice(0, 2).join(""))
  return tokens[0] ? labelToComDomain(tokens[0]) : null
}

function inferSeedDomain(candidate: GitHubSeedCandidate): string | null {
  const host = placeholderDomain(candidate).toLowerCase()
  if (host.includes(".") && !isAtsDomain(host)) return host

  if (candidate.atsType === "workday") {
    const tenant = candidate.slug.split(":")[0] ?? ""
    return labelToComDomain(tenant) ?? workdaySiteDomain(candidate.slug)
  }

  const slugCore = candidate.slug.split(/[/:]/)[0] ?? ""
  return labelToComDomain(slugCore)
}

async function main() {
  console.log(
    `[discover-github-seeds] mode=${dryRun ? "dry-run" : "execute"} sources=${sources.length}`
  )

  const allCandidates: GitHubSeedCandidate[] = []
  const seenKeys = new Set<string>()
  const summaries: SeedRunSummary[] = []
  const candidatesPerSource = new Map<string, GitHubSeedCandidate[]>()

  for (const source of sources) {
    console.log(`[discover-github-seeds] fetching ${source.name} …`)
    const { candidates, summary } = await fetchAndExtract(source)
    summaries.push(summary)
    candidatesPerSource.set(source.name, candidates)
    for (const c of candidates) {
      if (onlyAts && !onlyAts.has(c.atsType)) continue
      if (excludeAts?.has(c.atsType)) continue
      const key = `${c.atsType}:${c.slug}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        allCandidates.push(c)
      }
    }
    console.log(
      `[discover-github-seeds] ${source.name}: ok=${summary.ok} bytes=${summary.bytesRead} candidates=${summary.candidates}${summary.error ? ` error=${summary.error}` : ""}`
    )
  }

  console.log(
    `[discover-github-seeds] unique candidates across all sources: ${allCandidates.length}`
  )

  if (dryRun) {
    const byAts = new Map<string, number>()
    for (const c of allCandidates) byAts.set(c.atsType, (byAts.get(c.atsType) ?? 0) + 1)
    const breakdown = [...byAts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ats, n]) => `${ats}=${n}`)
      .join(" ")
    console.log(`[discover-github-seeds] dry-run breakdown by ats: ${breakdown || "none"}`)
    return
  }

  const pool = getPostgresPool()
  let inserted = 0
  let alreadyKnown = 0
  let errors = 0

  for (const candidate of allCandidates) {
    try {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM companies WHERE careers_url = $1 LIMIT 1`,
        [candidate.careersUrl]
      )
      if (rows.length > 0) {
        alreadyKnown += 1
        continue
      }
      // Tag with the first source that surfaced this candidate, for telemetry.
      let firstSource = sources[0]?.name ?? "github-seed"
      for (const source of sources) {
        const list = candidatesPerSource.get(source.name) ?? []
        if (list.some((c) => c.atsType === candidate.atsType && c.slug === candidate.slug)) {
          firstSource = source.name
          break
        }
      }

      await pool.query(
        `INSERT INTO companies (
           name, domain, logo_url, careers_url, ats_type, ats_identifier,
           status, freshness_tier, discovered_via, is_active, raw_ats_config
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'active', 'tier_3', $7, true, $8::jsonb)
         ON CONFLICT DO NOTHING`,
        (() => {
          const inferredDomain = inferSeedDomain(candidate)
          const logoUrl =
            inferredDomain && !isAtsDomain(inferredDomain)
              ? companyLogoUrlFromDomain(inferredDomain) || null
              : null
          const rawAtsConfig = {
            source: "github_seed_discovery",
            discovery_host: placeholderDomain(candidate),
            guessed_domain: inferredDomain,
            domain_verified: Boolean(inferredDomain && !isAtsDomain(inferredDomain)),
          }
          return [
            titleCase(candidate.slug),
            inferredDomain,
            logoUrl,
            candidate.careersUrl,
            candidate.atsType,
            candidate.slug,
            `github-seed:${firstSource}`,
            JSON.stringify(rawAtsConfig),
          ]
        })()
      )
      inserted += 1
    } catch (error) {
      errors += 1
      if (errors >= 5) {
        console.error(`[discover-github-seeds] giving up after ${errors} consecutive insert errors`)
        break
      }
    }
  }

  console.log(
    `[discover-github-seeds] inserted=${inserted} known=${alreadyKnown} errors=${errors}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[discover-github-seeds] fatal:", error)
  process.exit(1)
})
