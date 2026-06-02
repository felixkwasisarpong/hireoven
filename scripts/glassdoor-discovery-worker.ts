/**
 * Glassdoor company-name discovery worker.
 *
 * Safe defaults:
 *   - no DB/network work unless --execute is passed
 *   - queues company-name-only placeholders, never Glassdoor job/review content
 *   - stops on robots disallow, login redirects, CAPTCHA/bot checks, 403/429/503
 *
 * Usage:
 *   npx tsx scripts/glassdoor-discovery-worker.ts
 *   GLASSDOOR_DISCOVERY_ENABLED=true npx tsx scripts/glassdoor-discovery-worker.ts --execute
 *   GLASSDOOR_DISCOVERY_ENABLED=true npx tsx scripts/glassdoor-discovery-worker.ts --execute --enqueue-only
 *   GLASSDOOR_DISCOVERY_ENABLED=true npx tsx scripts/glassdoor-discovery-worker.ts --execute --work-only
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  DEFAULT_GLASSDOOR_CONFIG_PATH,
  loadGlassdoorDiscoveryConfig,
} from "@/lib/harvester/discovery/glassdoor/config"
import { runGlassdoorDiscoveryWorker } from "@/lib/harvester/discovery/glassdoor/worker"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const enqueueOnly = args.includes("--enqueue-only")
const workOnly = args.includes("--work-only")
const configArg = args.find((arg) => arg.startsWith("--config="))?.slice("--config=".length)

async function main() {
  const config = loadGlassdoorDiscoveryConfig(configArg)

  if (!execute) {
    console.log("[glassdoor-discovery] dry-run preview; pass --execute to mutate DB or fetch Glassdoor")
    console.log(
      JSON.stringify(
        {
          enabled: process.env.GLASSDOOR_DISCOVERY_ENABLED === "true",
          config_path: configArg ?? process.env.GLASSDOOR_DISCOVERY_CONFIG ?? DEFAULT_GLASSDOOR_CONFIG_PATH,
          sectors: config.sector_keywords.length,
          locations: config.location_keywords.length,
          jobs_that_would_exist: config.sector_keywords.length * config.location_keywords.length,
          search_url_template: config.search_url_template,
        },
        null,
        2
      )
    )
    return
  }

  if (enqueueOnly && workOnly) {
    throw new Error("--enqueue-only and --work-only are mutually exclusive")
  }

  const pool = getPostgresPool()
  const summary = await runGlassdoorDiscoveryWorker({
    pool,
    config,
    enqueueJobs: !workOnly,
    processJobs: !enqueueOnly,
  })

  console.log(JSON.stringify(summary, null, 2))
  await pool.end()
}

main().catch((error) => {
  console.error("[glassdoor-discovery] failed:", error instanceof Error ? error.message : error)
  process.exit(1)
})
