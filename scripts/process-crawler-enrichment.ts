/**
 * Drain pending crawler AI enrichments.
 *
 * Usage:
 *   npx tsx scripts/process-crawler-enrichment.ts
 *   npx tsx scripts/process-crawler-enrichment.ts --batch=80 --concurrency=6 --loops=5
 */

import { loadEnvConfig } from "@next/env"
import { processPendingCrawlerEnrichmentBatch } from "@/lib/crawler/enrichment"

loadEnvConfig(process.cwd())

const batchArg = process.argv.find((arg) => arg.startsWith("--batch="))
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="))
const loopsArg = process.argv.find((arg) => arg.startsWith("--loops="))

const batchSize = batchArg ? Number.parseInt(batchArg.split("=")[1] ?? "", 10) : undefined
const concurrency = concurrencyArg
  ? Number.parseInt(concurrencyArg.split("=")[1] ?? "", 10)
  : undefined
const loops = Math.max(1, Number.parseInt(loopsArg?.split("=")[1] ?? "1", 10))

async function main() {
  let totalProcessed = 0
  let totalEnriched = 0
  let totalFailed = 0
  let totalSkipped = 0

  for (let i = 0; i < loops; i += 1) {
    const result = await processPendingCrawlerEnrichmentBatch({ batchSize, concurrency })
    totalProcessed += result.processed
    totalEnriched += result.enriched
    totalFailed += result.failed
    totalSkipped += result.skipped

    console.log(
      `[enrichment] loop=${i + 1}/${loops} processed=${result.processed} enriched=${result.enriched} failed=${result.failed} skipped=${result.skipped}`
    )

    if (result.processed === 0) break
  }

  console.log(
    `\n[enrichment] totals processed=${totalProcessed} enriched=${totalEnriched} failed=${totalFailed} skipped=${totalSkipped}`
  )
}

main().catch((error) => {
  console.error("process-crawler-enrichment failed:", error)
  process.exit(1)
})
