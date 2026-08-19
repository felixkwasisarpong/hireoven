/**
 * What kind of document did this person actually upload?
 *
 * A two-page industry resume and a fourteen-page academic CV are different
 * artefacts with different rules, and judging one by the other's standards is
 * worse than not judging it at all. "Your resume runs 12 pages" is useful advice
 * to a backend engineer and actively wrong advice to a postdoc, whose CV is
 * supposed to list every publication, grant, course taught, and talk given.
 *
 * So we classify first, then review against the right rulebook. The
 * classification is deterministic and its reasons are surfaced to the user —
 * a misread should be visible and arguable, not silent.
 *
 * Pure module — no DB, no network. Safe to run on read for existing rows, which
 * is why this is derived rather than stored: it works on every resume already in
 * the database without a migration or a backfill.
 */

import type { Education, Resume, ResumeAdditionalSection } from "@/types"

export type DocumentKind = "academic_cv" | "resume"

export interface DocumentKindResult {
  kind: DocumentKind
  /** 0-1. Above ACADEMIC_THRESHOLD we call it a CV. */
  confidence: number
  /** Why we decided this, in plain language, so the user can disagree. */
  signals: string[]
  /** Publication-ish entries counted across sections. Reused by the review. */
  publicationCount: number
}

export type KindResume = Pick<
  Resume,
  "additional_sections" | "education" | "raw_text" | "summary" | "primary_role"
>

/** Section headings that essentially only appear on academic CVs. */
const STRONG_SECTIONS = [
  "publication",
  "peer-reviewed",
  "peer reviewed",
  "journal article",
  "conference proceeding",
  "refereed",
  "grant",
  "funding",
  "fellowship",
  "principal investigator",
  "teaching experience",
  "courses taught",
  "dissertation",
  "invited talk",
  "conference presentation",
  "poster",
  "editorial",
  "academic appointment",
  "research experience",
  "professional service",
]

/** Weaker corroborating headings — common on CVs, not unheard of on resumes. */
const WEAK_SECTIONS = [
  "presentation",
  "talks",
  "awards",
  "honors",
  "honours",
  "patents",
  "affiliation",
  "membership",
  "service",
  "mentoring",
  "scholarship",
  "workshop",
]

/** Body-text markers of scholarly writing. */
const TEXT_MARKERS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\bdoi:\s*10\.\d{4,}/i, label: "DOI-referenced publications", weight: 3 },
  { re: /\bet al\.?[,\s]/i, label: "citations in “et al.” form", weight: 2 },
  { re: /\bproceedings of the\b/i, label: "conference proceedings cited", weight: 2 },
  { re: /\b(?:principal investigator|co-?pi)\b/i, label: "grant leadership (PI/Co-PI)", weight: 3 },
  { re: /\b(?:nsf|nih|erc|darpa)\s+(?:grant|award|fellowship)/i, label: "named research funding", weight: 3 },
  { re: /\bdissertation\b/i, label: "dissertation work", weight: 2 },
  { re: /\bunder review\b|\bin press\b|\bpreprint\b|\barxiv\b/i, label: "papers in submission", weight: 2 },
  { re: /\bh-index\b|\bcitations?:\s*\d+/i, label: "citation metrics", weight: 2 },
  { re: /\bpostdoc(?:toral)?\b/i, label: "postdoctoral experience", weight: 2 },
  { re: /\bteaching assistant\b|\blecturer\b|\badjunct\b/i, label: "teaching appointments", weight: 1 },
]

const DOCTORAL = /\b(ph\.?\s?d|doctor of philosophy|d\.?phil|sc\.?d|ed\.?d|\bmd\b)\b/i

/** Weighted score at which a document is read as an academic CV. */
const ACADEMIC_THRESHOLD = 6

/** A CV this long is normal; a resume this long is a finding. */
export const ACADEMIC_LONG_WORDS = 4000

function sectionsOf(resume: KindResume): ResumeAdditionalSection[] {
  return resume.additional_sections ?? []
}

function isDoctoral(education: Education[] | null | undefined): boolean {
  return (education ?? []).some((e) => DOCTORAL.test(`${e.degree ?? ""} ${e.field ?? ""}`))
}

/**
 * Count publication-shaped entries. Deliberately conservative: it counts items
 * inside publication-ish sections rather than guessing at citations in prose, so
 * a resume that merely mentions a paper is not promoted to a CV.
 */
export function countPublications(resume: KindResume): number {
  let n = 0
  for (const section of sectionsOf(resume)) {
    const h = (section.heading ?? "").toLowerCase()
    if (/publication|peer.?reviewed|journal|proceeding|refereed|preprint|patent/.test(h)) {
      n += section.items?.length ?? 0
    }
  }
  return n
}

/**
 * Classify the document. Returns `resume` unless the academic evidence is
 * genuinely strong — the cost of misreading a resume as a CV (we stop telling a
 * job seeker their 12 pages are a problem) is higher than the reverse.
 */
export function detectDocumentKind(resume: KindResume): DocumentKindResult {
  const sections = sectionsOf(resume)
  const headings = sections.map((s) => (s.heading ?? "").toLowerCase())
  const text = `${resume.raw_text ?? ""}\n${resume.summary ?? ""}`
  const signals: string[] = []
  let score = 0

  const strongHits = headings.filter((h) => STRONG_SECTIONS.some((s) => h.includes(s)))
  if (strongHits.length) {
    score += strongHits.length * 3
    signals.push(
      `${strongHits.length} academic section${strongHits.length === 1 ? "" : "s"}: ${strongHits
        .slice(0, 4)
        .join(", ")}`,
    )
  }

  const weakHits = headings.filter(
    (h) => WEAK_SECTIONS.some((s) => h.includes(s)) && !STRONG_SECTIONS.some((s) => h.includes(s)),
  )
  if (weakHits.length) {
    score += weakHits.length
    signals.push(`supporting sections: ${weakHits.slice(0, 4).join(", ")}`)
  }

  for (const marker of TEXT_MARKERS) {
    if (marker.re.test(text)) {
      score += marker.weight
      signals.push(marker.label)
    }
  }

  const publicationCount = countPublications(resume)
  if (publicationCount >= 3) {
    score += 3
    signals.push(`${publicationCount} publications listed`)
  }

  if (isDoctoral(resume.education)) {
    score += 2
    signals.push("doctoral degree")
  }

  const kind: DocumentKind = score >= ACADEMIC_THRESHOLD ? "academic_cv" : "resume"

  return {
    kind,
    // Saturates at roughly twice the threshold so a wildly academic CV and a
    // merely academic one both read as "confident" rather than overflowing.
    confidence: Math.min(1, score / (ACADEMIC_THRESHOLD * 2)),
    signals: kind === "academic_cv" ? signals.slice(0, 5) : [],
    publicationCount,
  }
}

// ── Review profiles ──────────────────────────────────────────────────────────

export interface ReviewProfile {
  kind: DocumentKind
  label: string
  /** Word count past which length becomes a finding. */
  longWords: number
  /** Whether bullets are expected to be short and scannable. */
  checkBulletDensity: boolean
  /** Whether bullets are expected to carry metrics. */
  checkQuantification: boolean
  /** Whether a punchy positioning summary is expected. */
  checkSummary: boolean
}

const RESUME_PROFILE: ReviewProfile = {
  kind: "resume",
  label: "Resume",
  longWords: 900,
  checkBulletDensity: true,
  checkQuantification: true,
  checkSummary: true,
}

/**
 * Academic CVs are supposed to be exhaustive. Length, prose-length entries, and
 * unquantified lines are conventions of the form, not defects — flagging them
 * would be telling a researcher their CV is wrong for being a CV.
 */
const ACADEMIC_PROFILE: ReviewProfile = {
  kind: "academic_cv",
  label: "Academic CV",
  longWords: ACADEMIC_LONG_WORDS,
  checkBulletDensity: false,
  checkQuantification: false,
  checkSummary: false,
}

export function profileFor(kind: DocumentKind): ReviewProfile {
  return kind === "academic_cv" ? ACADEMIC_PROFILE : RESUME_PROFILE
}
