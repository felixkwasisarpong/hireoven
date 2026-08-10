/**
 * Career transition miner.
 *
 * Turns two data sources into role→role edges in `career_transitions`:
 *   - parsed résumé work histories (consecutive roles = a transition)
 *   - HireOven hire outcomes (prior role → the role actually landed)
 *
 * Roles are normalized to a field (a FIELDS key) so edges aggregate across
 * people. This is deliberately WRITE-ONLY accumulation — nothing surfaces it
 * until the counts are meaningful; the value is in starting to collect now.
 *
 * Idempotent: re-running upserts the same edges (UNIQUE user/source/from/to/year).
 * Server-only (pg); classification reuses lib/resume/signal (pure).
 */

import type { Pool } from "pg"
import { FIELDS, fieldAffinity } from "@/lib/resume/signal"
import type { WorkExperience } from "@/types"

const FIELD_MIN_AFFINITY = 0.3

/** Best-fit FIELDS key for a role title (+ optional context), or null. */
export function classifyTitleToField(text: string): string | null {
  let best: string | null = null
  let bestScore = 0
  for (const f of FIELDS) {
    const s = fieldAffinity(f.key, text)
    if (s > bestScore) {
      bestScore = s
      best = f.key
    }
  }
  return bestScore >= FIELD_MIN_AFFINITY ? best : null
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** Best-effort {year, month} from a messy résumé date string. */
function parseYM(s: string | null | undefined): { y: number; m: number } | null {
  if (!s) return null
  const ym = /\b(19|20)\d{2}\b/.exec(s)
  if (!ym) return null
  const y = parseInt(ym[0], 10)
  let m = 1
  const lower = s.toLowerCase()
  const mi = MONTHS.findIndex((mm) => lower.includes(mm))
  if (mi >= 0) {
    m = mi + 1
  } else {
    const dash = /\b(?:19|20)\d{2}[-/](\d{1,2})\b/.exec(s)
    if (dash) m = Math.min(12, Math.max(1, parseInt(dash[1], 10)))
  }
  return { y, m }
}

const SENIORITY_KEYWORDS: Array<{ tier: number; label: string; re: RegExp }> = [
  { tier: 9, label: "exec", re: /\b(chief|cto|ceo|cfo|coo|cpo|founder|president)\b/i },
  { tier: 8, label: "vp", re: /\b(vp|vice\s*president|svp|evp)\b/i },
  { tier: 7, label: "director", re: /\b(director|head\s+of)\b/i },
  { tier: 6, label: "principal", re: /\bprincipal\b/i },
  { tier: 5, label: "staff", re: /\bstaff\b/i },
  { tier: 4, label: "senior", re: /\b(senior|sr\.?|lead)\b/i },
  { tier: 2, label: "junior", re: /\b(junior|jr\.?|associate|entry[-\s]?level)\b/i },
  { tier: 1, label: "intern", re: /\b(intern|trainee|apprentice)\b/i },
]

/** Coarse seniority from a title (defaults to mid). */
function seniorityOf(title: string): { tier: number; label: string } {
  for (const s of SENIORITY_KEYWORDS) if (s.re.test(title)) return { tier: s.tier, label: s.label }
  return { tier: 3, label: "mid" }
}

type Edge = {
  fromTitle: string
  toTitle: string
  fromField: string | null
  toField: string | null
  fromSeniority: string
  toSeniority: string
  seniorityDelta: number
  gapMonths: number | null
  year: number
}

function norm(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200)
}

function buildEdge(
  from: { title: string; description?: string },
  to: { title: string; description?: string },
  year: number,
  gapMonths: number | null,
): Edge {
  const fromSen = seniorityOf(from.title)
  const toSen = seniorityOf(to.title)
  return {
    fromTitle: norm(from.title),
    toTitle: norm(to.title),
    fromField: classifyTitleToField(`${from.title} ${from.description ?? ""}`),
    toField: classifyTitleToField(`${to.title} ${to.description ?? ""}`),
    fromSeniority: fromSen.label,
    toSeniority: toSen.label,
    seniorityDelta: toSen.tier - fromSen.tier,
    gapMonths,
    year,
  }
}

/** Consecutive role edges from one résumé's work history. */
function edgesFromWorkExperience(we: WorkExperience[]): Edge[] {
  const dated = we
    .filter((w) => w?.title && parseYM(w.start_date))
    .map((w) => ({ w, start: parseYM(w.start_date)! }))
    .sort((a, b) => a.start.y * 12 + a.start.m - (b.start.y * 12 + b.start.m))

  const edges: Edge[] = []
  for (let i = 0; i + 1 < dated.length; i++) {
    const prev = dated[i]!.w
    const next = dated[i + 1]!
    const prevEnd = prev.is_current ? null : parseYM(prev.end_date)
    const gapMonths = prevEnd
      ? Math.max(0, next.start.y * 12 + next.start.m - (prevEnd.y * 12 + prevEnd.m))
      : null
    edges.push(buildEdge(prev, next, next.start.y, gapMonths))
  }
  return edges
}

async function upsertEdge(pool: Pool, userId: string | null, source: string, e: Edge): Promise<void> {
  await pool.query(
    `INSERT INTO career_transitions
       (user_id, source, from_title, to_title, from_field, to_field,
        from_seniority, to_seniority, seniority_delta, gap_months, transition_year)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, source, from_title, to_title, transition_year)
     DO UPDATE SET from_field = EXCLUDED.from_field, to_field = EXCLUDED.to_field,
                   from_seniority = EXCLUDED.from_seniority, to_seniority = EXCLUDED.to_seniority,
                   seniority_delta = EXCLUDED.seniority_delta, gap_months = EXCLUDED.gap_months,
                   updated_at = now()`,
    [
      userId, source, e.fromTitle, e.toTitle, e.fromField, e.toField,
      e.fromSeniority, e.toSeniority, e.seniorityDelta, e.gapMonths, e.year,
    ],
  )
}

/** Mine consecutive-role edges from parsed résumé work histories. */
async function mineFromResumes(pool: Pool, limit: number): Promise<number> {
  const { rows } = await pool.query<{ user_id: string; work_experience: WorkExperience[] | null }>(
    `SELECT user_id, work_experience
       FROM resumes
      WHERE parse_status = 'complete' AND is_primary = true AND work_experience IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit],
  )
  let n = 0
  for (const r of rows) {
    if (!Array.isArray(r.work_experience)) continue
    for (const e of edgesFromWorkExperience(r.work_experience)) {
      await upsertEdge(pool, r.user_id, "resume", e)
      n++
    }
  }
  return n
}

/** Mine "prior role → role actually landed" edges from hire outcomes. */
async function mineFromOutcomes(pool: Pool, limit: number): Promise<number> {
  const { rows } = await pool.query<{
    user_id: string
    role_title: string
    start_date: string | null
    offer_accepted_at: string
    work_experience: WorkExperience[] | null
  }>(
    `SELECT ho.user_id, ho.role_title, ho.start_date, ho.offer_accepted_at, r.work_experience
       FROM hired_outcomes ho
       JOIN resumes r ON r.user_id = ho.user_id AND r.is_primary = true AND r.parse_status = 'complete'
      WHERE ho.role_title IS NOT NULL
      ORDER BY ho.offer_accepted_at DESC
      LIMIT $1`,
    [limit],
  )
  let n = 0
  for (const r of rows) {
    if (!Array.isArray(r.work_experience) || r.work_experience.length === 0) continue
    // The user's most recent prior role = latest by start date.
    const priorList = r.work_experience
      .filter((w) => w?.title && parseYM(w.start_date))
      .map((w) => ({ w, start: parseYM(w.start_date)! }))
      .sort((a, b) => b.start.y * 12 + b.start.m - (a.start.y * 12 + a.start.m))
    const prior = priorList[0]?.w
    if (!prior) continue
    const year = parseYM(r.start_date)?.y ?? new Date(r.offer_accepted_at).getFullYear()
    if (!year) continue
    const edge = buildEdge(prior, { title: r.role_title }, year, null)
    await upsertEdge(pool, r.user_id, "hired_outcome", edge)
    n++
  }
  return n
}

export async function mineTransitions(
  pool: Pool,
  opts: { resumeLimit?: number; outcomeLimit?: number } = {},
): Promise<{ resumeEdges: number; outcomeEdges: number }> {
  const resumeEdges = await mineFromResumes(pool, opts.resumeLimit ?? 5000)
  const outcomeEdges = await mineFromOutcomes(pool, opts.outcomeLimit ?? 5000)
  return { resumeEdges, outcomeEdges }
}
