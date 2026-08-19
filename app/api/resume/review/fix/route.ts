import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { buildReviewContext, currentMonth, loadPrimaryResume } from "@/lib/resume/review-context"
import { planFixes } from "@/lib/resume/fix-plan"
import {
  applyProposedEdits,
  proposeAuthorizationLine,
  proposeContactDetails,
  proposeSingleCurrentRole,
  proposeSurfacedSkills,
  proposeTargetField,
  type ProposedEdit,
} from "@/lib/resume/fix-apply"
import { improveSummary, rewriteBulletPoint } from "@/lib/resume/editor"
import type { Resume, WorkExperience } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Cap the model work a single preview can trigger. */
const MAX_BULLET_REWRITES = 6
/** Matches the review's own threshold for "this bullet is a paragraph". */
const DENSE_BULLET_WORDS = 45

type Body = {
  action?: "preview" | "apply"
  /** Findings the user wants fixed. Omit to mean "everything you can". */
  findingIds?: string[]
  /** Answers to the needs_input questions, keyed findingId → questionId → value. */
  answers?: Record<string, Record<string, string>>
  /** Approved proposals, echoed back from a preview. Only used by "apply". */
  edits?: ProposedEdit[]
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function answerFor(body: Body, findingId: string, questionId: string): string {
  return (body.answers?.[findingId]?.[questionId] ?? "").trim()
}

/** Rewrite the over-long bullets in place, returning the whole work_experience array. */
async function proposeShorterBullets(resume: Resume): Promise<ProposedEdit | null> {
  const roles = resume.work_experience ?? []
  const targets: Array<{ roleIndex: number; bulletIndex: number; text: string }> = []

  roles.forEach((role, roleIndex) => {
    ;(role.achievements ?? []).forEach((text, bulletIndex) => {
      if (text && words(text) > DENSE_BULLET_WORDS) targets.push({ roleIndex, bulletIndex, text })
    })
  })
  if (targets.length === 0) return null

  const slice = targets
    .sort((a, b) => words(b.text) - words(a.text))
    .slice(0, MAX_BULLET_REWRITES)

  const next: WorkExperience[] = roles.map((r) => ({ ...r, achievements: [...(r.achievements ?? [])] }))
  const beforeLines: string[] = []
  const afterLines: string[] = []

  for (const target of slice) {
    const role = roles[target.roleIndex]
    // A failed rewrite leaves the original bullet alone rather than dropping it.
    const result = await rewriteBulletPoint(target.text, {
      jobTitle: role.title ?? "",
      company: role.company ?? "",
      missingKeywords: [],
      editType: "shorten",
    }).catch(() => null)
    const suggestion = result?.suggestion?.trim()
    if (!suggestion || suggestion === target.text) continue

    next[target.roleIndex].achievements[target.bulletIndex] = suggestion
    beforeLines.push(`• ${target.text}`)
    afterLines.push(`• ${suggestion}`)
  }

  if (beforeLines.length === 0) return null

  return {
    findingId: "dense_bullets",
    target: "work_experience",
    label: `Shorten ${beforeLines.length} over-long bullet${beforeLines.length === 1 ? "" : "s"}`,
    before: beforeLines.join("\n\n"),
    after: afterLines.join("\n\n"),
    content: next,
  }
}

async function proposeBetterSummary(resume: Resume): Promise<ProposedEdit | null> {
  const next = await improveSummary(resume.summary, resume).catch(() => null)
  const trimmed = next?.trim()
  if (!trimmed || trimmed === (resume.summary ?? "").trim()) return null
  return {
    findingId: "weak_summary",
    target: "summary",
    label: "Rewrite the summary from your existing experience",
    before: resume.summary?.trim() || "(no summary)",
    after: trimmed,
    content: trimmed,
  }
}

/**
 * Build a proposal per requested finding.
 *
 * Nothing here writes. Every fix is expressed as a before/after the user can
 * reject, which is the contract that makes a one-click "fix everything" safe to
 * offer at all.
 */
async function buildProposals(
  ctx: Awaited<ReturnType<typeof buildReviewContext>>,
  body: Body,
  wanted: Set<string>,
): Promise<ProposedEdit[]> {
  const { resume, brief, signal } = ctx
  const out: ProposedEdit[] = []
  const want = (id: string) => wanted.size === 0 || wanted.has(id)

  // ── Deterministic: the facts are already on the resume ──────────────────────
  if (want("buried_signal") && brief?.surface?.length) {
    const edit = proposeSurfacedSkills(resume, brief.surface)
    if (edit) out.push(edit)
  }

  if (want("no_lane") && !resume.target_field && signal.primary) {
    const edit = proposeTargetField(resume, signal.primary.key, signal.primary.label)
    if (edit) out.push(edit)
  }

  // ── Deterministic, but driven by the user's answer ──────────────────────────
  const keepRole = answerFor(body, "concurrent_current_roles", "current_role")
  if (want("concurrent_current_roles") && keepRole) {
    const edit = proposeSingleCurrentRole(resume, keepRole)
    if (edit) out.push(edit)
  }

  const authorization = answerFor(body, "authorization_silent", "authorization")
  if (want("authorization_silent") && authorization) {
    const edit = proposeAuthorizationLine(resume, authorization)
    if (edit) out.push(edit)
  }

  const contact = answerFor(body, "contact_incomplete", "contact")
  if (want("contact_incomplete") && contact) {
    const edit = proposeContactDetails(resume, contact)
    if (edit) out.push(edit)
  }

  // ── Model rewrites: genuine prose work, no new facts ────────────────────────
  if (want("weak_summary")) {
    const edit = await proposeBetterSummary(resume)
    if (edit) out.push(edit)
  }

  if (want("dense_bullets") || want("too_long")) {
    const edit = await proposeShorterBullets(resume)
    if (edit) out.push(edit)
  }

  return out
}

export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ error: "Unavailable" }, { status: 503 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Body
  const pool = getPostgresPool()
  const resume = await loadPrimaryResume(pool, user.id)
  if (!resume) return NextResponse.json({ error: "No parsed resume" }, { status: 404 })

  // ── Apply ────────────────────────────────────────────────────────────────
  if (body.action === "apply") {
    const edits = Array.isArray(body.edits) ? body.edits : []
    if (edits.length === 0) return NextResponse.json({ error: "Nothing to apply" }, { status: 400 })

    const next = applyProposedEdits(resume, edits)
    const touchedSettings = edits.some((e) => e.target === "settings")

    await pool.query(
      `UPDATE resumes
          SET summary = $1,
              work_experience = $2::jsonb,
              skills = $3::jsonb,
              email = $4,
              phone = $5,
              linkedin_url = $6,
              target_field = $7,
              content_modified = true,
              updated_at = now()
        WHERE id = $8 AND user_id = $9`,
      [
        next.summary,
        JSON.stringify(next.work_experience ?? []),
        JSON.stringify(next.skills ?? null),
        next.email,
        next.phone,
        next.linkedin_url,
        next.target_field ?? null,
        resume.id,
        user.id,
      ],
    )

    return NextResponse.json(
      { applied: edits.map((e) => e.findingId), targetFieldChanged: touchedSettings },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  // ── Preview ──────────────────────────────────────────────────────────────
  const ctx = await buildReviewContext(pool, resume, currentMonth())
  const plan = planFixes(ctx.review.findings)

  // Only ever propose against findings this review actually raised — a stale
  // client must not be able to request an edit for a problem that is gone.
  const live = new Set([...plan.auto, ...plan.needsInput].map((s) => s.findingId))
  const requested = new Set((body.findingIds ?? []).filter((id) => live.has(id)))
  const wanted = body.findingIds ? requested : new Set<string>()

  const edits = await buildProposals(ctx, body, wanted)

  return NextResponse.json(
    {
      edits,
      // Anything asked for that produced nothing — usually because its question
      // is unanswered. Surfaced so the UI never silently drops a request.
      unresolved: [...plan.auto, ...plan.needsInput]
        .filter((s) => (wanted.size === 0 || wanted.has(s.findingId)))
        .filter((s) => !edits.some((e) => e.findingId === s.findingId))
        .map((s) => ({ findingId: s.findingId, kind: s.kind, label: s.label, reason: s.reason })),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
