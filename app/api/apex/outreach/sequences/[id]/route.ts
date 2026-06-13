/**
 * PATCH  /api/apex/outreach/sequences/[id] — advance a sequence
 *   { action: "mark_sent", stepNumber }  mark a step sent, schedule the next
 *   { action: "mark_replied" }           contact replied → stop follow-ups
 *   { action: "stop" }                   abandon remaining steps
 *   { action: "edit_draft", stepNumber, draft }  save an edited message
 * DELETE /api/apex/outreach/sequences/[id] — remove the sequence
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  markStepSent,
  stopPendingSteps,
  nextDueStep,
  deriveSequenceStatus,
  type OutreachGoal,
  type OutreachChannel,
  type PlannedStep,
} from "@/lib/apex/outreach/sequence"

export const runtime = "nodejs"

type StepRow = {
  step_number: number; kind: string; status: string
  scheduled_for: string; sent_at: string | null; purpose: string | null
}

function toPlanned(rows: StepRow[], channel: OutreachChannel): PlannedStep[] {
  return rows.map((r) => ({
    stepNumber: r.step_number,
    kind: r.kind as PlannedStep["kind"],
    channel,
    status: r.status as PlannedStep["status"],
    scheduledFor: new Date(r.scheduled_for).toISOString(),
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    purpose: r.purpose ?? "",
  }))
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    action?: string; stepNumber?: number; draft?: string
  }
  const pool = getPostgresPool()

  const seqRes = await pool.query<{ goal: string; channel: string; status: string }>(
    `SELECT goal, channel, status FROM outreach_sequences WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [params.id, user.id],
  )
  const seq = seqRes.rows[0]
  if (!seq) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Edit a draft — no state-machine work.
  if (body.action === "edit_draft" && body.stepNumber) {
    await pool.query(
      `UPDATE outreach_steps SET draft = $1, updated_at = now()
        WHERE sequence_id = $2 AND user_id = $3 AND step_number = $4`,
      [body.draft ?? "", params.id, user.id, body.stepNumber],
    )
    return NextResponse.json({ ok: true })
  }

  const stepsRes = await pool.query<StepRow>(
    `SELECT step_number, kind, status, scheduled_for, sent_at, purpose
       FROM outreach_steps WHERE sequence_id = $1 ORDER BY step_number`,
    [params.id],
  )
  let steps = toPlanned(stepsRes.rows, seq.channel as OutreachChannel)
  let replied = seq.status === "replied"

  const now = new Date().toISOString()
  if (body.action === "mark_sent" && body.stepNumber) {
    steps = markStepSent(steps, seq.goal as OutreachGoal, body.stepNumber, now)
  } else if (body.action === "mark_replied") {
    steps = stopPendingSteps(steps)
    replied = true
  } else if (body.action === "stop") {
    steps = stopPendingSteps(steps)
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const status = deriveSequenceStatus(steps, replied)
  const due = nextDueStep(steps, "9999-12-31") // earliest remaining pending, regardless of date
  const nextDueAt = status === "active" && due ? due.scheduledFor : null

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const s of steps) {
      await client.query(
        `UPDATE outreach_steps SET status = $1, scheduled_for = $2, sent_at = $3, updated_at = now()
          WHERE sequence_id = $4 AND step_number = $5`,
        [s.status, s.scheduledFor, s.sentAt, params.id, s.stepNumber],
      )
    }
    await client.query(
      `UPDATE outreach_sequences
          SET status = $1, next_due_at = $2,
              replied_at = CASE WHEN $1 = 'replied' AND replied_at IS NULL THEN now() ELSE replied_at END,
              updated_at = now()
        WHERE id = $3 AND user_id = $4`,
      [status, nextDueAt, params.id, user.id],
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[outreach/sequences] update failed:", err)
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true, status })
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const res = await pool.query(
    `DELETE FROM outreach_sequences WHERE id = $1 AND user_id = $2`,
    [params.id, user.id],
  )
  if (!res.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
