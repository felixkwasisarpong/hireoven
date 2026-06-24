import { createHash, randomBytes } from "node:crypto"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  computePersonalScore,
  personalScoreBucket,
  type PersonalScoreResult,
  type PersonalScoreInput,
  type DegreeLevel,
} from "./personal-score"

// ── Display-name sanitization (decision 6 / privacy) ──────────────────────────
export function sanitizeDisplayName(input: string): string | null {
  const t = input.trim()
  if (t.length < 1 || t.length > 40) return null
  if (/@|https?:\/\/|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(t)) return null // emails, URLs, phones
  if (/[<>{}]/.test(t)) return null // HTML/JS injection
  return t
}

// ── Resume → score-input mapping helpers ──────────────────────────────────────
function degreeLevel(highest: string | null): DegreeLevel {
  const s = (highest ?? "").toLowerCase()
  if (/ph\.?\s?d|doctor/.test(s)) return "phd"
  if (/master|\bm\.?s\b|m\.?eng|mba|\bm\.?a\b/.test(s)) return "masters"
  if (/bachelor|\bb\.?s\b|\bb\.?a\b|b\.?eng|undergrad/.test(s)) return "bachelors"
  if (/associate/.test(s)) return "associate"
  return "none"
}

const STEM_RE =
  /comput|software|engineer|electr|mechanic|\bdata\b|statistic|math|physic|chem|biolog|information|technolog|\bscience|robot|aero|civil|industrial|analytic|informatics/i
function isStem(field: string | null): boolean {
  return !!field && STEM_RE.test(field)
}

const AUTHORIZED_VISA = new Set([
  "citizen", "us_citizen", "green_card", "permanent_resident", "h1b", "h-1b",
  "opt", "stem_opt", "l1", "l-1", "tn", "o1", "o-1", "ead", "h4_ead",
])
function hasUsWorkAuth(visaStatus: string | null, workAuth: string | null, authorizedFlag: boolean | null): boolean {
  if (visaStatus && AUTHORIZED_VISA.has(visaStatus.toLowerCase().trim())) return true
  if (workAuth && /citizen|green|permanent|authorized|opt|h-?1b|ead/i.test(workAuth)) return true
  return authorizedFlag === true && !!(visaStatus || workAuth)
}

function resumeHash(parts: Record<string, unknown>): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex")
}

// ── Stored card shape ─────────────────────────────────────────────────────────
export interface PersonalScorecard {
  user_id: string
  total_score: number
  grade: string
  result: PersonalScoreResult
  display_name: string | null
  is_public: boolean
  share_token: string | null
  consented_at: string | null
  resume_hash: string
  created_at: string
  updated_at: string
  shared_at: string | null
  resume_changed: boolean // true if the resume changed since this card was computed
}

interface Row {
  user_id: string
  total_score: number
  grade: string
  components_jsonb: PersonalScoreResult
  display_name: string | null
  is_public: boolean
  share_token: string | null
  consented_at: string | Date | null
  resume_hash: string
  created_at: string | Date
  updated_at: string | Date
  shared_at: string | Date | null
}

const iso = (v: string | Date | null): string | null =>
  v == null ? null : new Date(v).toISOString()

function toCard(r: Row, currentHash: string | null): PersonalScorecard {
  return {
    user_id: r.user_id,
    total_score: r.total_score,
    grade: r.grade,
    result: r.components_jsonb,
    display_name: r.display_name,
    is_public: r.is_public,
    share_token: r.share_token,
    consented_at: iso(r.consented_at),
    resume_hash: r.resume_hash,
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
    shared_at: iso(r.shared_at),
    resume_changed: currentHash != null && currentHash !== r.resume_hash,
  }
}

// Resolve a user's resume + profile into a pure score input. Returns null if no resume.
async function buildScoreInput(
  userId: string
): Promise<{ input: PersonalScoreInput; hash: string; firstName: string | null } | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    top_skills: string[] | null
    years_of_experience: number | null
    seniority_level: string | null
    full_name: string | null
    visa_status: string | null
    highest_degree: string | null
    field_of_study: string | null
    work_authorization: string | null
    authorized_to_work: boolean | null
  }>(
    `SELECT r.top_skills, r.years_of_experience, r.seniority_level,
            p.full_name, p.visa_status,
            af.highest_degree, af.field_of_study, af.work_authorization, af.authorized_to_work
     FROM resumes r
     LEFT JOIN profiles p ON p.id = r.user_id
     LEFT JOIN autofill_profiles af ON af.user_id = r.user_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [userId]
  )
  const r = rows[0]
  if (!r) return null

  const skills = (r.top_skills ?? []).slice(0, 10)
  let matched_postings = 0
  const skill_demands: number[] = new Array(skills.length).fill(0)

  if (skills.length > 0) {
    // Single index-backed query over the small sponsor+recent job subset (GIN on jobs.skills).
    const { rows: dem } = await pool.query<{ matched: string; per_skill: Record<string, number> }>(
      `WITH sponsor_jobs AS (
         SELECT id, skills FROM jobs
         WHERE sponsors_h1b = true AND is_active = true
           AND first_detected_at > NOW() - INTERVAL '12 months'
           AND skills && $1::text[]
       )
       SELECT
         (SELECT COUNT(*) FROM sponsor_jobs)::text AS matched,
         COALESCE((
           SELECT json_object_agg(skill, cnt)
           FROM (
             SELECT s AS skill, COUNT(*) AS cnt
             FROM sponsor_jobs, unnest(sponsor_jobs.skills) AS s
             WHERE s = ANY($1::text[])
             GROUP BY s
           ) t
         ), '{}'::json) AS per_skill`,
      [skills]
    )
    matched_postings = Number(dem[0]?.matched ?? 0)
    const per = dem[0]?.per_skill ?? {}
    skills.forEach((s, i) => (skill_demands[i] = Number(per[s] ?? 0)))
  }

  const degree = degreeLevel(r.highest_degree)
  const stem = isStem(r.field_of_study)
  const auth = hasUsWorkAuth(r.visa_status, r.work_authorization, r.authorized_to_work)

  const input: PersonalScoreInput = {
    matched_postings,
    skill_demands,
    skills,
    years_of_experience: r.years_of_experience,
    seniority_level: r.seniority_level,
    degree_level: degree,
    is_stem: stem,
    has_us_work_auth: auth,
  }
  const hash = resumeHash({
    skills,
    yoe: r.years_of_experience,
    sen: r.seniority_level,
    degree,
    stem,
    auth,
  })
  const firstName = r.full_name?.trim().split(/\s+/)[0] ?? null
  return { input, hash, firstName }
}

// Returns the user's card, computing + inserting on first visit. Recompute only when
// forced (resume changes are surfaced via resume_changed, never auto-overwritten — decision 10).
export async function getOrComputePersonalScorecard(
  userId: string,
  opts: { forceRecompute?: boolean } = {}
): Promise<PersonalScorecard | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()

  const built = await buildScoreInput(userId)
  if (!built) return null // no resume → empty state

  const { rows: existingRows } = await pool.query<Row>(
    `SELECT user_id, total_score, grade, components_jsonb, display_name, is_public,
            share_token, consented_at, resume_hash, created_at, updated_at, shared_at
     FROM personal_scorecards WHERE user_id = $1 LIMIT 1`,
    [userId]
  )
  const existing = existingRows[0]

  if (existing && !opts.forceRecompute) {
    return toCard(existing, built.hash)
  }

  const result = computePersonalScore(built.input)
  const { rows: upserted } = await pool.query<Row>(
    `INSERT INTO personal_scorecards (user_id, total_score, grade, components_jsonb, resume_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       total_score = EXCLUDED.total_score,
       grade = EXCLUDED.grade,
       components_jsonb = EXCLUDED.components_jsonb,
       resume_hash = EXCLUDED.resume_hash,
       updated_at = NOW()
     RETURNING user_id, total_score, grade, components_jsonb, display_name, is_public,
               share_token, consented_at, resume_hash, created_at, updated_at, shared_at`,
    [userId, result.total, result.bucket.grade, JSON.stringify(result), built.hash]
  )
  return toCard(upserted[0], built.hash)
}

// ── Sharing ───────────────────────────────────────────────────────────────────
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

export interface ShareResult {
  ok: boolean
  error?: string
  url?: string | null
  is_public?: boolean
}

export async function setPersonalShare(
  userId: string,
  args: { make_public: boolean; display_name?: string; consented?: boolean }
): Promise<ShareResult> {
  if (!hasPostgresEnv()) return { ok: false, error: "unavailable" }
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    share_token: string | null
    consented_at: string | Date | null
    full_name: string | null
  }>(
    `SELECT ps.share_token, ps.consented_at, p.full_name
     FROM personal_scorecards ps
     LEFT JOIN profiles p ON p.id = ps.user_id
     WHERE ps.user_id = $1 LIMIT 1`,
    [userId]
  )
  const row = rows[0]
  if (!row) return { ok: false, error: "no_scorecard" }

  if (args.make_public) {
    const alreadyConsented = row.consented_at != null
    if (!alreadyConsented && !args.consented) {
      return { ok: false, error: "consent_required" }
    }
    const token = row.share_token ?? randomBytes(12).toString("base64url")
    let displayName: string | null = null
    if (args.display_name != null) {
      displayName = sanitizeDisplayName(args.display_name)
      if (!displayName) return { ok: false, error: "invalid_display_name" }
    } else {
      displayName = row.full_name?.trim().split(/\s+/)[0] ?? "Anonymous Candidate"
    }
    await pool.query(
      `UPDATE personal_scorecards SET
         is_public = true,
         share_token = $2,
         display_name = $3,
         consented_at = COALESCE(consented_at, NOW()),
         shared_at = COALESCE(shared_at, NOW()),
         updated_at = NOW()
       WHERE user_id = $1`,
      [userId, token, displayName]
    )
    return { ok: true, is_public: true, url: `${APP_URL}/scorecard/${token}` }
  }

  // make private (keep token row but disable; revoke clears token entirely)
  await pool.query(
    `UPDATE personal_scorecards SET is_public = false, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  )
  return { ok: true, is_public: false, url: null }
}

export async function revokePersonalShare(userId: string): Promise<ShareResult> {
  if (!hasPostgresEnv()) return { ok: false, error: "unavailable" }
  await getPostgresPool().query(
    `UPDATE personal_scorecards SET is_public = false, share_token = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  )
  return { ok: true, is_public: false, url: null }
}

// ── Public (sanitized) view ───────────────────────────────────────────────────
export interface PublicPersonalScorecard {
  display_name: string
  total_score: number
  grade: string
  bucket: PersonalScoreResult["bucket"]
  components: {
    demand: number
    rarity: number
    experience: number
    education: number
  }
  rarest_skill: string | null
  experience_alignment: PersonalScoreResult["components"]["experience"]["alignment"]
  strongest_label: string
  created_at: string
  shared_at: string | null
}

export async function getPublicPersonalScorecard(
  token: string
): Promise<PublicPersonalScorecard | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `UPDATE personal_scorecards SET view_count = view_count + 1
     WHERE share_token = $1 AND is_public = true
     RETURNING user_id, total_score, grade, components_jsonb, display_name, is_public,
               share_token, consented_at, resume_hash, created_at, updated_at, shared_at`,
    [token]
  )
  const r = rows[0]
  if (!r) return null
  const result = r.components_jsonb
  // Re-derive bucket from score to guarantee label/hue consistency with current ladder.
  const bucket = personalScoreBucket(r.total_score)
  return {
    display_name: r.display_name || "Anonymous Candidate",
    total_score: r.total_score,
    grade: bucket.grade,
    bucket,
    components: {
      demand: result.components.demand.score,
      rarity: result.components.rarity.score,
      experience: result.components.experience.score,
      education: result.components.education.score,
    },
    rarest_skill: result.components.rarity.rarest_skill,
    experience_alignment: result.components.experience.alignment,
    strongest_label: result.strongest.label,
    created_at: iso(r.created_at)!,
    shared_at: iso(r.shared_at),
  }
}
