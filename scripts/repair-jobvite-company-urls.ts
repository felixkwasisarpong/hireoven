/**
 * Resolve active Jobvite-tagged companies to live `jobs.jobvite.com/{slug}/jobs`
 * boards and cache the direct ATS URL on the company row.
 *
 * Dry-run by default:
 *   npx tsx scripts/repair-jobvite-company-urls.ts
 *
 * Apply repairs:
 *   npx tsx scripts/repair-jobvite-company-urls.ts --execute
 *
 * Apply and immediately run the harvester for repaired rows:
 *   npx tsx scripts/repair-jobvite-company-urls.ts --execute --crawl
 *
 * Also fix stale rows tagged as Jobvite when the resolver proves another
 * supported ATS, e.g. Roku -> Greenhouse:
 *   npx tsx scripts/repair-jobvite-company-urls.ts --execute --crawl --fix-stale-provider
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import {
  generateCompanySlugs,
  resolveDirectAtsUrl,
  type ResolvedAtsUrl,
} from "@/lib/companies/ats-url-resolver"
import { runAtsHarvest, type AtsHarvestCompany } from "@/lib/harvester/run-harvest"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const crawl = process.argv.includes("--crawl")
const fixStaleProvider = process.argv.includes("--fix-stale-provider")
const includeResolved = process.argv.includes("--include-resolved")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1]
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg, 10)) : null
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hireoven-jobvite-repair/1.0"

type CompanyRow = AtsHarvestCompany & {
  id: string
  direct_ats_url: string | null
  direct_ats_provider: string | null
  direct_ats_identifier: string | null
  job_count: number | null
  last_crawled_at: string | null
}

type LiveProbe = {
  ok: boolean
  slug: string
  directUrl: string
  checkedUrl: string
  jobAnchors: number
  reason: string
}

type RepairCandidate = {
  row: CompanyRow
  action: LiveProbe | null
  staleProviderAction: ResolvedAtsUrl | null
  source: string
  resolvedOtherProvider: string | null
}

const SUPPORTED_STALE_PROVIDERS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "icims",
  "bamboohr",
  "jobvite",
])

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

function csvField(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function slugFromJobviteUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname.toLowerCase() !== "jobs.jobvite.com") return null
    const slug = parsed.pathname.split("/").filter(Boolean)[0]
    return cleanSlug(slug)
  } catch {
    return null
  }
}

function cleanSlug(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]*$/.test(cleaned) ? cleaned : null
}

function domainSlug(value: string | null | undefined): string | null {
  if (!value) return null
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split(":")[0]
  const firstLabel = domain?.split(".")[0]
  return cleanSlug(firstLabel?.replace(/[^a-z0-9_-]/g, ""))
}

function jobviteUrl(slug: string): string {
  return `https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs`
}

function jobviteProbeUrls(slug: string, directUrl: string): string[] {
  const safe = encodeURIComponent(slug)
  return [
    `https://jobs.jobvite.com/${safe}/jobs/all`,
    `https://jobs.jobvite.com/${safe}/search`,
    directUrl,
    `https://jobs.jobvite.com/${safe}`,
  ]
}

async function fetchHtml(url: string, timeoutMs = 10_000): Promise<{ url: string; html: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    if (!response.ok) {
      try {
        await response.body?.cancel()
      } catch {}
      return null
    }
    const finalUrl = response.url
    const finalHost = new URL(finalUrl).hostname.toLowerCase()
    if (finalHost !== "jobs.jobvite.com") {
      try {
        await response.body?.cancel()
      } catch {}
      return null
    }
    return { url: finalUrl, html: await response.text() }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function countJobAnchors(html: string, slug: string): number {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?:href=["'][^"']*)?(?:https://jobs\\.jobvite\\.com)?/${escaped}/job/[a-z0-9_-]+`, "gi")
  const matches = html.match(re)
  return matches?.length ?? 0
}

async function probeLiveJobviteBoard(slug: string): Promise<LiveProbe> {
  const directUrl = jobviteUrl(slug)
  for (const url of jobviteProbeUrls(slug, directUrl)) {
    const fetched = await fetchHtml(url)
    if (!fetched) continue
    const jobAnchors = countJobAnchors(fetched.html, slug)
    if (jobAnchors > 0) {
      return {
        ok: true,
        slug,
        directUrl,
        checkedUrl: fetched.url,
        jobAnchors,
        reason: "live_jobvite_job_anchors",
      }
    }
  }
  return {
    ok: false,
    slug,
    directUrl,
    checkedUrl: directUrl,
    jobAnchors: 0,
    reason: "no_live_jobvite_jobs",
  }
}

function slugCandidates(row: CompanyRow, resolvedSlug?: string | null): string[] {
  const out = new Set<string>()
  for (const value of [
    resolvedSlug,
    row.direct_ats_identifier,
    row.ats_identifier,
    slugFromJobviteUrl(row.direct_ats_url),
    slugFromJobviteUrl(row.careers_url),
    domainSlug(row.domain),
    domainSlug(row.careers_url),
    ...generateCompanySlugs(row.name),
  ]) {
    const slug = cleanSlug(value)
    if (slug) out.add(slug)
  }
  return [...out]
}

async function resolveRow(row: CompanyRow): Promise<RepairCandidate> {
  let resolvedOtherProvider: string | null = null
  const firstUrl = row.direct_ats_url?.trim() || row.careers_url?.trim()

  if (firstUrl) {
    const resolved = await resolveDirectAtsUrl(firstUrl, {
      atsType: row.ats_type ?? "jobvite",
      companyName: row.name,
    }).catch(() => null)

    if (resolved?.provider === "jobvite") {
      const slug = cleanSlug(resolved.identifier) ?? slugFromJobviteUrl(resolved.directUrl)
      if (slug) {
        const probe = await probeLiveJobviteBoard(slug)
        if (probe.ok) {
          return {
            row,
            action: probe,
            staleProviderAction: null,
            source: resolved.source,
            resolvedOtherProvider,
          }
        }
      }
    } else if (resolved?.provider) {
      resolvedOtherProvider = resolved.provider
      if (SUPPORTED_STALE_PROVIDERS.has(resolved.provider)) {
        return {
          row,
          action: null,
          staleProviderAction: resolved,
          source: `stale_${resolved.source}`,
          resolvedOtherProvider,
        }
      }
    }
  }

  for (const slug of slugCandidates(row)) {
    const probe = await probeLiveJobviteBoard(slug)
        if (probe.ok) return { row, action: probe, staleProviderAction: null, source: "slug_probe", resolvedOtherProvider }
      }

  return { row, action: null, staleProviderAction: null, source: "unresolved", resolvedOtherProvider }
}

async function loadCandidates(pool: Pool): Promise<CompanyRow[]> {
  const params: Array<string | number> = []
  const limitSql = limit ? `LIMIT $1` : ""
  if (limit) params.push(limit)

  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, domain, careers_url, direct_ats_url, direct_ats_provider, direct_ats_identifier,
            ats_type, ats_identifier, raw_ats_config, etag, last_modified,
            freshness_tier, job_count, last_crawled_at
     FROM companies
     WHERE is_active = true
       AND status = 'active'
       AND duplicate_of_company_id IS NULL
       AND (
         lower(coalesce(ats_type, '')) = 'jobvite'
         OR careers_url ILIKE '%jobs.jobvite.com/%'
         OR direct_ats_url ILIKE '%jobs.jobvite.com/%'
       )
       AND (
         ${includeResolved ? "true" : "false"}
         OR direct_ats_url IS NULL
         OR direct_ats_provider IS NULL
         OR direct_ats_identifier IS NULL
         OR (lower(coalesce(ats_type, '')) = 'jobvite' AND ats_identifier IS NULL)
       )
     ORDER BY
       (direct_ats_url IS NULL) DESC,
       (ats_identifier IS NULL) DESC,
       COALESCE(job_count, 0) ASC,
       name ASC
     ${limitSql}`,
    params
  )
  return rows
}

async function applyRepair(pool: Pool, candidate: RepairCandidate): Promise<void> {
  if (!candidate.action) return
  await pool.query(
    `UPDATE companies
     SET direct_ats_url = $1,
         direct_ats_provider = 'jobvite',
         direct_ats_identifier = $2,
         direct_ats_url_resolved_at = now(),
         ats_type = 'jobvite',
         ats_identifier = COALESCE(NULLIF(ats_identifier, ''), $2),
         next_harvest_at = NULL,
         updated_at = now()
     WHERE id = $3`,
    [candidate.action.directUrl, candidate.action.slug, candidate.row.id]
  )
}

async function applyStaleProviderRepair(pool: Pool, candidate: RepairCandidate): Promise<void> {
  const action = candidate.staleProviderAction
  if (!action) return
  await pool.query(
    `UPDATE companies
     SET direct_ats_url = $1,
         direct_ats_provider = $2,
         direct_ats_identifier = $3,
         direct_ats_url_resolved_at = now(),
         ats_type = $2,
         ats_identifier = $3,
         next_harvest_at = NULL,
         updated_at = now()
     WHERE id = $4`,
    [action.directUrl, action.provider, action.identifier, candidate.row.id]
  )
}

async function crawlRepaired(pool: Pool, candidate: RepairCandidate) {
  const directUrl = candidate.action?.directUrl ?? candidate.staleProviderAction?.directUrl
  const provider = candidate.action ? "jobvite" : candidate.staleProviderAction?.provider
  const identifier = candidate.action?.slug ?? candidate.staleProviderAction?.identifier ?? null
  if (!directUrl || !provider) return null
  return runAtsHarvest({
    pool,
    company: {
      ...candidate.row,
      direct_ats_url: directUrl,
      ats_type: provider,
      ats_identifier: identifier,
    },
  })
}

function writeReport(candidates: RepairCandidate[]) {
  mkdirSync(resolve("scripts/output"), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = resolve(`scripts/output/jobvite-url-repair-${stamp}.csv`)
  const rows = [
    [
      "id",
      "name",
      "domain",
      "current_ats_type",
      "current_ats_identifier",
      "current_careers_url",
      "current_direct_ats_url",
      "current_direct_ats_provider",
      "current_direct_ats_identifier",
      "resolved_direct_url",
      "resolved_slug",
      "stale_provider_direct_url",
      "stale_provider_identifier",
      "source",
      "job_anchors",
      "checked_url",
      "resolved_other_provider",
    ],
  ]

  for (const entry of candidates) {
    rows.push([
      entry.row.id,
      entry.row.name,
      entry.row.domain ?? "",
      entry.row.ats_type ?? "",
      entry.row.ats_identifier ?? "",
      entry.row.careers_url ?? "",
      entry.row.direct_ats_url ?? "",
      entry.row.direct_ats_provider ?? "",
      entry.row.direct_ats_identifier ?? "",
      entry.action?.directUrl ?? "",
      entry.action?.slug ?? "",
      entry.staleProviderAction?.directUrl ?? "",
      entry.staleProviderAction?.identifier ?? "",
      entry.source,
      String(entry.action?.jobAnchors ?? 0),
      entry.action?.checkedUrl ?? "",
      entry.resolvedOtherProvider ?? "",
    ])
  }

  writeFileSync(outPath, rows.map((row) => row.map(csvField).join(",")).join("\n"))
  return outPath
}

async function main() {
  const pool = getPool()
  try {
    const rows = await loadCandidates(pool)
    console.log(
      `[jobvite-repair] mode=${execute ? "EXECUTE" : "DRY-RUN"} crawl=${crawl ? "yes" : "no"} fix_stale_provider=${fixStaleProvider ? "yes" : "no"} include_resolved=${includeResolved ? "yes" : "no"} candidates=${rows.length}`
    )

    const results: RepairCandidate[] = []
    for (const row of rows) {
      const result = await resolveRow(row)
      results.push(result)
      const prefix = result.action ? "repair" : result.staleProviderAction ? "stale" : "skip"
      const target = result.action
        ? `${result.action.directUrl} (${result.action.jobAnchors} anchors)`
        : result.staleProviderAction
          ? `${result.staleProviderAction.provider}:${result.staleProviderAction.directUrl}`
          : "unresolved"
      console.log(`[jobvite-repair] ${prefix}: ${row.name} -> ${target}`)
    }

    const repairs = results.filter((result) => result.action)
    const staleRepairs = results.filter((result) => result.staleProviderAction)
    const outPath = writeReport(results)

    let applied = 0
    let staleApplied = 0
    let crawled = 0
    let crawlJobs = 0
    if (execute) {
      for (const repair of repairs) {
        await applyRepair(pool, repair)
        applied += 1
        if (crawl) {
          const outcome = await crawlRepaired(pool, repair)
          if (outcome?.matched) {
            crawled += 1
            crawlJobs += outcome.jobsFound
            console.log(
              `[jobvite-repair] crawl: ${repair.row.name} status=${outcome.status} jobs=${outcome.jobsFound} new=${outcome.newJobs}`
            )
          }
        }
      }
      if (fixStaleProvider) {
        for (const repair of staleRepairs) {
          await applyStaleProviderRepair(pool, repair)
          staleApplied += 1
          if (crawl) {
            const outcome = await crawlRepaired(pool, repair)
            if (outcome?.matched) {
              crawled += 1
              crawlJobs += outcome.jobsFound
              console.log(
                `[jobvite-repair] crawl: ${repair.row.name} status=${outcome.status} jobs=${outcome.jobsFound} new=${outcome.newJobs}`
              )
            }
          }
        }
      }
    }

    console.log(
      `[jobvite-repair] summary candidates=${rows.length} repairs=${repairs.length} stale_repairs=${staleRepairs.length} applied=${applied} stale_applied=${staleApplied} crawled=${crawled} crawl_jobs=${crawlJobs}`
    )
    console.log(`[jobvite-repair] report=${outPath}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
