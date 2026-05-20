/**
 * Why was a specific job classified as an internship?
 * Loads the job row, runs the same regex used by the inference pipeline,
 * and reports the matching evidence (title vs description, exact substring).
 *
 *   npx tsx scripts/debug-internship-classify.ts <job-id>
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const INTERN_RE = /\b(internship|intern|co[\s-]?op)\b/i

async function main() {
  const id = process.argv[2] ?? "5eabb8ea-ac2b-4529-9d86-5950eac03e6c"
  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `select j.id, j.title, j.employment_type, j.seniority_level, j.company_id,
            c.name as company_name, c.ats_type,
            j.external_id, j.apply_url, j.created_at, j.updated_at,
            j.normalization_version, j.normalization_confidence,
            left(coalesce(j.description, ''), 4000) as description_excerpt,
            length(coalesce(j.description, '')) as description_length
       from jobs j
       left join companies c on c.id = j.company_id
      where j.id = $1`,
    [id],
  )
  if (rows.length === 0) {
    console.log(`no job found with id=${id}`)
    process.exit(1)
  }
  const j = rows[0]
  console.log("=== job ===")
  console.log("id:               ", j.id)
  console.log("title:            ", j.title)
  console.log("employment_type:  ", j.employment_type)
  console.log("seniority_level:  ", j.seniority_level)
  console.log("company:          ", j.company_name, `(ats=${j.ats_type})`)
  console.log("external_id:      ", j.external_id)
  console.log("apply_url:        ", j.apply_url)
  console.log("norm_version:     ", j.normalization_version, "conf=", j.normalization_confidence)
  console.log("description_len:  ", j.description_length)
  console.log("created_at:       ", j.created_at)
  console.log("updated_at:       ", j.updated_at)

  const titleMatch = j.title ? INTERN_RE.exec(j.title) : null
  const descMatch = j.description_excerpt ? INTERN_RE.exec(j.description_excerpt) : null

  console.log("\n=== regex /\\b(internship|intern|co[\\s-]?op)\\b/i ===")
  console.log("title match:       ", titleMatch ? `"${titleMatch[0]}" at index ${titleMatch.index}` : "—")
  console.log("description match: ", descMatch ? `"${descMatch[0]}" at index ${descMatch.index}` : "—")

  if (descMatch) {
    const start = Math.max(0, descMatch.index - 80)
    const end = Math.min(j.description_excerpt.length, descMatch.index + descMatch[0].length + 80)
    console.log("\ndescription context:")
    console.log("…" + j.description_excerpt.slice(start, end).replace(/\s+/g, " ") + "…")
  }

  // Find ALL matches in the description, not just first
  if (j.description_excerpt) {
    const all: { match: string; index: number; context: string }[] = []
    const g = /\b(internship|intern|co[\s-]?op)\b/gi
    let m: RegExpExecArray | null
    while ((m = g.exec(j.description_excerpt)) !== null) {
      const start = Math.max(0, m.index - 60)
      const end = Math.min(j.description_excerpt.length, m.index + m[0].length + 60)
      all.push({
        match: m[0],
        index: m.index,
        context: "…" + j.description_excerpt.slice(start, end).replace(/\s+/g, " ") + "…",
      })
    }
    console.log(`\n=== all ${all.length} match(es) in description excerpt (first 4k chars) ===`)
    for (const a of all.slice(0, 8)) {
      console.log(`  [${a.index}] "${a.match}"  ${a.context}`)
    }
    if (all.length > 8) console.log(`  …(${all.length - 8} more)`)
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
