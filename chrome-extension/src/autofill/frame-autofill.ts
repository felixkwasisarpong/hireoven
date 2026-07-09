/**
 * Cross-frame autofill for embedded application forms.
 *
 * Many company career sites embed an ATS (Greenhouse/Lever/…) inside a
 * CROSS-ORIGIN iframe — e.g. precisely.com renders the Greenhouse form from
 * `job-boards.greenhouse.io/embed/job_app`. The Apex bar lives in the TOP
 * frame and cannot read (let alone fill) a cross-origin iframe, so autofill
 * silently did nothing on these pages.
 *
 * The content script is injected into every frame (`all_frames: true`), so the
 * iframe already has an idle instance. This module lets the top frame hand the
 * fill off to it: the top frame `postMessage`s each child iframe's window (this
 * works cross-origin), and the injected content script inside a frame that
 * actually contains an application form fills its OWN document — exactly as it
 * would if the user had navigated to the ATS URL directly. No new permissions,
 * no background relay, no manifest change.
 */

import { fetchPrimaryResume, getAutofillProfile, matchQuestions } from "../api-client"
import { isFillableApplicationForm } from "../detectors/application-form"
import { fillEducationDropdowns, fillRequiredAtsFields } from "./ashby-autofill"
import { withLearnedAnswers } from "./learned-answers"
import { queryAllDeep } from "./shadow-dom"
import { applySafeFills, buildAutofillPreview, type AutofillSource, type ResumeBytes } from "./safe-fields"

/** Tag on the postMessage payload so we never react to unrelated messages. */
const FRAME_AUTOFILL_TAG = "hireoven-apex:run-frame-autofill"

function isTopWindow(): boolean {
  try {
    return window.self === window.top
  } catch {
    // Cross-origin access to window.top throws — that means we ARE framed.
    return false
  }
}

/** Best-effort ATS source from the frame's own URL (drives ATS-specific selectors). */
function guessFrameSource(): AutofillSource {
  const host = window.location.hostname.toLowerCase()
  if (host.includes("greenhouse")) return "greenhouse"
  if (host.includes("lever.co")) return "lever"
  if (host.includes("ashbyhq")) return "ashby"
  if (host.includes("myworkdayjobs") || host.includes("workday")) return "workday"
  if (host.includes("icims")) return "icims"
  if (host.includes("smartrecruiters")) return "smartrecruiters"
  if (host.includes("bamboohr")) return "bamboohr"
  return "generic"
}

/** True when this frame's document exposes a file input (résumé dropzone),
 *  including ones tucked inside shadow roots (SmartRecruiters spl-dropzone). */
function frameHasFileInput(doc: Document): boolean {
  return queryAllDeep<HTMLInputElement>(doc, 'input[type="file"]').length > 0
}

let frameFillInFlight = false

/** Fill THIS frame's document from the saved profile (safe fields + required
 *  questions). Résumé upload is left for manual attach — the file-injection
 *  path is top-frame-only for now. */
async function runHeadlessFrameAutofill(): Promise<void> {
  if (frameFillInFlight) return
  frameFillInFlight = true
  try {
    const { profile } = await getAutofillProfile()
    if (!profile) return
    await withLearnedAnswers(profile) // reuse the user's remembered manual picks
    const source = guessFrameSource()
    // Attach the résumé here too — the top frame can't reach a file input inside
    // a cross-origin iframe, so if we don't fetch + inject it in-frame the CV
    // never gets attached on embedded forms (Greenhouse-on-company-site etc.).
    // Only fetch when this frame actually has a file input, to save a roundtrip.
    let resumeBytes: ResumeBytes | null = null
    if (frameHasFileInput(document)) {
      try {
        resumeBytes = await fetchPrimaryResume()
      } catch {
        // Leave null — applySafeFills marks the field "attach it manually".
      }
    }
    const safeRows = await applySafeFills(source, profile, resumeBytes, document)
    // Education dropdowns (School/Degree/Discipline/dates) from resume_education —
    // safe-fields skips these comboboxes, so drive them here too.
    try {
      await fillEducationDropdowns(profile, document)
    } catch {
      // best-effort — non-fatal when there's no education block
    }
    const summary = await fillRequiredAtsFields({
      profile,
      doc: document,
      // Manual fill (the user clicked Autofill and is here to review) — stay
      // CONSERVATIVE: fill only what the profile/answers ground or the AI is
      // confident about. Do NOT best-effort-guess required yes/no & selects
      // (that's autonomous/queue behavior, and it produced wrong answers like
      // "commute? → Yes" / a reworded gender question → the wrong option).
      autonomous: false,
      matchQuestions: async (questions) => {
        if (questions.length === 0) return []
        try {
          const result = await matchQuestions({ questions, mode: "assist" })
          return result.answers
        } catch {
          return []
        }
      },
    })
    // Report back to the top-frame bar so the results panel reflects what this
    // embedded form actually filled (otherwise the panel shows only the top
    // page and reads "0 filled").
    reportResultToTop({
      source,
      rows: [
        ...safeRows.map((r) => ({
          label: r.label,
          valuePreview: r.valuePreview,
          filled: r.filled,
          skippedReason: r.skippedReason,
        })),
        ...summary.notes.map((n) => ({
          label: n.label,
          valuePreview: n.valuePreview,
          filled: n.filled,
          skippedReason: n.skippedReason,
        })),
      ],
    })
  } catch {
    // best-effort — never throw into the message handler
  } finally {
    frameFillInFlight = false
  }
}

/**
 * Install in EVERY frame (called from content-script bootstrap). A child frame
 * that actually contains a fillable application form runs the fill when the top
 * frame dispatches; the top frame ignores its own dispatch.
 */
export function installFrameAutofillListener(): void {
  if (isTopWindow()) return
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { __hoFrameAutofill?: unknown; mode?: unknown } | null
    if (!data || typeof data !== "object" || data.__hoFrameAutofill !== FRAME_AUTOFILL_TAG) return
    if (!chrome?.runtime?.id) return
    if (!isFillableApplicationForm(document)) return
    // "preview" = detect + list the fields (no writes); otherwise fill.
    if (data.mode === "preview") void runFramePreview()
    else void runHeadlessFrameAutofill()
  })
}

/** Detect (don't fill) this frame's fields and report them to the top-frame
 *  preview panel, so embedded forms show their fields there. */
async function runFramePreview(): Promise<void> {
  try {
    const { profile } = await getAutofillProfile()
    const source = guessFrameSource()
    const rows = buildAutofillPreview(source, profile ?? null, document)
    try {
      window.top?.postMessage(
        {
          __ho: FRAME_PREVIEW_TAG,
          source,
          rows: rows.map((r) => ({
            label: r.label,
            valuePreview: r.valuePreview,
            filled: false,
            skippedReason: r.skippedReason,
          })),
        },
        "*",
      )
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

/**
 * Called from the top-frame bar when the user triggers autofill: hand the fill
 * to every child iframe. Cross-origin frames are the whole point — the injected
 * content script inside a frame with a real form fills it; frames without one
 * ignore the message.
 */
export function dispatchAutofillToChildFrames(root: Document = document): void {
  postToChildFrames(root, "fill")
}

/** Ask child frames to DETECT (not fill) their fields for the preview panel. */
export function dispatchPreviewToChildFrames(root: Document = document): void {
  postToChildFrames(root, "preview")
}

function postToChildFrames(root: Document, mode: "fill" | "preview"): void {
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      frame.contentWindow?.postMessage({ __hoFrameAutofill: FRAME_AUTOFILL_TAG, mode }, "*")
    } catch {
      // contentWindow may be unavailable mid-navigation — ignore.
    }
  }
}

const FRAME_PREVIEW_TAG = "hireoven-apex:frame-preview-result"

/** Top frame: subscribe to the field list detected by child-frame previews. */
export function onFrameAutofillPreview(cb: (result: FrameAutofillResult) => void): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ({ __ho?: unknown } & Partial<FrameAutofillResult>) | null
    if (!data || typeof data !== "object" || data.__ho !== FRAME_PREVIEW_TAG) return
    if (!Array.isArray(data.rows)) return
    cb({ source: String(data.source ?? "generic"), rows: data.rows })
  })
}

// ── Report an embedded-frame fill back to the top-frame results panel ─────────
const FRAME_RESULT_TAG = "hireoven-apex:frame-autofill-result"

export type FrameAutofillRow = {
  label: string
  valuePreview?: string
  filled: boolean
  skippedReason?: string
}
export type FrameAutofillResult = { source: string; rows: FrameAutofillRow[] }

/** From a child frame → post its fill outcome up to the top-frame bar. */
function reportResultToTop(result: FrameAutofillResult): void {
  try {
    window.top?.postMessage({ __ho: FRAME_RESULT_TAG, source: result.source, rows: result.rows }, "*")
  } catch {
    // best-effort
  }
}

/**
 * Top frame: subscribe to results posted back by child-frame fills, so the
 * results panel shows what the embedded form actually filled (instead of "0
 * filled" from the top page alone).
 */
export function onFrameAutofillResults(cb: (result: FrameAutofillResult) => void): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ({ __ho?: unknown } & Partial<FrameAutofillResult>) | null
    if (!data || typeof data !== "object" || data.__ho !== FRAME_RESULT_TAG) return
    if (!Array.isArray(data.rows)) return
    cb({ source: String(data.source ?? "generic"), rows: data.rows })
  })
}
