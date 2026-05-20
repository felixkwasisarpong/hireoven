/**
 * Crawl curated trending-tech companies while honoring crawl compliance flags.
 *
 * Usage:
 *   npx tsx scripts/crawl-trending-tech-companies.ts
 *   npx tsx scripts/crawl-trending-tech-companies.ts --execute
 *   npx tsx scripts/crawl-trending-tech-companies.ts --execute --limit=20 --concurrency=4
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const onlyZeroJobs = process.argv.includes("--only-zero-jobs")
const limit = Number(flag("limit")) || undefined
const concurrency = Math.max(1, Number(flag("concurrency")) || 4)
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `trending-tech-crawl-report-${new Date().toISOString().slice(0, 10)}.json`
  )

const TRENDING_TECH_DOMAINS = [
  "x.ai",
  "mistral.ai",
  "ssi.inc",
  "thinkingmachines.ai",
  "worldlabs.ai",
  "cognition.ai",
  "windsurf.com",
  "sierra.ai",
  "decagon.ai",
  "skild.ai",
  "groq.com",
  "together.ai",
  "fireworks.ai",
  "baseten.co",
  "lambda.ai",
  "writer.com",
  "suno.com",
  "pika.art",
  "elevenlabs.io",
  "runwayml.com",
  "figure.ai",
  "hebbia.ai",
  "crusoe.ai",
  "vastdata.com",
  "vannevarlabs.com",
  "abridge.com",
  "poolside.ai",
  "adept.ai",
  "mosaicml.com",
  "octoml.ai",
  "langchain.com",
  "mercor.com",
  "anduril.com",
  "shield.ai",
  "appliedintuition.com",
  "rebelliondefense.com",
  "wayve.ai",
  "waabi.ai",
  "synthesia.io",
  "runpod.io",
  "modal.com",
  "wandb.ai",
  "replicate.com",
  "pinecone.io",
  "motherduck.com",
  // Frontier AI labs (2026 additions)
  "reka.ai",
  "ai21.com",
  "stability.ai",
  "liquid.ai",
  "magic.dev",
  "imbue.com",
  "blackforestlabs.ai",
  "twelvelabs.io",
  "sakana.ai",
  "krea.ai",
  "ideogram.ai",
  "lumalabs.ai",
  // AI coding & dev tools
  "sourcegraph.com",
  "tabnine.com",
  "augmentcode.com",
  "lovable.dev",
  "stackblitz.com",
  "mintlify.com",
  // AI search / RAG / vector DBs
  "you.com",
  "exa.ai",
  "tavily.com",
  "brave.com",
  "inkeep.com",
  "llamaindex.ai",
  "trychroma.com",
  "qdrant.tech",
  "weaviate.io",
  "mindsdb.com",
  // AI infra / GPU compute / MLOps
  "coreweave.com",
  "voltagepark.com",
  "hyperbolic.xyz",
  "lepton.ai",
  "anyscale.com",
  "predibase.com",
  "nebius.com",
  "lightning.ai",
  "arize.com",
  "rungalileo.io",
  "comet.com",
  "datologyai.com",
  "cleanlab.ai",
  // AI agents / voice / video
  "sana.ai",
  "dust.tt",
  "crewai.com",
  "vapi.ai",
  "bland.ai",
  "retellai.com",
  "lindy.ai",
  "multion.ai",
  "descript.com",
  "resemble.ai",
  "hume.ai",
  "cartesia.ai",
  "tavus.io",
  "heygen.com",
  "captions.ai",
  // Humanoid robotics & physical AI
  "1x.tech",
  "apptronik.com",
  "physicalintelligence.company",
  "covariant.ai",
  "agilityrobotics.com",
  "bostondynamics.com",
  "symbotic.com",
  // Modern defense tech
  "saronic.com",
  "saildrone.com",
  "mach.industries",
  "hermeus.com",
  "stokespace.com",
  "hadrian.co",
  "trueanomaly.space",
  "skydio.com",
  "epirus.com",
  "castelion.com",
  // Autonomy & mobility
  "aurora.tech",
  "archer.com",
  "kodiak.ai",
  "nuro.ai",
  // Bio / health AI
  "insitro.com",
  "isomorphiclabs.com",
  "tempus.com",
  "pathai.com",
  "generatebiomedicines.com",
  "inceptive.life",
  "xaira.com",
  // Fusion / climate / energy
  "cfs.energy",
  "helionenergy.com",
  "formenergy.com",
  "koboldmetals.com",
  // Quantum computing
  "psiquantum.com",
  "ionq.com",
  "rigetti.com",
  "quantinuum.com",
] as const

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  last_crawled_at: string | null
  job_count: number | null
  crawl_allowed: boolean
}

type CrawlResultRow = {
  company_id: string
  company_name: string
  domain: string
  careers_url: string
  ats_type: string | null
  status: "ok" | "error"
  found_jobs: number
  inserted: number
  updated: number
  active_count: number
  error: string | null
}

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[trending-crawl] report: ${reportPath}`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL) in .env.local")
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const zeroJobsWhere = onlyZeroJobs ? "AND COALESCE(job_count, 0) = 0" : ""

    const { rows: allTargets } = await pool.query<CompanyRow>(
      `SELECT
         id,
         name,
         lower(domain) AS domain,
         careers_url,
         ats_type,
         ats_identifier,
         last_crawled_at,
         job_count,
         COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) AS crawl_allowed
       FROM companies
       WHERE lower(domain) = ANY($1::text[])
         AND is_active = true
         AND careers_url IS NOT NULL
         AND btrim(careers_url) <> ''
         ${zeroJobsWhere}
       ORDER BY domain`,
      [TRENDING_TECH_DOMAINS]
    )

    const blocked = allTargets.filter((row) => !row.crawl_allowed)
    const allowed = allTargets.filter((row) => row.crawl_allowed)
    const work = limit ? allowed.slice(0, limit) : allowed

    console.log(
      `[trending-crawl] mode=${execute ? "EXECUTE" : "dry-run"} onlyZeroJobs=${onlyZeroJobs} total=${allTargets.length} allowed=${allowed.length} blocked=${blocked.length} work=${work.length} concurrency=${concurrency}`
    )

    if (blocked.length > 0) {
      console.log("[trending-crawl] blocked domains:")
      for (const row of blocked) {
        console.log(`  - ${row.domain} (${row.name})`)
      }
    }

    if (!execute) {
      for (const row of work) {
        console.log(
          `  ${row.domain.padEnd(24)} ${row.name.padEnd(28)} ats=${(row.ats_type ?? "null").padEnd(10)} jobs=${String(row.job_count ?? 0).padStart(4)}`
        )
      }

      writeReport({
        mode: "dry-run",
        generated_at: new Date().toISOString(),
        summary: {
          only_zero_jobs: onlyZeroJobs,
          total_targets: allTargets.length,
          blocked: blocked.length,
          allowed: allowed.length,
          queued: work.length,
        },
        blocked: blocked.map((row) => ({
          company_id: row.id,
          name: row.name,
          domain: row.domain,
        })),
        queued: work.map((row) => ({
          company_id: row.id,
          name: row.name,
          domain: row.domain,
          careers_url: row.careers_url,
          ats_type: row.ats_type,
          ats_identifier: row.ats_identifier,
          job_count: row.job_count ?? 0,
        })),
      })
      return
    }

    const limiter = pLimit(concurrency)
    const results: CrawlResultRow[] = []

    await Promise.all(
      work.map((company) =>
        limiter(async () => {
          process.stdout.write(`\n[trending-crawl] crawling ${company.domain} ... `)
          try {
            const crawl = await crawlCareersPage({
              id: company.id,
              companyName: company.name,
              careersUrl: company.careers_url,
              lastCrawledAt: company.last_crawled_at
                ? new Date(company.last_crawled_at)
                : null,
              atsType: company.ats_type,
              atsIdentifier: company.ats_identifier,
            })

            const persisted = await persistCrawlJobs({
              companyId: company.id,
              crawledAt: crawl.crawledAt,
              jobs: crawl.jobs,
              sourceUrl: crawl.url,
              normalizedUrl: crawl.normalizedUrl,
              diagnostics: crawl.diagnostics,
            })

            process.stdout.write(
              `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
            )
            results.push({
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "ok",
              found_jobs: crawl.jobs.length,
              inserted: persisted.inserted,
              updated: persisted.updated,
              active_count: persisted.activeCount,
              error: null,
            })
          } catch (error) {
            const message =
              error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
            process.stdout.write(`error ${message}`)
            results.push({
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "error",
              found_jobs: 0,
              inserted: 0,
              updated: 0,
              active_count: 0,
              error: message,
            })
          }
        })
      )
    )

    const ok = results.filter((r) => r.status === "ok")
    const failed = results.filter((r) => r.status === "error")
    const jobsFound = ok.reduce((sum, r) => sum + r.found_jobs, 0)
    const inserted = ok.reduce((sum, r) => sum + r.inserted, 0)
    const updated = ok.reduce((sum, r) => sum + r.updated, 0)
    const active = ok.reduce((sum, r) => sum + r.active_count, 0)

    console.log("\n")
    console.log(`[trending-crawl] completed ok=${ok.length} failed=${failed.length}`)
    console.log(
      `[trending-crawl] totals jobs_found=${jobsFound} inserted=${inserted} updated=${updated} active_jobs_after=${active}`
    )

    writeReport({
      mode: "execute",
      generated_at: new Date().toISOString(),
      summary: {
        only_zero_jobs: onlyZeroJobs,
        total_targets: allTargets.length,
        blocked: blocked.length,
        allowed: allowed.length,
        attempted: work.length,
        succeeded: ok.length,
        failed: failed.length,
        jobs_found: jobsFound,
        jobs_inserted: inserted,
        jobs_updated: updated,
        active_jobs_after_sum: active,
      },
      blocked: blocked.map((row) => ({
        company_id: row.id,
        name: row.name,
        domain: row.domain,
      })),
      results: results.sort((a, b) => a.domain.localeCompare(b.domain)),
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[trending-crawl] failed", error)
  process.exit(1)
})
