/**
 * Build `soc_title_lexicon` from our certified LCA corpus.
 *
 * Each LCA filing pairs an employer-written job title with the SOC code DOL accepted, so
 * ~360k filings give us a labelled title -> SOC training set in exactly the title distribution
 * we need to classify. See scripts/migrations/add-oflc-wage-levels.sql for why the official DOL
 * crosswalk (997 rows, one title per SOC) cannot do this job.
 *
 * Normalization is imported from lib/salaries/soc-classifier so the lexicon keys and the runtime
 * lookup keys are produced by the SAME function. If these ever diverge, matching silently
 * collapses to zero -- which is why this script does not re-implement the normalizer in SQL.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/build-soc-lexicon.ts
 *   npx tsx scripts/build-soc-lexicon.ts --apply
 *
 * Cheap: one indexed-free sequential read of lca_records (~360k narrow rows) plus a ~17k-row
 * table rewrite. Safe against prod, but it is a full read of that table -- run it off-peak.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { normalizeJobTitle, bareSocCode } from "@/lib/salaries/soc-classifier"

const APPLY = process.argv.includes("--apply")

/** Phrase-length window; must match titlePhrases() in the classifier. */
const MIN_TOKENS = 2
const MAX_TOKENS = 5

/** A title needs this many filings before we trust its majority SOC. */
const MIN_SUPPORT = 2

/** ...and the majority SOC must hold at least this share of them. */
const MIN_SHARE = 0.5

type Row = { job_title: string; soc_code: string }

async function main(): Promise<void> {
  const pool = getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query("SET statement_timeout = 0")

    console.log("Reading lca_records ...")
    const { rows } = await client.query<Row>(
      `SELECT job_title, soc_code
         FROM lca_records
        WHERE job_title IS NOT NULL AND soc_code IS NOT NULL`
    )
    console.log(`  ${rows.length.toLocaleString()} filings`)

    // title_norm -> soc -> count
    const counts = new Map<string, Map<string, number>>()
    let skippedTokens = 0
    let skippedSoc = 0

    for (const r of rows) {
      const norm = normalizeJobTitle(r.job_title)
      const tokens = norm ? norm.split(" ").length : 0
      if (tokens < MIN_TOKENS || tokens > MAX_TOKENS) {
        skippedTokens++
        continue
      }
      const soc = bareSocCode(r.soc_code)
      if (!soc) {
        skippedSoc++
        continue
      }
      let bySoc = counts.get(norm)
      if (!bySoc) {
        bySoc = new Map()
        counts.set(norm, bySoc)
      }
      bySoc.set(soc, (bySoc.get(soc) ?? 0) + 1)
    }

    console.log(`  ${counts.size.toLocaleString()} distinct normalized titles in the token window`)
    console.log(`  skipped: ${skippedTokens.toLocaleString()} out-of-window, ${skippedSoc.toLocaleString()} unparseable SOC`)

    const entries: { titleNorm: string; soc: string; tokens: number; support: number; share: number }[] = []
    for (const [titleNorm, bySoc] of counts) {
      let bestSoc = ""
      let bestN = 0
      let total = 0
      for (const [soc, n] of bySoc) {
        total += n
        if (n > bestN || (n === bestN && soc < bestSoc)) {
          bestN = n
          bestSoc = soc
        }
      }
      const share = bestN / total
      if (total < MIN_SUPPORT || share < MIN_SHARE) continue
      entries.push({
        titleNorm,
        soc: bestSoc,
        tokens: titleNorm.split(" ").length,
        support: total,
        share,
      })
    }

    entries.sort((a, b) => b.support - a.support)
    console.log(`\nLexicon entries meeting support>=${MIN_SUPPORT} share>=${MIN_SHARE}: ${entries.length.toLocaleString()}`)
    console.log("\nTop 15 by support:")
    for (const e of entries.slice(0, 15)) {
      console.log(`  ${e.soc}  ${String(e.support).padStart(6)}  ${(e.share * 100).toFixed(0).padStart(3)}%  ${e.titleNorm}`)
    }

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply.")
      return
    }

    console.log("\nWriting soc_title_lexicon ...")
    await client.query("BEGIN")
    await client.query("TRUNCATE soc_title_lexicon")

    const BATCH = 1000
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH)
      const values: unknown[] = []
      const tuples = chunk.map((e) => {
        values.push(e.titleNorm, e.soc, e.tokens, e.support, e.share)
        const b = values.length
        return `($${b - 4},$${b - 3},$${b - 2},$${b - 1},$${b})`
      })
      await client.query(
        `INSERT INTO soc_title_lexicon (title_norm, soc_code, token_count, support, share)
         VALUES ${tuples.join(",")}
         ON CONFLICT (title_norm) DO NOTHING`,
        values
      )
    }

    await client.query("COMMIT")
    console.log(`Done — ${entries.length.toLocaleString()} entries.`)
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
