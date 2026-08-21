/**
 * The lanes a résumé can credibly be pointed at.
 *
 * The upload conversation opens by asking which role the person is targeting.
 * Asking that cold is a worse question than it looks: most people answer with a
 * job title they saw once, and the optimizer then sharpens toward a lane their
 * experience does not support. So the options are derived from the résumé first
 * and offered as a pick-list, with the live numbers attached.
 *
 * `suggestPivotTarget` already answers a narrower version of this — "the single
 * adjacent field worth nudging toward" — for the feed. This generalises it to
 * the two-to-four lanes worth *offering*, and keeps the same discipline: every
 * number comes from the corpus (field job counts, sponsorship density) or from
 * the résumé's real skill overlap. Nothing is invented, and a lane the résumé
 * cannot support is not shown just to fill the list.
 *
 * Pure: takes the already-computed signal + profiles, does no I/O.
 */

import type { FieldFit, FieldProfile, ResumeSignal } from "@/lib/resume/signal"

/** Below this the résumé does not support the lane well enough to offer it. */
const MIN_OFFERABLE_FIT = 25
/** Within this of the primary, a second lane is a genuine alternative, not a stretch. */
const NEAR_PRIMARY_GAP = 12
const MAX_LANES = 4

export type LaneKind =
  /** The résumé's strongest field — what it already reads as today. */
  | "current"
  /** Nearly as strong as the primary; the "split signal" case worth resolving. */
  | "adjacent"
  /** Supported but weaker — a deliberate move, shown with the gap made explicit. */
  | "stretch"

export interface ResumeLane {
  key: string
  label: string
  kind: LaneKind
  /** 0–100 fit, from the résumé's real overlap with what the field's jobs ask for. */
  fit: number
  /** Live US openings in this field, or null when the corpus has no profile for it. */
  jobCount: number | null
  /** 0–100 share of those jobs at a sponsoring employer, or null when unknown. */
  sponsorshipPct: number | null
  /** Signature signals the résumé already carries for this lane. */
  strengths: string[]
  /** The most in-demand skills it lacks — what optimising for this lane must address. */
  gaps: string[]
  /**
   * Why this lane is being offered, in the user's terms. Rendered directly in
   * the conversation, so it must read as a sentence, not a debug string.
   */
  rationale: string
}

export interface LaneOptions {
  lanes: ResumeLane[]
  /**
   * True when the top two lanes are close enough that the résumé genuinely reads
   * as both — the case where picking one is the highest-value thing the user can
   * do. The conversation leans on this to explain why it is asking at all.
   */
  ambiguous: boolean
}

function pct(share: number | undefined): number | null {
  if (typeof share !== "number" || !Number.isFinite(share)) return null
  return Math.round(Math.max(0, Math.min(1, share)) * 100)
}

function rationaleFor(kind: LaneKind, fit: number, jobCount: number | null): string {
  const volume = jobCount != null ? ` across ${jobCount.toLocaleString("en-US")} open roles` : ""
  switch (kind) {
    case "current":
      return `What your résumé already reads as — ${fit}% match${volume}.`
    case "adjacent":
      return `Nearly as strong as your main lane — ${fit}% match${volume}. Picking one sharpens both.`
    case "stretch":
      return `Reachable but not yet obvious — ${fit}% match${volume}. Needs the gaps below closed.`
  }
}

/**
 * Rank the lanes worth offering for a résumé.
 *
 * Returns an empty list when the résumé carries no usable signal at all — the
 * caller must then ask an open question rather than present an empty picker.
 */
export function deriveLanes(
  signal: ResumeSignal,
  profiles: FieldProfile[] = []
): LaneOptions {
  const byKey = new Map(profiles.map((p) => [p.key, p]))

  const offerable = signal.fields
    .filter((f) => f.score >= MIN_OFFERABLE_FIT)
    .slice(0, MAX_LANES)

  const primary = offerable[0] ?? null
  const lanes: ResumeLane[] = offerable.map((field: FieldFit, index) => {
    const profile = byKey.get(field.key)
    const jobCount = profile?.jobCount ?? null
    const fit = Math.round(field.score)

    const kind: LaneKind =
      index === 0
        ? "current"
        : primary && primary.score - field.score <= NEAR_PRIMARY_GAP
          ? "adjacent"
          : "stretch"

    return {
      key: field.key,
      label: field.label,
      kind,
      fit,
      jobCount,
      // Prefer the corpus profile; fall back to whatever the signal carried.
      sponsorshipPct: pct(profile?.sponsorshipShare ?? field.sponsorshipShare),
      strengths: field.matched.slice(0, 6),
      gaps: field.missing.slice(0, 6),
      rationale: rationaleFor(kind, fit, jobCount),
    }
  })

  return {
    lanes,
    // signal.split is the module's own read of "this résumé sends two signals".
    // Corroborate with the derived gap so a split flag on two weak fields does
    // not present as a confident either/or.
    ambiguous:
      signal.split &&
      lanes.length >= 2 &&
      lanes[0]!.fit - lanes[1]!.fit <= NEAR_PRIMARY_GAP,
  }
}
