/**
 * The guided résumé-optimisation conversation.
 *
 * Replaces the post-upload review panels. The panels showed a ranked diagnosis
 * and left the person to act on it; this asks the two questions that actually
 * change the output — which lane, and which industry — and then optimises
 * toward that answer.
 *
 * The lane question is asked with a derived pick-list rather than a free-text
 * box (see ./lanes.ts): a résumé that reads as backend cannot be usefully
 * sharpened toward a title the experience does not support, so the options are
 * bounded by what the résumé can actually carry.
 *
 * This module is the state machine only — pure, synchronous, no React and no
 * I/O. The UI renders `describe()` and feeds answers back through `advance()`;
 * the fix engine (./fix-plan.ts, ./fix-apply.ts) does the editing. Keeping the
 * sequencing here is what makes the flow testable without a browser, and what
 * lets the same machine drive both the upload flow and the Studio entry point.
 */

import type { ResumeLane } from "@/lib/resume/lanes"

export type ConversationStep =
  /** Résumé read, lanes derived, waiting for the person to choose one. */
  | "choose_lane"
  /** Lane chosen, asking which industry to aim at (or none). */
  | "choose_industry"
  /** Both answers in; the fix plan can be built and applied. */
  | "ready"
  /** No usable signal — the résumé could not be classified. */
  | "blocked"

/** "Open to all" is a real answer, not a missing one, and changes the output. */
export const ANY_INDUSTRY = "__any__"

export interface ConversationState {
  step: ConversationStep
  lanes: ResumeLane[]
  ambiguous: boolean
  selectedLaneKey: string | null
  /** An industry slug, ANY_INDUSTRY, or null while unanswered. */
  industry: string | null
}

export interface ConversationQuestion {
  id: "lane" | "industry"
  prompt: string
  /** Empty for a free-text answer. */
  choices: Array<{ value: string; label: string; hint?: string }>
  allowFreeText: boolean
}

export interface ConversationView {
  /** What the assistant says before the question. May be several paragraphs. */
  narrative: string[]
  question: ConversationQuestion | null
  /** Populated once `step` is "ready" — what optimisation will target. */
  target: { lane: ResumeLane; industry: string | null } | null
}

export function startConversation(lanes: ResumeLane[], ambiguous: boolean): ConversationState {
  return {
    step: lanes.length === 0 ? "blocked" : "choose_lane",
    lanes,
    ambiguous,
    selectedLaneKey: null,
    industry: null,
  }
}

export function selectedLane(state: ConversationState): ResumeLane | null {
  if (!state.selectedLaneKey) return null
  return state.lanes.find((l) => l.key === state.selectedLaneKey) ?? null
}

/**
 * Apply an answer. Unknown lane keys are rejected rather than stored, so a stale
 * or tampered client cannot push the machine into a state whose `target` refers
 * to a lane that was never offered.
 */
export function advance(
  state: ConversationState,
  answer: { id: "lane"; value: string } | { id: "industry"; value: string }
): ConversationState {
  if (state.step === "blocked") return state

  if (answer.id === "lane") {
    const exists = state.lanes.some((l) => l.key === answer.value)
    if (!exists) return state
    return { ...state, selectedLaneKey: answer.value, step: "choose_industry" }
  }

  if (!state.selectedLaneKey) return state
  const industry = answer.value.trim()
  if (!industry) return state
  return { ...state, industry, step: "ready" }
}

export function goBack(state: ConversationState): ConversationState {
  if (state.step === "ready") return { ...state, industry: null, step: "choose_industry" }
  if (state.step === "choose_industry") {
    return { ...state, selectedLaneKey: null, step: "choose_lane" }
  }
  return state
}

function laneHint(lane: ResumeLane): string {
  const bits: string[] = [`${lane.fit}% match`]
  if (lane.jobCount != null) bits.push(`${lane.jobCount.toLocaleString("en-US")} open`)
  if (lane.sponsorshipPct != null) bits.push(`${lane.sponsorshipPct}% sponsor`)
  return bits.join(" · ")
}

/** What the UI should render for the current state. */
export function describe(state: ConversationState): ConversationView {
  if (state.step === "blocked") {
    return {
      narrative: [
        "I could not read a clear direction from this résumé — there is not enough signal yet to tell which roles it points at.",
        "Tell me the kind of role you are targeting and I will work from that instead.",
      ],
      question: {
        id: "lane",
        prompt: "What kind of role are you targeting?",
        choices: [],
        allowFreeText: true,
      },
      target: null,
    }
  }

  if (state.step === "choose_lane") {
    const top = state.lanes[0]!
    const narrative = state.ambiguous
      ? [
          `Your résumé currently reads as two things at once — ${state.lanes[0]!.label} and ${state.lanes[1]!.label} are nearly tied.`,
          "That is the single biggest thing costing you callbacks: a reader cannot tell in six seconds what you are. Pick the lane you want and I will sharpen everything toward it.",
        ]
      : [
          `Your résumé reads strongest as ${top.label} — ${top.fit}% match against what those roles actually ask for.`,
          "Confirm the lane you want to target, or pick another and I will reframe toward it.",
        ]

    return {
      narrative,
      question: {
        id: "lane",
        prompt: "Which lane are you targeting?",
        choices: state.lanes.map((lane) => ({
          value: lane.key,
          label: lane.label,
          hint: laneHint(lane),
        })),
        allowFreeText: false,
      },
      target: null,
    }
  }

  if (state.step === "choose_industry") {
    const lane = selectedLane(state)!
    return {
      narrative: [
        `Targeting ${lane.label}.`,
        "Any industry in particular? If you are open, say so and I will keep it general-purpose — which is usually the right call unless you are committed to one sector.",
      ],
      question: {
        id: "industry",
        prompt: "Which industry or company type?",
        choices: [{ value: ANY_INDUSTRY, label: "Open to all — general-purpose résumé" }],
        allowFreeText: true,
      },
      target: null,
    }
  }

  const lane = selectedLane(state)!
  const industry = state.industry === ANY_INDUSTRY ? null : state.industry
  return {
    narrative: [
      industry
        ? `Optimising for ${lane.label} in ${industry}.`
        : `Optimising for ${lane.label}, general-purpose across industries.`,
      ...(lane.gaps.length > 0
        ? [
            `The gap to close for this lane: ${lane.gaps.slice(0, 4).join(", ")}. I will only surface these where your experience genuinely supports them — I will not add skills you have not demonstrated.`,
          ]
        : []),
    ],
    question: null,
    target: { lane, industry },
  }
}
