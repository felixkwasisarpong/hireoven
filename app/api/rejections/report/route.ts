import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { computePatternForCompany, normalizeTitle } from "@/lib/rejections/pattern-computer"

export const runtime = "nodejs"

type ReportBody = {
  jobId?: string
  applicationStage: string
  outcome: string
  rejectionReason?: string
  daysToResponse?: number
  hadReferral: boolean
  appliedWithin48hrs: boolean
}

const VALID_STAGES  = new Set(["applied","phone_screen","technical","final","offer"])
const VALID_OUTCOMES = new Set(["rejected","ghosted","withdrew","offer_received"])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({})) as ReportBody
  if (!VALID_STAGES.has(body.applicationStage))
    return NextResponse.json({ error: "Invalid applicationStage" }, { status: 400 })
  if (!VALID_OUTCOMES.has(body.outcome))
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 })

  const pool = getPostgresPool()

  // ── Resolve job + company ────────────────────────────────────────────────
  let companyId: string | null = null
  let jobTitle: string = ""
  if (body.jobId) {
    const jobRes = await pool.query<{ company_id: string | null; title: string }>(
      `SELECT company_id, title FROM jobs WHERE id = $1 LIMIT 1`,
      [body.jobId]
    )
    companyId = jobRes.rows[0]?.company_id ?? null
    jobTitle  = jobRes.rows[0]?.title ?? ""
  }
  const normalized = normalizeTitle(jobTitle)

  // ── Insert submission ────────────────────────────────────────────────────
  const subRes = await pool.query<{ id: string }>(
    `INSERT INTO rejection_submissions
       (user_id, job_id, company_id, normalized_title,
        application_stage, outcome, rejection_reason,
        days_to_response, had_referral, applied_within_48hrs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      user.id,
      body.jobId ?? null,
      companyId,
      normalized,
      body.applicationStage,
      body.outcome,
      body.rejectionReason ?? null,
      body.daysToResponse  ?? null,
      body.hadReferral,
      body.appliedWithin48hrs,
    ]
  )
  const submissionId = subRes.rows[0].id

  // ── Snapshot user profile ─────────────────────────────────────────────────
  // Try resume + profile — never block submission on failure
  try {
    const [resumeRes, profileRes] = await Promise.all([
      pool.query<{ top_skills: string[] | null; seniority_level: string | null }>(
        `SELECT top_skills, seniority_level
         FROM resumes
         WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete'
         LIMIT 1`,
        [user.id]
      ),
      pool.query<{ visa_status: string | null }>(
        `SELECT visa_status FROM profiles WHERE user_id = $1 LIMIT 1`,
        [user.id]
      ),
    ])
    const resume  = resumeRes.rows[0]
    const profile = profileRes.rows[0]

    // Map seniority → rough years
    const SENIORITY_YOE: Record<string, number> = {
      intern: 0, junior: 1, mid: 3, senior: 6, staff: 10, principal: 12, director: 15,
    }
    const yoe = resume?.seniority_level
      ? (SENIORITY_YOE[resume.seniority_level] ?? null)
      : null

    // Normalise visa
    const visaMap: Record<string, string> = {
      opt: "opt", stem_opt: "opt", h1b: "h1b", green_card: "green_card",
      citizen: "citizen", tn: "tn",
    }
    const visaStatus = profile?.visa_status
      ? (visaMap[profile.visa_status] ?? "other")
      : null

    await pool.query(
      `INSERT INTO rejection_profile_snapshots
         (submission_id, years_of_experience, visa_status, skill_tags)
       VALUES ($1, $2, $3, $4::text[])`,
      [
        submissionId,
        yoe,
        visaStatus,
        resume?.top_skills ?? [],
      ]
    )
  } catch { /* non-critical */ }

  // ── Async pattern recomputation ──────────────────────────────────────────
  if (companyId && normalized) {
    void computePatternForCompany(companyId, normalized).catch(() => {})
  }

  return NextResponse.json({ success: true, submissionId })
}
