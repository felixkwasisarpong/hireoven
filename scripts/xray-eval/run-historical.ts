/**
 * Application X-Ray historical evaluation runner.
 *
 * Preflight first, execution second. The first pass of this evaluation lost
 * eight of twenty-five jobs to a silent JOB_NOT_FOUND and produced a degenerate
 * result set, so the runner now refuses to report numbers it cannot stand
 * behind: it proves the jobs exist in the same database the API reads, proves
 * the candidate fixture matches what the scenario assumes, and fails loudly
 * rather than quietly scoring a subset.
 *
 *   npx tsx scripts/xray-eval/run-historical.ts
 */
import { getApplicationXRayForUser } from "@/lib/application-xray/server/load-input"
import { getPostgresPool } from "@/lib/postgres/server"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const PACK = "docs/application-xray/xray-eval-pack.md"
const OUT_DIR = "docs/application-xray/results"
const CANDIDATE_EMAIL = "felixsarpong25@gmail.com"

/** Frozen scenario assumptions. A run against different values is a different
 *  experiment and must not be reported as this one. */
const REQUIRED_FIXTURE = {
  visa_status: "opt",
  needs_sponsorship: true,
  opt_end_date: "2026-09-03",
} as const

type Pred = [string, string]

function jobIdsFromPack(): string[] {
  const md = readFileSync(PACK, "utf8")
  const ids = [...md.matchAll(/\*\*Job:\*\*\s*`([0-9a-f-]{36})`/g)].map((m) => m[1]!)
  return [...new Set(ids)]
}

function fail(message: string): never {
  console.error(`\nPREFLIGHT FAILED: ${message}\n`)
  process.exit(1)
}

async function main() {
  const pool = getPostgresPool()
  const preds: Record<string, Pred> = JSON.parse(readFileSync("/tmp/predictions.json", "utf8"))
  const jobIds = jobIdsFromPack()

  console.log("=".repeat(72))
  console.log("PREFLIGHT")
  console.log("=".repeat(72))

  // ── 1. Candidate fixture ───────────────────────────────────────────────
  const profile = (
    await pool.query<{
      id: string
      visa_status: string | null
      needs_sponsorship: boolean | null
      opt_end_date: Date | null
    }>(
      `SELECT id, visa_status, needs_sponsorship, opt_end_date
         FROM profiles WHERE email = $1 LIMIT 1`,
      [CANDIDATE_EMAIL],
    )
  ).rows[0]
  if (!profile) fail(`candidate ${CANDIDATE_EMAIL} not found in this database`)

  const actual = {
    visa_status: profile.visa_status,
    needs_sponsorship: profile.needs_sponsorship,
    opt_end_date: profile.opt_end_date ? profile.opt_end_date.toISOString().slice(0, 10) : null,
  }
  const mismatches = (Object.keys(REQUIRED_FIXTURE) as Array<keyof typeof REQUIRED_FIXTURE>)
    .filter((key) => actual[key] !== REQUIRED_FIXTURE[key])
    .map((key) => `${key}: expected ${REQUIRED_FIXTURE[key]}, found ${actual[key]}`)

  console.log("\ncandidate fixture:")
  for (const key of Object.keys(REQUIRED_FIXTURE)) {
    const k = key as keyof typeof REQUIRED_FIXTURE
    console.log(`  ${actual[k] === REQUIRED_FIXTURE[k] ? "OK  " : "BAD "} ${key} = ${actual[k]}`)
  }
  if (mismatches.length) fail(`candidate fixture drifted:\n  - ${mismatches.join("\n  - ")}`)

  // ── 2. Job presence, from the same database the API reads ──────────────
  const present = new Set(
    (await pool.query<{ id: string }>(`SELECT id::text FROM jobs WHERE id = ANY($1::uuid[])`, [jobIds]))
      .rows.map((row) => row.id),
  )
  const missing = jobIds.filter((id) => !present.has(id))
  console.log(`\njob rows: ${present.size}/${jobIds.length} present`)
  if (missing.length) {
    console.log("  missing:")
    for (const id of missing) console.log(`    ${id}`)
    fail(
      `${missing.length} pack job(s) absent from this database. ` +
        `Regenerate the pack from this database before running.`,
    )
  }

  // ── 3. Execute ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72))
  console.log("EXECUTION")
  console.log("=".repeat(72))
  const now = new Date().toISOString()
  const results: any[] = []
  for (const jobId of jobIds) {
    try {
      const { xray } = (await getApplicationXRayForUser({ userId: profile.id, jobId, now })) as any
      const b = xray.summary?.bands ?? {}
      results.push({
        jobId,
        ok: true,
        predicted: preds[jobId]?.[0] ?? null,
        predictedWhy: preds[jobId]?.[1] ?? null,
        action: xray.finalAction,
        rule: xray.decisionTrace?.selectedRuleId ?? null,
        stage: xray.decisionTrace?.selectedStage ?? null,
        confidence: xray.confidence,
        bands: b,
        canWork: xray.eligibility?.candidate?.canWorkForTargetEmployerWithoutNewImmigrationAction ?? null,
        postingCategories: (xray.eligibility?.postingRequirements ?? []).map((r: any) => r.category),
        actions: (xray.actions ?? []).map((a: any) => a.kind),
        actionAddresses: (xray.actions ?? []).map((a: any) => (a.addresses ?? []).join("+")),
        dataGapIds: (xray.dataGaps ?? []).map((g: any) => g.id),
        traceInputKeys: Object.keys(
          xray.decisionTrace?.evaluated?.find((e: any) => e.outcome === "selected_action")?.inputs ?? {},
        ),
        headline: xray.headline ?? null,
      })
    } catch (error: any) {
      results.push({ jobId, ok: false, predicted: preds[jobId]?.[0] ?? null, error: String(error?.message ?? error) })
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nexecuted: ${results.length - failed.length}/${results.length}`)
  for (const f of failed) console.log(`  FAIL ${f.jobId}  ${f.error}`)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/xray-historical.json`, JSON.stringify({ ranAt: now, candidate: actual, results }, null, 2))
  console.log(`\nwrote ${OUT_DIR}/xray-historical.json`)

  if (failed.length) fail(`${failed.length} job(s) did not execute. All 25 must return a response.`)
  console.log("\nALL JOBS EXECUTED")
  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
