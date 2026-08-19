/**
 * Turning a planned fix into a concrete, reviewable edit.
 *
 * The user approves a diff, not a promise — so every fix has to be expressible
 * as `before` → `after` on a named section before anything is written. That is
 * what this produces.
 *
 * Deliberately split by whether a model is needed at all. Several fixes the
 * review raises are pure data moves: a keyword buried in a bullet already exists
 * and only has to be listed; the "which role is current" answer is a boolean
 * flip; a work-authorization line is the user's own sentence. Routing those
 * through an LLM would add latency, cost, and a fabrication surface to work that
 * is exactly determined. Only genuine rewriting (summaries, over-long bullets)
 * goes to the model, and that lives in the route.
 *
 * Pure module — no DB, no network, no clock. Every function takes a resume and
 * returns a proposal; nothing here mutates or persists.
 */

import type { Resume, ResumeSection, Skills, WorkExperience } from "@/types"

/**
 * Where a proposal lands. "personal" covers the contact block, which is not one
 * of the structured resume sections; "settings" is not a document edit at all
 * (e.g. the field we match against).
 */
export type EditTarget = ResumeSection | "personal" | "settings"

export interface ProposedEdit {
  findingId: string
  target: EditTarget
  /** Short description of the change, shown as the diff row heading. */
  label: string
  /** Rendered current state, for the diff. */
  before: string
  /** Rendered proposed state, for the diff. */
  after: string
  /** The patch itself, consumed by applyProposedEdit. */
  content: unknown
}

// ── Rendering helpers (diff text) ────────────────────────────────────────────

function renderSkills(skills: Skills | null): string {
  if (!skills) return "(none)"
  return skills.technical.join(", ") || "(none)"
}

function renderRoles(roles: WorkExperience[]): string {
  return (
    roles
      .map((r) => `${r.title}, ${r.company}${r.is_current ? "  ← current" : ""}`)
      .join("\n") || "(none)"
  )
}

function roleLabel(role: WorkExperience): string {
  return `${role.title ?? ""}, ${role.company ?? ""}`.trim()
}

// ── Deterministic proposals ──────────────────────────────────────────────────

/**
 * Surface skills the resume already demonstrates but never lists.
 *
 * `buried` comes from the positioning brief, which only reports skills found in
 * the resume's own text — so this relocates evidence rather than adding a claim.
 */
export function proposeSurfacedSkills(resume: Resume, buried: string[]): ProposedEdit | null {
  const existing = new Set((resume.skills?.technical ?? []).map((s) => s.toLowerCase()))
  const toAdd = buried.filter((s) => s.trim() && !existing.has(s.trim().toLowerCase()))
  if (toAdd.length === 0) return null

  const next: Skills = {
    technical: [...(resume.skills?.technical ?? []), ...toAdd],
    soft: resume.skills?.soft ?? [],
    languages: resume.skills?.languages ?? [],
    certifications: resume.skills?.certifications ?? [],
  }

  return {
    findingId: "buried_signal",
    target: "skills",
    label: `List ${toAdd.length} skill${toAdd.length === 1 ? "" : "s"} you already demonstrate`,
    before: renderSkills(resume.skills),
    after: renderSkills(next),
    content: next,
  }
}

/**
 * Keep exactly one role marked current.
 *
 * The end date is deliberately left blank rather than invented — the user can
 * fill it in Studio, and a wrong date is worse than an absent one.
 */
export function proposeSingleCurrentRole(resume: Resume, keepLabel: string): ProposedEdit | null {
  const roles = resume.work_experience ?? []
  const current = roles.filter((r) => r.is_current)
  if (current.length < 2) return null

  const target = keepLabel.trim().toLowerCase()
  if (!roles.some((r) => roleLabel(r).toLowerCase() === target)) return null

  const next = roles.map((role) =>
    role.is_current && roleLabel(role).toLowerCase() !== target
      ? { ...role, is_current: false }
      : role,
  )

  return {
    findingId: "concurrent_current_roles",
    target: "work_experience",
    label: `Keep only "${keepLabel}" as current`,
    before: renderRoles(roles),
    after: renderRoles(next),
    content: next,
  }
}

/** Append the user's own work-authorization sentence to the summary. */
export function proposeAuthorizationLine(resume: Resume, statement: string): ProposedEdit | null {
  const line = statement.trim()
  if (!line) return null

  const summary = (resume.summary ?? "").trim()
  const sentence = /[.!?]$/.test(line) ? line : `${line}.`
  const next = summary ? `${summary} ${sentence}` : sentence

  return {
    findingId: "authorization_silent",
    target: "summary",
    label: "State your work authorization in the summary",
    before: summary || "(no summary)",
    after: next,
    content: next,
  }
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;]+/i
/**
 * Deliberately looser than the parser's phone pattern. The parser scans a whole
 * resume, where a strict pattern avoids false positives; here the user was asked
 * for their number directly, so the risk runs the other way — a strict US-only
 * pattern silently drops international and short-form numbers, and the user
 * would never learn why their answer did nothing. The proposal is shown as a
 * diff before anything is written, so an over-eager match is visible and
 * rejectable.
 */
const PHONE = /\+?\d[\d\s().-]{5,}\d/

/**
 * Pull contact details out of a free-text answer.
 *
 * Only fields the user actually supplied are proposed; a field we cannot find is
 * left alone rather than blanked.
 */
export function proposeContactDetails(resume: Resume, answer: string): ProposedEdit | null {
  const email = answer.match(EMAIL)?.[0] ?? null
  const linkedinRaw = answer.match(LINKEDIN)?.[0] ?? null
  // Strip the email and URL first so their digits cannot be read as a number.
  const phoneHaystack = answer
    .replace(EMAIL, " ")
    .replace(/(?:https?:\/\/)?\S+\.[a-z]{2,}\/\S*/gi, " ")
  const phone = phoneHaystack.match(PHONE)?.[0].trim() ?? null
  const linkedin = linkedinRaw
    ? linkedinRaw.startsWith("http")
      ? linkedinRaw
      : `https://${linkedinRaw}`
    : null

  const patch: Record<string, string> = {}
  if (email && email !== resume.email) patch.email = email
  if (phone && phone !== resume.phone) patch.phone = phone
  if (linkedin && linkedin !== resume.linkedin_url) patch.linkedin_url = linkedin
  if (Object.keys(patch).length === 0) return null

  const render = (e: string | null, p: string | null, l: string | null) =>
    [e ?? "(no email)", p ?? "(no phone)", l ?? "(no LinkedIn)"].join(" · ")

  return {
    findingId: "contact_incomplete",
    target: "personal",
    label: `Add your ${Object.keys(patch).map((k) => k.replace("_url", "")).join(" and ")}`,
    before: render(resume.email, resume.phone, resume.linkedin_url),
    after: render(
      patch.email ?? resume.email,
      patch.phone ?? resume.phone,
      patch.linkedin_url ?? resume.linkedin_url,
    ),
    content: patch,
  }
}

/** Set the field the matcher scores against. Not a document edit. */
export function proposeTargetField(
  resume: Resume,
  fieldKey: string,
  fieldLabel: string,
): ProposedEdit | null {
  if (!fieldKey || resume.target_field === fieldKey) return null
  return {
    findingId: "no_lane",
    target: "settings",
    label: `Match you as ${fieldLabel}`,
    before: resume.target_field ?? "(not set)",
    after: fieldKey,
    content: { target_field: fieldKey },
  }
}

// ── Applying ─────────────────────────────────────────────────────────────────

/**
 * Apply an approved proposal to a resume, returning a new object.
 *
 * Unknown targets are a no-op rather than a throw: a proposal shape this build
 * does not understand should leave the resume untouched, never half-written.
 */
export function applyProposedEdit(resume: Resume, edit: ProposedEdit): Resume {
  switch (edit.target) {
    case "skills":
      return { ...resume, skills: edit.content as Skills }
    case "summary":
      return { ...resume, summary: edit.content as string }
    case "work_experience":
      return { ...resume, work_experience: edit.content as WorkExperience[] }
    case "personal": {
      const patch = edit.content as Partial<Pick<Resume, "email" | "phone" | "linkedin_url">>
      return { ...resume, ...patch }
    }
    case "settings": {
      const patch = edit.content as { target_field?: string }
      return patch.target_field ? { ...resume, target_field: patch.target_field } : resume
    }
    default:
      return resume
  }
}

/** Apply a set of approved proposals in order. */
export function applyProposedEdits(resume: Resume, edits: ProposedEdit[]): Resume {
  return edits.reduce(applyProposedEdit, resume)
}
