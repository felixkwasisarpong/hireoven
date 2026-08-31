/**
 * Honest coverage measurement, through the real worker path.
 *
 * Earlier numbers came from a parallel harness and counted ATS sentinels
 * ("resumator_no_selection") as filled fields, so they overstated how complete
 * a form actually was. This runs lib/apex/auto-apply/fill-runner directly — the
 * same code the worker uses, with the answer policy applied — over a fixed job
 * set, so the result is both honest and reproducible.
 *
 *   npx tsx scripts/measure-coverage.ts --user <uuid> --limit 40
 *
 * Nothing is submitted: allowSubmit is never set, so the request router arms as
 * soon as a form is found and aborts every non-GET for the rest of the page.
 */

import { chromium } from "playwright"
import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { getPostgresPool } from "../lib/postgres/server"
import { runFillAttempt } from "../lib/apex/auto-apply/fill-runner"
import { getAutoApplyCandidates } from "../lib/apex/auto-apply/candidates"
import { formatResumeContext } from "../lib/autofill/resume-context"
import { buildDerivedFacts } from "../lib/autofill/resume-facts"
import type { AutofillProfile } from "../types"

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function atsOf(url: string): string {
  const h = url.split("/")[2] ?? ""
  for (const k of ["lever", "ashby", "jazzhr", "applytojob", "bamboohr", "greenhouse"]) {
    if (h.includes(k)) return k === "applytojob" ? "jazzhr" : k
  }
  return "other"
}

async function main() {
  const userId = arg("user")
  if (!userId) throw new Error("--user <uuid> is required")
  const limit = Number.parseInt(arg("limit", "40"), 10)

  const pool = getPostgresPool()
  const { rows: pr } = await pool.query<AutofillProfile>(
    `SELECT * FROM autofill_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId])
  const profile = pr[0]
  if (!profile) throw new Error("no autofill profile")

  const { rows: rr } = await pool.query(
    `SELECT summary, primary_role, top_skills, work_experience, education,
            projects, years_of_experience, raw_text
       FROM resumes WHERE user_id = $1 ORDER BY is_primary DESC, updated_at DESC LIMIT 1`, [userId])
  const row = rr[0] as Record<string, unknown> | undefined
  const facts = row ? buildDerivedFacts({
    yearsOfExperience: row.years_of_experience as number | null,
    primaryRole: row.primary_role as string | null,
    topSkills: row.top_skills as string[] | null,
    workExperience: row.work_experience as never,
    city: profile.city, state: profile.state, country: profile.country,
    highestDegree: profile.highest_degree, fieldOfStudy: profile.field_of_study,
    university: profile.university,
  }) : ""
  const resumeContext = [facts, (row ? formatResumeContext(row as never) : "") ?? ""]
    .filter(Boolean).join("\n\n")

  // Use the REAL candidate selection, so the measurement reflects the jobs that
  // would actually be applied to. Measuring an unfiltered slice of tier-1
  // postings produced a queue of bartending, physical-therapy and house-flipping
  // roles, whose screening questions a software résumé cannot answer and never
  // should — which made coverage look worse than the product would ever be.
  const minMatch = Number.parseInt(arg("min-match", "85"), 10)
  const candidates = await getAutoApplyCandidates(userId, {
    minMatchScore: minMatch,
    limit,
    // Include Greenhouse so it stays measured even though the worker skips it.
    includeUnproven: true,
  })
  const jobs = candidates.map((c) => ({
    id: c.jobId, title: c.title, apply_url: c.applyUrl,
    ats_type: null as string | null, name: c.companyName,
    matchScore: c.matchScore,
  }))

  console.log(`measuring ${jobs.length} postings (match >= ${minMatch}) through the real worker path\n`)

  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null
  const browser = await chromium.launch({ headless: true })
  const runId = randomUUID()
  const out: Record<string, unknown>[] = []

  for (const j of jobs) {
    const ats = atsOf(j.apply_url)
    const a = await runFillAttempt({
      applyUrl: j.apply_url, ats, profile, resumeContext,
      jobTitle: j.title ?? "", companyName: j.name ?? "the company",
      userId, runId, anthropic, browser,
      // allowSubmit deliberately omitted.
    })
    out.push({ ats, company: j.name, ...a })
    const tag = a.blocked ? "BLOCKED" : a.formReached ? `${(a.requiredRate * 100).toFixed(0)}%` : "no-form"
    console.log(`  ${ats.padEnd(11)} ${tag.padEnd(8)} ${a.requiredFilled}/${a.requiredTotal} req  ` +
      `grounded=${a.groundedAnswers} ai=${a.aiWrittenBack} refused=${a.refusalsRejected} ${(j.name ?? "").slice(0, 22)}`)
  }

  await browser.close()
  await pool.end()

  // Forms where no required field could be identified are excluded rather than
  // scored: they are unmeasured, and counting them as either pass or fail
  // would misrepresent the result.
  const unmeasured = out.filter((r) => r.formReached && !r.blocked && (r.requiredTotal as number) === 0)
  const reached = out.filter((r) => r.formReached && !r.blocked && (r.requiredTotal as number) > 0)
  const n = reached.length || 1
  const mean = reached.reduce((s, r) => s + (r.requiredRate as number), 0) / n
  const full = reached.filter((r) => (r.requiredRate as number) >= 1).length
  const byAts = new Map<string, { n: number; sum: number; full: number }>()
  for (const r of reached) {
    const e = byAts.get(r.ats as string) ?? { n: 0, sum: 0, full: 0 }
    e.n++; e.sum += r.requiredRate as number; if ((r.requiredRate as number) >= 1) e.full++
    byAts.set(r.ats as string, e)
  }

  console.log("\n──────── honest coverage (sentinels count as EMPTY) ────────")
  console.log(`probed            ${out.length}`)
  console.log(`form reached      ${reached.length}`)
  console.log(`bot-walled        ${out.filter((r) => r.blocked).length}`)
  console.log(`unmeasured        ${unmeasured.length}  (no required field detected — excluded)`)
  console.log(`mean required     ${(mean * 100).toFixed(1)}%`)
  console.log(`fully covered     ${full}/${reached.length} forms  <-- submittable`)
  for (const [a, e] of [...byAts].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${a.padEnd(11)} n=${String(e.n).padStart(2)}  ${((e.sum / e.n) * 100).toFixed(0)}%  full=${e.full}`)
  }
  console.log(`grounded answers  ${out.reduce((s, r) => s + (r.groundedAnswers as number), 0)}`)
  console.log(`AI answers        ${out.reduce((s, r) => s + (r.aiWrittenBack as number), 0)}`)
  console.log(`refusals rejected ${out.reduce((s, r) => s + (r.refusalsRejected as number), 0)}`)
  console.log(`left for human    ${out.reduce((s, r) => s + (r.leftForHuman as number), 0)}`)
  console.log(`AI cost           $${out.reduce((s, r) => s + (r.costUsd as number), 0).toFixed(5)}`)
  writeFileSync(arg("out", "coverage.json"), JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
