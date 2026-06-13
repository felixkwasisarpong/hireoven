/**
 * GET  /api/apex/outreach/sequences  — list the user's outreach sequences + steps
 * POST /api/apex/outreach/sequences  — start a new multi-touch sequence
 *
 * A sequence targets one contact at a company/role and lays out an initial
 * message plus timed follow-ups. Apex drafts every step; the user sends each
 * manually and marks it. See lib/apex/outreach/sequence.ts for the cadence.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  planSequenceSteps,
  type OutreachChannel,
  type OutreachGoal,
} from "@/lib/apex/outreach/sequence"
import { CADENCES } from "@/lib/apex/outreach/sequence"
import { generateSequenceDrafts } from "@/lib/apex/outreach/draft-sequence"

export const runtime = "nodejs"
export const maxDuration = 30

const GOALS: OutreachGoal[] = ["referral_request", "recruiter_intro", "hiring_manager"]
const CHANNELS: OutreachChannel[] = ["linkedin", "email"]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `SELECT s.id, s.goal, s.channel, s.contact_name, s.contact_role,
            s.company_name, s.job_title, s.status, s.replied_at, s.next_due_at, s.created_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'stepNumber', st.step_number, 'kind', st.kind, 'purpose', st.purpose,
                  'draft', st.draft, 'status', st.status,
                  'scheduledFor', st.scheduled_for, 'sentAt', st.sent_at
                ) ORDER BY st.step_number
              ) FILTER (WHERE st.id IS NOT NULL), '[]'
            ) AS steps
       FROM outreach_sequences s
       LEFT JOIN outreach_steps st ON st.sequence_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY (s.status = 'active') DESC, s.next_due_at NULLS LAST, s.created_at DESC`,
    [user.id],
  ).catch(() => ({ rows: [] }))

  return NextResponse.json({ sequences: rows })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    goal?: string; channel?: string; jobId?: string; companyId?: string
    contactName?: string; contactRole?: string; companyName?: string; jobTitle?: string
  }
  const goal = (GOALS.includes(body.goal as OutreachGoal) ? body.goal : "referral_request") as OutreachGoal
  const channel = (CHANNELS.includes(body.channel as OutreachChannel) ? body.channel : "linkedin") as OutreachChannel

  const pool = getPostgresPool()

  // ── Gather context for the drafts ──────────────────────────────────────────
  const [profileRes, resumeRes] = await Promise.all([
    pool.query<{ full_name: string | null }>(`SELECT full_name FROM profiles WHERE id = $1 LIMIT 1`, [user.id]),
    pool.query<{ summary: string | null; top_skills: string[] | null }>(
      `SELECT summary, top_skills FROM resumes WHERE user_id = $1 AND parse_status = 'complete'
        ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [user.id],
    ),
  ])

  let companyName = body.companyName?.trim() || "the company"
  let jobTitle: string | null = body.jobTitle?.trim() || null
  let companyId = body.companyId ?? null
  if (body.jobId) {
    const j = await pool.query<{ title: string; company_id: string | null; company_name: string | null }>(
      `SELECT j.title, j.company_id, c.name AS company_name
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = $1 LIMIT 1`,
      [body.jobId],
    ).catch(() => null)
    if (j?.rows[0]) {
      jobTitle = j.rows[0].title
      companyId = companyId ?? j.rows[0].company_id
      companyName = j.rows[0].company_name ?? companyName
    }
  } else if (companyId) {
    const c = await pool.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1 LIMIT 1`, [companyId]).catch(() => null)
    if (c?.rows[0]) companyName = c.rows[0].name
  }

  const candidateName = profileRes.rows[0]?.full_name?.trim() || "the candidate"
  const candidateHeadline = (resumeRes.rows[0]?.summary ?? "").slice(0, 200) || "a strong candidate for this role"
  const topStrengths = resumeRes.rows[0]?.top_skills ?? []

  // ── Plan + draft ────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const planned = planSequenceSteps(goal, channel, now)
  const drafts = await generateSequenceDrafts(
    { goal, channel, candidateName, candidateHeadline, topStrengths, companyName, jobTitle, contactName: body.contactName ?? null, contactRole: body.contactRole ?? null },
    CADENCES[goal],
  )

  // ── Persist in a transaction ─────────────────────────────────────────────────
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const seq = await client.query<{ id: string }>(
      `INSERT INTO outreach_sequences
         (user_id, company_id, job_id, goal, channel, contact_name, contact_role, company_name, job_title, status, next_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
       RETURNING id`,
      [user.id, companyId, body.jobId ?? null, goal, channel, body.contactName ?? null, body.contactRole ?? null, companyName, jobTitle, planned[0].scheduledFor],
    )
    const sequenceId = seq.rows[0].id
    for (const step of planned) {
      const draft = drafts.find((d) => d.stepNumber === step.stepNumber)?.draft ?? ""
      await client.query(
        `INSERT INTO outreach_steps
           (sequence_id, user_id, step_number, kind, purpose, draft, status, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
        [sequenceId, user.id, step.stepNumber, step.kind, step.purpose, draft, step.scheduledFor],
      )
    }
    await client.query("COMMIT")
    return NextResponse.json({ id: sequenceId }, { status: 201 })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[outreach/sequences] create failed:", err)
    return NextResponse.json({ error: "Failed to create sequence" }, { status: 500 })
  } finally {
    client.release()
  }
}
