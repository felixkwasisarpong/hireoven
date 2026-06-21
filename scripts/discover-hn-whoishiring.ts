/**
 * Hacker News "Who is hiring?" discovery.
 *
 *   npx tsx scripts/discover-hn-whoishiring.ts            # dry-run (default)
 *   npx tsx scripts/discover-hn-whoishiring.ts --execute
 *   npx tsx scripts/discover-hn-whoishiring.ts --execute --story=40000000
 *   npx tsx scripts/discover-hn-whoishiring.ts --execute --limit=200
 *
 * Locates the latest @whoishiring thread, extracts every (company, apply-url)
 * pair whose URL an adapter recognises, and enrolls each via
 * enrollFromApplyUrl() — the same direct-enrollment path used by the Dice /
 * JSearch aggregators. Idempotent (enrollFromApplyUrl upserts on a stable
 * synthetic domain). discovered_via is tagged `apply-url:hn-whoishiring`.
 */

import { loadEnvConfig } from "@next/env"
import { fetchWhoIsHiringPosts } from "@/lib/harvester/discovery/hn-whoishiring"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const storyArg = args.find((a) => a.startsWith("--story="))
const storyId = storyArg ? storyArg.slice("--story=".length) : undefined
const limitArg = args.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : Infinity

async function main() {
  console.log(`[discover-hn-whoishiring] mode=${dryRun ? "dry-run" : "execute"}`)

  const { storyId: resolvedStory, posts } = await fetchWhoIsHiringPosts({ storyId })
  console.log(
    `[discover-hn-whoishiring] story=${resolvedStory ?? "none"} posts_with_ats_links=${posts.length}`
  )

  // (company, applyUrl) candidate pairs, deduped by apply URL.
  const candidates: Array<{ companyName: string; applyUrl: string }> = []
  const seen = new Set<string>()
  for (const post of posts) {
    for (const applyUrl of post.applyUrls) {
      if (seen.has(applyUrl)) continue
      seen.add(applyUrl)
      candidates.push({ companyName: post.companyName, applyUrl })
      if (candidates.length >= limit) break
    }
    if (candidates.length >= limit) break
  }
  console.log(`[discover-hn-whoishiring] unique adapter-matched apply URLs: ${candidates.length}`)

  if (dryRun) {
    for (const c of candidates.slice(0, 25)) {
      console.log(`  ${c.companyName} -> ${c.applyUrl}`)
    }
    if (candidates.length > 25) console.log(`  … and ${candidates.length - 25} more`)
    return
  }

  const pool = getPostgresPool()
  let enrolled = 0
  let updated = 0
  let skipped = 0
  let errors = 0

  for (const c of candidates) {
    try {
      const result = await enrollFromApplyUrl(pool, {
        companyName: c.companyName,
        applyUrl: c.applyUrl,
        source: "hn-whoishiring",
      })
      if (!result) {
        skipped += 1
        continue
      }
      if (result.enrolled) enrolled += 1
      else updated += 1
    } catch (error) {
      errors += 1
      console.error(
        `[discover-hn-whoishiring] enroll error for ${c.applyUrl}:`,
        error instanceof Error ? error.message : error
      )
      if (errors >= 5) {
        console.error("[discover-hn-whoishiring] giving up after repeated errors")
        break
      }
    }
  }

  console.log(
    `[discover-hn-whoishiring] enrolled=${enrolled} updated=${updated} skipped=${skipped} errors=${errors}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[discover-hn-whoishiring] fatal:", error)
  process.exit(1)
})
