import { getPostgresPool } from "@/lib/postgres/server"

// ── Title normalisation ───────────────────────────────────────────────────────

const SENIORITY_WORDS =
  /\b(junior|jr\.?|senior|sr\.?|lead|principal|staff|associate|director|vp|head of|chief|founding)\b/gi

export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(SENIORITY_WORDS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Safe rate helper ──────────────────────────────────────────────────────────

function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

// ── Top missing skills ────────────────────────────────────────────────────────

function topMissingSkills(
  successSkillFreq: Map<string, number>,
  rejectSkillFreq: Map<string, number>,
  successCount: number,
  rejectCount: number,
  limit = 6
): string[] {
  if (successCount === 0) return []
  const scores: Array<[string, number]> = []
  for (const [skill, sCount] of successSkillFreq) {
    const sRate = sCount / successCount
    const rCount = rejectSkillFreq.get(skill) ?? 0
    const rRate = rejectCount > 0 ? rCount / rejectCount : 0
    const delta = sRate - rRate
    if (delta > 0.15) scores.push([skill, delta])
  }
  return scores
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([skill]) => skill)
}

// ── Main computation ──────────────────────────────────────────────────────────

export async function computePatternForCompany(
  companyId: string,
  normalizedTitle: string
): Promise<void> {
  const pool = getPostgresPool()

  type SubRow = {
    id: string
    application_stage: string
    outcome: string
    had_referral: boolean
    applied_within_48hrs: boolean
    days_to_response: number | null
    visa_status: string | null
    skill_tags: string[]
  }

  const { rows } = await pool.query<SubRow>(
    `SELECT rs.id, rs.application_stage, rs.outcome,
            rs.had_referral, rs.applied_within_48hrs, rs.days_to_response,
            rps.visa_status, COALESCE(rps.skill_tags, '{}') AS skill_tags
     FROM rejection_submissions rs
     LEFT JOIN rejection_profile_snapshots rps ON rps.submission_id = rs.id
     WHERE rs.company_id = $1 AND rs.normalized_title = $2`,
    [companyId, normalizedTitle]
  )

  const total = rows.length
  if (total === 0) return

  const SCREENED = new Set(["phone_screen", "technical", "final", "offer"])
  const screened   = rows.filter(r => SCREENED.has(r.application_stage))
  const technical  = rows.filter(r => ["technical","final","offer"].includes(r.application_stage))
  const final_     = rows.filter(r => ["final","offer"].includes(r.application_stage))
  const offers     = rows.filter(r => r.application_stage === "offer" || r.outcome === "offer_received")

  // Referral vs cold
  const referrals  = rows.filter(r => r.had_referral)
  const cold       = rows.filter(r => !r.had_referral)
  const refScreen  = referrals.filter(r => SCREENED.has(r.application_stage))
  const coldScreen = cold.filter(r => SCREENED.has(r.application_stage))

  // Visa
  const h1bRows    = rows.filter(r => r.visa_status === "h1b")
  const citRows    = rows.filter(r => r.visa_status === "citizen")
  const h1bScr     = h1bRows.filter(r => SCREENED.has(r.application_stage))
  const citScr     = citRows.filter(r => SCREENED.has(r.application_stage))

  // Apply timing
  const early      = rows.filter(r => r.applied_within_48hrs)
  const late       = rows.filter(r => !r.applied_within_48hrs)
  const earlyScr   = early.filter(r => SCREENED.has(r.application_stage))
  const lateScr    = late.filter(r => SCREENED.has(r.application_stage))

  // Median days to response
  const responseDays = rows
    .map(r => r.days_to_response)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)
  const medDays = responseDays.length
    ? responseDays[Math.floor(responseDays.length / 2)]
    : null

  // Top missing skills (present in screened, absent in rejected)
  const successSkillFreq = new Map<string, number>()
  const rejectSkillFreq  = new Map<string, number>()
  for (const r of rows) {
    const isSuccess = SCREENED.has(r.application_stage)
    for (const skill of r.skill_tags) {
      if (isSuccess) successSkillFreq.set(skill, (successSkillFreq.get(skill) ?? 0) + 1)
      else rejectSkillFreq.set(skill, (rejectSkillFreq.get(skill) ?? 0) + 1)
    }
  }
  const missingSkills = topMissingSkills(
    successSkillFreq,
    rejectSkillFreq,
    screened.length,
    total - screened.length
  )

  await pool.query(
    `INSERT INTO rejection_patterns
       (company_id, job_title_normalized, total_submissions,
        phone_screen_rate, technical_rate, final_rate, offer_rate,
        median_days_to_response, top_missing_skills,
        referral_screen_rate, cold_apply_screen_rate,
        h1b_screen_rate, citizen_screen_rate,
        early_apply_screen_rate, late_apply_screen_rate,
        last_computed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,NOW(),NOW())
     ON CONFLICT (company_id, job_title_normalized) DO UPDATE SET
       total_submissions       = EXCLUDED.total_submissions,
       phone_screen_rate       = EXCLUDED.phone_screen_rate,
       technical_rate          = EXCLUDED.technical_rate,
       final_rate              = EXCLUDED.final_rate,
       offer_rate              = EXCLUDED.offer_rate,
       median_days_to_response = EXCLUDED.median_days_to_response,
       top_missing_skills      = EXCLUDED.top_missing_skills,
       referral_screen_rate    = EXCLUDED.referral_screen_rate,
       cold_apply_screen_rate  = EXCLUDED.cold_apply_screen_rate,
       h1b_screen_rate         = EXCLUDED.h1b_screen_rate,
       citizen_screen_rate     = EXCLUDED.citizen_screen_rate,
       early_apply_screen_rate = EXCLUDED.early_apply_screen_rate,
       late_apply_screen_rate  = EXCLUDED.late_apply_screen_rate,
       last_computed_at        = NOW(),
       updated_at              = NOW()`,
    [
      companyId,
      normalizedTitle,
      total,
      rate(screened.length,  total),
      rate(technical.length,  total),
      rate(final_.length,    total),
      rate(offers.length,    total),
      medDays,
      missingSkills,
      rate(refScreen.length,  referrals.length),
      rate(coldScreen.length, cold.length),
      rate(h1bScr.length,    h1bRows.length),
      rate(citScr.length,    citRows.length),
      rate(earlyScr.length,  early.length),
      rate(lateScr.length,   late.length),
    ]
  )
}

// ── Bulk recompute (cron) ─────────────────────────────────────────────────────

export async function recomputeStalePatterns(): Promise<{ computed: number; durationMs: number }> {
  const pool = getPostgresPool()
  const started = Date.now()

  // Find company+title combos with submissions since last pattern computation
  const { rows } = await pool.query<{ company_id: string; normalized_title: string }>(
    `SELECT DISTINCT rs.company_id, rs.normalized_title
     FROM rejection_submissions rs
     WHERE rs.company_id IS NOT NULL
       AND rs.normalized_title <> ''
       AND (
         NOT EXISTS (
           SELECT 1 FROM rejection_patterns rp
           WHERE rp.company_id = rs.company_id
             AND rp.job_title_normalized = rs.normalized_title
         )
         OR EXISTS (
           SELECT 1 FROM rejection_patterns rp
           WHERE rp.company_id = rs.company_id
             AND rp.job_title_normalized = rs.normalized_title
             AND rs.created_at > rp.last_computed_at
         )
       )
     LIMIT 200`
  )

  let computed = 0
  for (const { company_id, normalized_title } of rows) {
    try {
      await computePatternForCompany(company_id, normalized_title)
      computed++
    } catch { /* silent — never block */ }
  }

  return { computed, durationMs: Date.now() - started }
}
