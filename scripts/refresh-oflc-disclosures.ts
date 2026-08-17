/**
 * Scheduled refresh of the OFLC disclosure corpus (LCA / PERM / PWD).
 *
 * Discovers the newest published file for each dataset from the DOL performance page, compares it
 * against oflc_ingest_log, and imports only what is new. Self-discovering on purpose: DOL moves
 * these files around — the newest quarter is served from /media/ while older ones sit under
 * /sites/dolgov/files/ETA/oflc/pdfs/, and the prevailing-wage file is named PW_* even though the
 * dataset is universally called PWD. Hardcoding URLs breaks on the next drop.
 *
 * ⚠ THIS IS NOT OPTIONAL MAINTENANCE. The §2 Green Card Radar reads unexpired prevailing wage
 * determinations. They are valid 90 days to 1 year, so once a file ages past that every row in it
 * has expired and the radar returns nothing at all — it empties rather than degrades. Run monthly
 * so a new quarterly drop (Feb/May/Aug/Dec, 5-7 weeks after quarter end) is picked up promptly.
 *
 *   npx tsx scripts/refresh-oflc-disclosures.ts               # report what would run
 *   npx tsx scripts/refresh-oflc-disclosures.ts --execute
 *   npx tsx scripts/refresh-oflc-disclosures.ts --execute --only=pwd
 *
 * Run this on the HARVESTER box, not the web box: it downloads ~550 MB and streams ~3 GB of XML.
 * Disk is the practical constraint — it keeps downloads in .cache and reuses them.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { getPostgresPool } from "@/lib/postgres/server"

const EXECUTE = process.argv.includes("--execute")

function flagStr(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : fallback
}

const ONLY = flagStr("only", "")
const PERF_PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/performance"
const CACHE_DIR = path.join(process.cwd(), ".cache")

interface Dataset {
  key: "lca" | "perm" | "pwd"
  /** Matches the filename stem on the performance page. */
  filePattern: RegExp
  importer: string
}

const DATASETS: Dataset[] = [
  { key: "lca", filePattern: /LCA_Disclosure_Data_(FY\d{4}_Q\d)\.xlsx$/i, importer: "scripts/import-lca-disclosure.ts" },
  { key: "perm", filePattern: /PERM_Disclosure_Data_(FY\d{4}_Q\d)\.xlsx$/i, importer: "scripts/import-perm-disclosure.ts" },
  // PW_, not PWD_ — and must not swallow PW_Worksites_*.
  { key: "pwd", filePattern: /(?<!Worksites_)PW_Disclosure_Data_(FY\d{4}_Q\d)\.xlsx$/i, importer: "scripts/import-pwd-disclosure.ts" },
]

/** 'FY2026_Q3' -> 20263, for ordering. */
function labelRank(label: string): number {
  const m = /FY(\d{4})_Q(\d)/i.exec(label)
  if (!m) return 0
  return Number(m[1]) * 10 + Number(m[2])
}

async function discover(): Promise<Map<string, { label: string; url: string }>> {
  const res = await fetch(PERF_PAGE)
  if (!res.ok) throw new Error(`Performance page fetch failed: HTTP ${res.status}`)
  const html = await res.text()

  const hrefs = [...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1])
  const out = new Map<string, { label: string; url: string }>()

  for (const ds of DATASETS) {
    let best: { label: string; url: string; rank: number } | null = null
    for (const href of hrefs) {
      const m = ds.filePattern.exec(href)
      if (!m) continue
      const label = m[1].toUpperCase()
      const rank = labelRank(label)
      if (!best || rank > best.rank) {
        // Links appear both absolute and site-relative; normalise, and collapse the
        // double slash DOL emits ("https://www.dol.gov//media/...").
        const url = href.startsWith("http")
          ? href.replace("dol.gov//", "dol.gov/")
          : `https://www.dol.gov${href}`
        best = { label, url, rank }
      }
    }
    if (best) out.set(ds.key, { label: best.label, url: best.url })
  }
  return out
}

async function headSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" })
    if (!res.ok) return null
    const len = res.headers.get("content-length")
    return len ? Number(len) : null
  } catch {
    return null
  }
}

async function download(url: string, dest: string): Promise<number> {
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    console.log(`    cached (${(size / 1e6).toFixed(0)} MB)`)
    return size
  }
  console.log(`    downloading ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  console.log(`    saved ${(buf.length / 1e6).toFixed(0)} MB`)
  return buf.length
}

function runImporter(script: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", script, `--file=${file}`, "--apply"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))))
  })
}

async function main(): Promise<void> {
  console.log("Discovering newest OFLC disclosure files ...")
  const found = await discover()

  const pool = getPostgresPool()
  try {
    for (const ds of DATASETS) {
      if (ONLY && ONLY !== ds.key) continue
      const hit = found.get(ds.key)
      console.log(`\n[${ds.key}]`)
      if (!hit) {
        console.log("  no file found on the performance page — DOL may have changed the naming")
        continue
      }
      console.log(`  newest published: ${hit.label}`)

      const { rows } = await pool.query<{ file_label: string; content_bytes: string | null; status: string }>(
        `SELECT file_label, content_bytes::text, status FROM oflc_ingest_log
          WHERE dataset = $1 ORDER BY file_label DESC LIMIT 1`,
        [ds.key]
      )
      const last = rows[0]
      if (last) console.log(`  last ingested:    ${last.file_label} (${last.status})`)

      const remoteSize = await headSize(hit.url)
      const alreadyDone =
        last?.file_label === hit.label &&
        last.status === "ok" &&
        (remoteSize === null || last.content_bytes === null || Number(last.content_bytes) === remoteSize)

      if (alreadyDone) {
        console.log("  up to date — nothing to do")
        continue
      }

      if (!EXECUTE) {
        console.log(`  WOULD IMPORT ${hit.label} from ${hit.url}`)
        continue
      }

      const dest = path.join(CACHE_DIR, `${ds.key.toUpperCase()}_${hit.label}.xlsx`)
      await pool.query(
        `INSERT INTO oflc_ingest_log (dataset, file_label, source_url, content_bytes, status, started_at)
         VALUES ($1,$2,$3,$4,'running',now())
         ON CONFLICT (dataset, file_label) DO UPDATE SET
           source_url = EXCLUDED.source_url, content_bytes = EXCLUDED.content_bytes,
           status = 'running', error = NULL, started_at = now(), finished_at = NULL`,
        [ds.key, hit.label, hit.url, remoteSize]
      )

      try {
        const size = await download(hit.url, dest)
        console.log(`    importing via ${ds.importer} ...`)
        await runImporter(ds.importer, dest)
        await pool.query(
          `UPDATE oflc_ingest_log SET status='ok', content_bytes=$3, finished_at=now()
            WHERE dataset=$1 AND file_label=$2`,
          [ds.key, hit.label, size]
        )
        console.log(`  ${ds.key} ${hit.label} imported`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await pool.query(
          `UPDATE oflc_ingest_log SET status='failed', error=$3, finished_at=now()
            WHERE dataset=$1 AND file_label=$2`,
          [ds.key, hit.label, message.slice(0, 500)]
        )
        console.error(`  ${ds.key} FAILED: ${message}`)
      }
    }

    // Health check on the feature most sensitive to staleness.
    const { rows: radar } = await pool.query<{ live: string; soonest: string | null }>(
      `SELECT count(*)::text AS live, min(expiration_date)::text AS soonest
         FROM pwd_records w
        WHERE w.visa_class = 'PERM' AND w.expiration_date >= CURRENT_DATE
          AND NOT EXISTS (SELECT 1 FROM perm_records p WHERE p.pwd_number = w.case_number)`
    )
    const live = Number(radar[0]?.live ?? 0)
    console.log(`\nGreen Card Radar: ${live.toLocaleString()} live signals`)
    if (live === 0) {
      console.log("  ⚠ RADAR IS EMPTY — every loaded determination has expired. Ingest a newer PWD file.")
    }

    if (!EXECUTE) console.log("\nDry run — nothing imported. Re-run with --execute.")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
