/**
 * Resume Review — the "why am I not getting interviews?" engine.
 *
 * Every other resume surface in the product answers a question the user already
 * knew to ask: score it, tailor it, find skill gaps, pick a lane. This one
 * answers the question they actually arrive with, and it runs itself — the
 * resume does not sit in a bucket waiting to be acted on.
 *
 * The shape is deliberately a *ranked causal diagnosis*, not a score. A score
 * says "72/100" and changes nothing. A diagnosis says: here is what is blocking
 * you, in the order it costs you interviews, with the evidence pulled from your
 * own resume, and here is the one screen that fixes it.
 *
 * Ordering matters more than completeness. The structural findings (silence on
 * work authorization, a split professional signal, targeting a field that barely
 * sponsors) cost far more interviews than dense bullets do, and a user who fixes
 * bullet wording while a knockout filter is rejecting them has learned nothing.
 * So `weight` encodes cost-in-interviews, and the walkthrough follows it.
 *
 * Grounding contract: every finding is computed from the resume's own content or
 * from corpus-derived signal/pivot data passed in. Nothing here infers intent,
 * guesses at immigration status, or invents a statistic. `evidence` always
 * quotes the user's own material so a finding can be checked, not just believed.
 *
 * Pure module — no DB, no network, no clock (pass `asOf`). Safe to unit-test and
 * to import anywhere.
 */

import { profileFor, type DocumentKindResult, type ReviewProfile } from "@/lib/resume/document-kind"
import type { PositioningBrief, ResumeSignal } from "@/lib/resume/signal"
import type { PivotSuggestion } from "@/lib/resume/pivot-suggest"
import type { Resume, WorkExperience } from "@/types"

export type FindingSeverity = "blocker" | "major" | "minor"

export interface FindingAction {
  label: string
  href: string
}

export interface ResumeFinding {
  /** Stable identifier — safe to persist, dedupe, and track resolution against. */
  id: string
  severity: FindingSeverity
  /**
   * Cost-in-interviews weight (0-100). Drives walkthrough order. A structural
   * finding always outranks a cosmetic one, however tidy the cosmetic fix is.
   */
  weight: number
  /** The defect, as a headline. */
  title: string
  /** What we observed, stated plainly from their resume. */
  observation: string
  /** Why it costs interviews — the causal step users are missing. */
  cost: string
  /** Quotes/numbers from their own resume, so the finding can be verified. */
  evidence: string[]
  /** The concrete change to make. */
  fix: string
  /** Deep link to the surface that already fixes this. */
  action?: FindingAction
}

export interface ResumeReview {
  /** Ranked most-costly first. */
  findings: ResumeFinding[]
  blockers: number
  majors: number
  /** What the resume currently reads as, when signal is available. */
  readsAs: string | null
  /** Which rulebook this was judged against, and why. */
  documentKind: DocumentKindResult["kind"]
  documentKindLabel: string
  documentKindSignals: string[]
  /** Deterministic top-line read. Never a score. */
  verdict: string
}

/** The resume columns the review needs. Narrow so tests can build fixtures. */
export type ReviewResume = Pick<
  Resume,
  | "summary"
  | "raw_text"
  | "work_experience"
  | "top_skills"
  | "skills"
  | "primary_role"
  | "target_field"
  | "email"
  | "phone"
  | "linkedin_url"
  | "additional_sections"
  | "education"
>

export interface ReviewInput {
  resume: ReviewResume
  /** Corpus-grounded when available; keyword fallback otherwise. */
  signal?: ResumeSignal | null
  /** Positioning brief for the resume's current/chosen lane. */
  brief?: PositioningBrief | null
  /** Auto-selected pivot target, when one meaningfully beats the current lane. */
  pivot?: PivotSuggestion | null
  /** Reference date for gap/recency math. Defaults to epoch-free "no gap check". */
  asOf?: string
  /**
   * What kind of document this is. Supplied by the caller (which already ran the
   * detector) so the review is judged against the right rulebook. Defaults to
   * resume conventions when absent.
   */
  kind?: DocumentKindResult | null
}

// ── Thresholds ───────────────────────────────────────────────────────────────
// Named so a reviewer can argue with the number instead of hunting for it.

/** A bullet longer than this reads as a paragraph and gets skipped. */
const DENSE_BULLET_WORDS = 45
/** Below this share of bullets carrying a number, the resume asserts without evidence. */
const MIN_QUANTIFIED_SHARE = 0.3
/** A summary shorter than this is not doing positioning work. */
const MIN_SUMMARY_WORDS = 25
/** Months between roles before it reads as a gap that needs explaining. */
const GAP_MONTHS = 5
/**
 * Sponsorship-density gap (in percentage points, matching PivotSuggestion.sponsorDelta)
 * that makes a pivot worth raising as a targeting finding rather than a nudge.
 */
const SPONSOR_EDGE_PTS = 10

const AUTHORIZATION_PATTERNS = [
  /work\s+authoriz/i,
  /authoriz(?:ed|ation)\s+to\s+work/i,
  /\bopt\b/i,
  /\bcpt\b/i,
  /\bh-?1-?b\b/i,
  /\bo-?1\b/i,
  /\btn\s+visa\b/i,
  /green\s+card/i,
  /permanent\s+resident/i,
  /u\.?s\.?\s+citizen/i,
  /\bead\b/i,
  /require\s+sponsorship/i,
  /no\s+sponsorship/i,
  /visa\s+status/i,
  /work\s+permit/i,
]

const FILLER_PHRASES = [
  "hard-working",
  "hard working",
  "team player",
  "passionate",
  "results-driven",
  "results driven",
  "go-getter",
  "self-starter",
  "detail-oriented",
  "detail oriented",
  "dynamic professional",
  "proven track record",
  "think outside the box",
  "wear many hats",
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function words(text: string | null | undefined): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function truncate(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/** All bullet-ish lines across roles: achievements plus sentence-split descriptions. */
function collectBullets(roles: WorkExperience[]): string[] {
  const out: string[] = []
  for (const role of roles) {
    for (const a of role.achievements ?? []) {
      if (a && a.trim()) out.push(a.trim())
    }
    const desc = role.description?.trim()
    if (desc) {
      // Descriptions arrive either as a blob or as newline-separated bullets.
      const lines = desc.includes("\n")
        ? desc.split(/\n+/)
        : desc.split(/(?<=[.!?])\s+(?=[A-Z])/)
      for (const line of lines) {
        const t = line.replace(/^[\s•\-*·]+/, "").trim()
        if (t.length > 15) out.push(t)
      }
    }
  }
  return out
}

/** Tolerant month parser: ISO, "2026-03", "March 2026", "Mar 2026", "03/2026". */
export function parseMonth(value: string | null | undefined): number | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw || /^(present|current|now)$/i.test(raw)) return null

  const iso = raw.match(/^(\d{4})-(\d{1,2})/)
  if (iso) return Number(iso[1]) * 12 + (Number(iso[2]) - 1)

  const slash = raw.match(/^(\d{1,2})\/(\d{4})$/)
  if (slash) return Number(slash[2]) * 12 + (Number(slash[1]) - 1)

  const MONTHS = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ]
  const named = raw.match(/([a-z]{3,9})\.?\s+(\d{4})/i)
  if (named) {
    const idx = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase())
    if (idx >= 0) return Number(named[2]) * 12 + idx
  }

  const yearOnly = raw.match(/^(\d{4})$/)
  if (yearOnly) return Number(yearOnly[1]) * 12

  return null
}

function roleLabel(role: WorkExperience): string {
  const title = role.title?.trim()
  const company = role.company?.trim()
  if (title && company) return `${title}, ${company}`
  return title || company || "Untitled role"
}

function blob(resume: ReviewResume): string {
  return [resume.raw_text, resume.summary].filter(Boolean).join("\n").toLowerCase()
}

// ── The checks ───────────────────────────────────────────────────────────────
// Each returns a finding or null. Kept as small named functions so a check can
// be argued with, tested, or removed on its own.

function checkAuthorizationSilence(resume: ReviewResume): ResumeFinding | null {
  const text = blob(resume)
  if (!text) return null
  if (AUTHORIZATION_PATTERNS.some((re) => re.test(text))) return null

  return {
    id: "authorization_silent",
    severity: "blocker",
    weight: 96,
    title: "Your resume says nothing about work authorization",
    observation:
      "There is no line anywhere on the resume stating your right to work in the US, and no dates or status that let a reader infer it.",
    cost:
      "Screeners do not give silence the benefit of the doubt. If anything else on the page reads international — a foreign employer, a recent US degree, a non-US phone number — they assume the most expensive case, which is a lottery-gated H-1B petition, and move on. That decision happens before a single bullet is read.",
    evidence: ["No work-authorization statement found in the resume text"],
    fix:
      "Add one line under your name stating your status and how long it runs. If you are on OPT with a STEM-eligible degree, say so explicitly and name the end date — an employer reading 'no petition or lottery required' is being told this hire is cheap and certain, which is the opposite of what they assumed.",
    action: { label: "Open Resume Studio", href: "/dashboard/resume/studio" },
  }
}

function checkSplitSignal(signal: ResumeSignal | null | undefined): ResumeFinding | null {
  if (!signal?.split || !signal.primary || !signal.runnerUp) return null

  return {
    id: "split_signal",
    severity: "blocker",
    weight: 94,
    title: "Your resume reads as two different candidates",
    observation: `It signals ${signal.primary.label} and ${signal.runnerUp.label} at almost the same strength, so neither reads as your actual lane.`,
    cost:
      "A hiring manager is filling one specific role. When a resume splits its signal, each reviewer sees a candidate who is partly theirs and mostly someone else's, and both pass. Split positioning loses to a narrower resume with less experience on it.",
    evidence: [
      `${signal.primary.label}: ${signal.primary.score}% match to what those jobs ask for`,
      `${signal.runnerUp.label}: ${signal.runnerUp.score}% match to what those jobs ask for`,
    ],
    fix:
      "Keep one master resume, but send targeted versions. Pick the lane per application and cut the other lane down to a supporting line or two — not shrunk, deleted. The material you cut is what the second version leads with.",
    action: { label: "Pick your lane", href: "/dashboard/resume/positioning" },
  }
}

function checkTargetingSponsorship(pivot: PivotSuggestion | null | undefined): ResumeFinding | null {
  if (!pivot) return null
  const from = pivot.currentSponsorship
  const to = pivot.targetSponsorship
  if (typeof from !== "number" || typeof to !== "number") return null
  if (pivot.sponsorDelta < SPONSOR_EDGE_PTS) return null

  return {
    id: "targeting_sponsorship",
    severity: "blocker",
    weight: 92,
    title: "You are aiming at a field that rarely sponsors",
    observation: `Only ${Math.round(from * 100)}% of live ${pivot.fromLabel} openings sit at employers with a sponsorship record, against ${Math.round(to * 100)}% in ${pivot.toLabel}.`,
    cost:
      "This is the difference between a resume problem and an arithmetic problem. If most of the postings you apply to belong to employers who have never filed for anyone, no amount of rewriting converts them. The applications are dead before they are read.",
    evidence: [
      `${pivot.fromLabel}: ${Math.round(from * 100)}% of openings at sponsoring employers`,
      `${pivot.toLabel}: ${Math.round(to * 100)}% of openings at sponsoring employers (+${pivot.sponsorDelta} points)`,
      `Your current fit for ${pivot.toLabel}: ${pivot.currentFit}% — this target was picked because you are already close to it`,
    ],
    fix:
      "Shift a meaningful share of your applications toward the higher-density field before touching your bullets. You are not starting over — the overlap is why this target was selected rather than a random one.",
    action: { label: "See the bridge", href: "/dashboard/resume/pivot" },
  }
}

function checkConcurrentCurrentRoles(roles: WorkExperience[]): ResumeFinding | null {
  const current = roles.filter((r) => r.is_current)
  if (current.length < 2) return null

  return {
    id: "concurrent_current_roles",
    severity: "major",
    weight: 86,
    title: `You show ${current.length} roles running at once`,
    observation: `${current.map(roleLabel).join(" and ")} are all marked as current.`,
    cost:
      "Two live roles read as someone who is busy, not someone who is available — especially when one of them is your own company. Recruiters skip candidates they expect to decline, and they do it without asking. It also invites the question of how much of your week each role actually gets.",
    evidence: current.map(roleLabel),
    fix:
      "Leave one role as current. Close-date the others, or move a venture or side project into a projects section where it reads as evidence you ship rather than as a competing employer. Make sure your summary says plainly that you are looking.",
    action: { label: "Edit your roles", href: "/dashboard/resume/edit" },
  }
}

function checkBuriedSignal(brief: PositioningBrief | null | undefined): ResumeFinding | null {
  if (!brief?.surface?.length) return null

  return {
    id: "buried_signal",
    severity: "major",
    weight: 82,
    title: "Your strongest keywords are buried in the body",
    observation: `${brief.surface.length} skill${brief.surface.length === 1 ? "" : "s"} that ${brief.targetLabel} roles ask for appear somewhere in your resume but not in your summary, skills list, or job titles.`,
    cost:
      "Keyword screens and six-second human skims both read the top of the page and the structured sections. A qualification mentioned only in the third line of your fourth bullet is, for scoring purposes, not on the resume at all. You are being marked down for things you have actually done.",
    evidence: brief.surface.slice(0, 8),
    fix:
      "Pull these up. Put them in your skills section and work the two or three that matter most into your summary and a role title where they are honest. Nothing new gets claimed — this only relocates what you already earned.",
    action: { label: "Fix positioning", href: "/dashboard/resume/positioning" },
  }
}

function checkNoLane(
  resume: ReviewResume,
  signal: ResumeSignal | null | undefined,
): ResumeFinding | null {
  if (resume.target_field) return null
  if (!signal?.primary) return null

  return {
    id: "no_lane",
    severity: "major",
    weight: 76,
    title: "You have not told us which lane to match you in",
    observation: `We are inferring ${signal.primary.label} from your resume text, but you have not confirmed it.`,
    cost:
      "Every match score, pivot suggestion, and tailoring pass is computed against the field we think you want. Guessing wrong quietly degrades all of them at once, and you would have no way to see that it happened.",
    evidence: signal.fields.slice(0, 3).map((f) => `${f.label}: ${f.score}%`),
    fix: "Confirm your target field so matching, tailoring, and pivot suggestions all aim at the same thing.",
    action: { label: "Set your target field", href: "/dashboard/resume/positioning" },
  }
}

function checkEmploymentGap(roles: WorkExperience[], asOf?: string): ResumeFinding | null {
  const dated = roles
    .map((r) => ({
      role: r,
      start: parseMonth(r.start_date),
      end: r.is_current ? null : parseMonth(r.end_date),
    }))
    .filter((d): d is { role: WorkExperience; start: number; end: number | null } => d.start !== null)
    .sort((a, b) => a.start - b.start)

  if (dated.length < 2) return null

  let worst: { months: number; after: string; before: string } | null = null
  for (let i = 0; i < dated.length - 1; i++) {
    const prev = dated[i]
    const next = dated[i + 1]
    if (prev.end === null) continue // still current; overlap, not a gap
    const months = next.start - prev.end
    if (months >= GAP_MONTHS && (!worst || months > worst.months)) {
      worst = { months, after: roleLabel(prev.role), before: roleLabel(next.role) }
    }
  }

  // Trailing gap: last role ended well before the reference date.
  const asOfMonth = parseMonth(asOf)
  if (asOfMonth !== null) {
    const anyCurrent = dated.some((d) => d.end === null)
    if (!anyCurrent) {
      const last = dated[dated.length - 1]
      const months = last.end !== null ? asOfMonth - last.end : 0
      if (months >= GAP_MONTHS && (!worst || months > worst.months)) {
        worst = { months, after: roleLabel(last.role), before: "today" }
      }
    }
  }

  if (!worst) return null

  return {
    id: "employment_gap",
    severity: "major",
    weight: 72,
    title: `There is a ${worst.months}-month gap on your timeline`,
    observation: `Between ${worst.after} and ${worst.before}.`,
    cost:
      "Screeners read an unexplained gap as a story you are avoiding, and the story they invent is worse than yours almost every time. A gap covered by study, contract work, or a venture costs you nothing once it is visible — it only costs you while it is blank.",
    evidence: [`${worst.after} → ${worst.before}: ${worst.months} months`],
    fix:
      "Fill it with what was actually happening. A degree, a contract, a wound-down venture, and caregiving all read fine when stated. Give it a dated entry like any other role so the eye never lands on empty space.",
    action: { label: "Edit your timeline", href: "/dashboard/resume/edit" },
  }
}

function checkLength(resume: ReviewResume, profile: ReviewProfile): ResumeFinding | null {
  const count = words(resume.raw_text)
  if (count <= profile.longWords) return null
  const pages = Math.max(2, Math.round(count / 500))

  return {
    id: "too_long",
    severity: "major",
    weight: 64,
    title: `Your resume runs about ${pages} pages`,
    observation: `${count.toLocaleString()} words of body text.`,
    cost:
      "A first pass is six to ten seconds. Past two pages the reader is not reading, they are deciding — and everything after that point functions as if it were not written. Length also dilutes: the more you list, the less any single thing weighs.",
    evidence: [`${count.toLocaleString()} words`, `roughly ${pages} pages`],
    fix:
      "Cut to two pages by deleting whole sections rather than trimming every line. A master resume this long is the right thing to keep and the wrong thing to send — the version you send should drop the material that does not serve the specific role.",
    action: { label: "Trim in Studio", href: "/dashboard/resume/studio" },
  }
}

function checkDenseBullets(roles: WorkExperience[]): ResumeFinding | null {
  const bullets = collectBullets(roles)
  if (!bullets.length) return null
  const dense = bullets.filter((b) => words(b) > DENSE_BULLET_WORDS)
  if (dense.length < 2) return null

  const longest = [...dense].sort((a, b) => words(b) - words(a)).slice(0, 2)

  return {
    id: "dense_bullets",
    severity: "major",
    weight: 56,
    title: `${dense.length} of your bullets are paragraphs`,
    observation: `They run past ${DENSE_BULLET_WORDS} words, with the result usually arriving in the third clause.`,
    cost:
      "Resumes are scanned, not read. A long bullet buries its own achievement behind setup, and the scanning eye moves to the next line before reaching it. Good writing at the wrong length still fails.",
    evidence: longest.map((b) => `${words(b)} words: “${truncate(b)}”`),
    fix:
      "Get every bullet under 25 words, verb first, result in the first half of the line. Where a bullet carries two ideas, split it or drop the weaker one.",
    action: { label: "Rewrite bullets", href: "/dashboard/resume/studio" },
  }
}

function checkQuantification(roles: WorkExperience[]): ResumeFinding | null {
  const bullets = collectBullets(roles)
  if (bullets.length < 4) return null
  const quantified = bullets.filter((b) => /\d/.test(b))
  const share = quantified.length / bullets.length
  if (share >= MIN_QUANTIFIED_SHARE) return null

  return {
    id: "unquantified",
    severity: "major",
    weight: 52,
    title: "Most of your bullets carry no numbers",
    observation: `${quantified.length} of ${bullets.length} bullets contain a figure of any kind.`,
    cost:
      "Without a number, a bullet describes a job description rather than a person. Two candidates who both 'improved performance' are indistinguishable; the one who moved p95 from 900ms to 140ms is not. Scale, volume, money, time, and headcount all count.",
    evidence: [`${quantified.length}/${bullets.length} bullets quantified`],
    fix:
      "Add a figure to your strongest bullets. Throughput, latency, cost, revenue, users, tickets, team size, and time saved are all fair. Approximate is fine when it is honest — an approximation you can defend beats a vague claim you cannot.",
    action: { label: "Quantify bullets", href: "/dashboard/resume/studio" },
  }
}

function checkSummary(resume: ReviewResume): ResumeFinding | null {
  const summary = resume.summary?.trim() ?? ""
  const count = words(summary)
  const lower = summary.toLowerCase()
  const filler = FILLER_PHRASES.filter((p) => lower.includes(p))

  if (count >= MIN_SUMMARY_WORDS && filler.length === 0) return null

  const missing = count === 0
  return {
    id: "weak_summary",
    severity: missing ? "major" : "minor",
    weight: missing ? 48 : 38,
    title: missing ? "You have no summary" : "Your summary is not doing positioning work",
    observation: missing
      ? "The resume opens straight into experience."
      : filler.length
        ? `It leans on generic phrasing: ${filler.join(", ")}.`
        : `It runs ${count} words, too short to establish what you are.`,
    cost:
      "The summary is the only place you get to say what you are before the reader decides for themselves. Left blank, they decide from your most recent job title. Filled with adjectives anyone could claim, it is skipped and you have spent your best real estate on nothing.",
    evidence: missing ? ["No summary section"] : [truncate(summary, 180)],
    fix:
      "Three or four lines: what you are, the single most impressive concrete thing you have done, your credential, and what you are looking for. The last clause matters more than people expect — it tells the reader you are actually available.",
    action: { label: "Write your summary", href: "/dashboard/resume/studio" },
  }
}

function checkSkillGaps(brief: PositioningBrief | null | undefined): ResumeFinding | null {
  if (!brief?.closeGaps?.length) return null

  return {
    id: "skill_gaps",
    severity: "minor",
    weight: 34,
    title: `You are missing ${brief.closeGaps.length} in-demand ${brief.targetLabel} skills`,
    observation: `These appear across live ${brief.targetLabel} postings and nowhere on your resume.`,
    cost:
      "Each absent skill narrows the set of postings you can clear on keywords alone. This is the slowest of your problems to fix and the least urgent — worth knowing, not worth blocking on.",
    evidence: brief.closeGaps.slice(0, 6),
    fix:
      "Check these against what you have genuinely touched but never wrote down; that subset is free. For the rest, treat it as a learning queue ranked by how many roles each one unlocks.",
    action: { label: "See skill gaps", href: "/dashboard/resume/skills" },
  }
}

function checkContact(resume: ReviewResume): ResumeFinding | null {
  const missing: string[] = []
  if (!resume.email?.trim()) missing.push("email address")
  if (!resume.phone?.trim()) missing.push("phone number")
  if (!resume.linkedin_url?.trim()) missing.push("LinkedIn URL")
  if (!missing.length) return null

  return {
    id: "contact_incomplete",
    severity: missing.includes("email address") ? "major" : "minor",
    weight: missing.includes("email address") ? 60 : 30,
    title: `Your contact block is missing your ${missing.join(" and ")}`,
    observation: "Either it is absent or the parser could not find it where a reader would look.",
    cost:
      "Parsers pull contact details from the top of the document. When they are missing, placed in a header or text box, or split across columns, the record that reaches the recruiter has holes in it — and a recruiter who cannot reach you does not chase you down.",
    evidence: missing.map((m) => `No ${m} detected`),
    fix:
      "Put all contact details as plain text in the body at the top of page one. Never inside a header, footer, table, or text box — those are the three layout choices that most reliably break parsing.",
    action: { label: "Fix contact details", href: "/dashboard/resume/edit" },
  }
}

function checkAcademicFormatForIndustry(
  kind: DocumentKindResult | null | undefined,
  signal: ResumeSignal | null | undefined,
): ResumeFinding | null {
  if (kind?.kind !== "academic_cv") return null

  const lane = signal?.primary?.label
  return {
    id: "academic_cv_for_industry",
    severity: "major",
    weight: 88,
    title: "This is an academic CV, not an industry resume",
    observation: `We read it as a CV${kind.signals.length ? ` (${kind.signals[0]})` : ""}, and we are reviewing it as one${
      lane ? `, against ${lane}` : ""
    }.`,
    cost:
      "Nothing here is wrong for academia — exhaustive is the point. But industry hiring reads a different document. A recruiter scanning for six seconds will not find your engineering work behind the publication list, and applicant tracking systems score against job-description keywords that a CV does not front-load.",
    evidence: kind.signals.length ? kind.signals : ["Academic CV conventions detected"],
    fix:
      "Keep this CV for academic, research, and national-lab applications, where it is exactly right. For industry roles, cut a separate two-page resume from it: lead with engineering and impact, compress publications to a single line with a count, and drop teaching and service entirely.",
    action: { label: "Build an industry version", href: "/dashboard/resume/studio" },
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<FindingSeverity, number> = { blocker: 0, major: 1, minor: 2 }

/**
 * Run every check and rank the results by what they actually cost in interviews.
 *
 * Returns an empty-findings review rather than throwing when the resume is thin —
 * a resume with nothing parsed should produce "we could not read this", which the
 * caller renders, not a crash.
 */
export function buildResumeReview(input: ReviewInput): ResumeReview {
  const { resume, signal, brief, pivot, asOf, kind } = input
  const roles = resume.work_experience ?? []
  // Judge the document against its own conventions. An academic CV is supposed
  // to be long, prose-heavy, and unquantified; flagging that would be telling a
  // researcher their CV is defective for being a CV.
  const profile = profileFor(kind?.kind ?? "resume")

  const findings = [
    checkAuthorizationSilence(resume),
    checkSplitSignal(signal),
    checkTargetingSponsorship(pivot),
    checkAcademicFormatForIndustry(kind, signal),
    checkConcurrentCurrentRoles(roles),
    checkBuriedSignal(brief),
    checkNoLane(resume, signal),
    checkEmploymentGap(roles, asOf),
    checkLength(resume, profile),
    checkContact(resume),
    profile.checkBulletDensity ? checkDenseBullets(roles) : null,
    profile.checkQuantification ? checkQuantification(roles) : null,
    profile.checkSummary ? checkSummary(resume) : null,
    checkSkillGaps(brief),
  ]
    .filter((f): f is ResumeFinding => f !== null)
    .sort((a, b) => b.weight - a.weight || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  const blockers = findings.filter((f) => f.severity === "blocker").length
  const majors = findings.filter((f) => f.severity === "major").length
  const readsAs = signal?.primary?.label ?? null

  return {
    findings,
    blockers,
    majors,
    readsAs,
    documentKind: profile.kind,
    documentKindLabel: profile.label,
    documentKindSignals: kind?.signals ?? [],
    verdict: buildVerdict(findings, blockers, majors, readsAs),
  }
}

function buildVerdict(
  findings: ResumeFinding[],
  blockers: number,
  majors: number,
  readsAs: string | null,
): string {
  if (!findings.length) {
    return readsAs
      ? `Nothing structural is blocking this resume. It reads clearly as ${readsAs}, so the constraint is where you are sending it, not what it says.`
      : "Nothing structural is blocking this resume. The constraint is where you are sending it, not what it says."
  }

  const lead = findings[0]
  const rest = findings.length - 1
  const tail = rest > 0 ? ` ${rest} other issue${rest === 1 ? "" : "s"} sit${rest === 1 ? "s" : ""} behind it.` : ""

  if (blockers > 0) {
    return `${blockers} thing${blockers === 1 ? "" : "s"} here can end an application before anyone reads a bullet. The most expensive is that ${lead.title.toLowerCase()}.${tail}`
  }
  if (majors > 0) {
    return `Nothing is hard-blocking you, but ${majors} issue${majors === 1 ? "" : "s"} are costing you reads. Start with the fact that ${lead.title.toLowerCase()}.${tail}`
  }
  return `This resume is in good shape. What is left is polish: ${lead.title.toLowerCase()}.${tail}`
}
