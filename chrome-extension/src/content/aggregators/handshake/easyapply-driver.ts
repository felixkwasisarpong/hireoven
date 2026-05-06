/**
 * Handshake apply driver.
 *
 * Steps: document selection → cover letter → submit.
 * Hard rules:
 *   - Never auto-clicks the final submit button.
 *   - If the resume upload field is disabled (school-locked profile), surfaces
 *     SCOUT_LOCKED_RESUME and waits for user acknowledgement before continuing.
 *   - Transcript attachment is opportunistic: only when both a transcript blob
 *     is supplied AND the form exposes a transcript field.
 */

import type { ScrapedJob } from "../base"

export interface HandshakeApplyPrefs {
  tailoredResumeBlob?: { base64: string; filename: string }
  generatedCoverLetterBlob?: { base64: string; filename: string }
  transcriptBlob?: { base64: string; filename: string }
}

export type HandshakeDriverResult =
  | { kind: "review_ready"; resumeUploaded: boolean; coverLetterAttached: boolean; transcriptAttached: boolean }
  | { kind: "gate_denied"; step: string; reason?: string }
  | { kind: "locked_resume_user_aborted" }
  | { kind: "modal_not_found" }
  | { kind: "max_steps_exceeded" }
  | { kind: "error"; message: string }

const MODAL_SELECTOR =
  "[data-hook='application-modal'], [aria-label*='Apply' i][role='dialog'], [data-test='application-modal']"
const MAX_STEPS = 6

type StepKind = "documents" | "cover_letter" | "submit" | "unknown"

export async function driveHandshakeApply(
  job: ScrapedJob,
  prefs: HandshakeApplyPrefs,
): Promise<HandshakeDriverResult> {
  void job
  try {
    const applyBtn = findApplyButton()
    if (!applyBtn) return { kind: "error", message: "Handshake Apply button not found" }
    applyBtn.click()

    const modal = await waitForElement(MODAL_SELECTOR, 6000)
    if (!modal) return { kind: "modal_not_found" }

    let resumeUploaded = false
    let coverLetterAttached = false
    let transcriptAttached = false

    for (let i = 0; i < MAX_STEPS; i++) {
      const currentModal = document.querySelector<HTMLElement>(MODAL_SELECTOR)
      if (!currentModal) return { kind: "modal_not_found" }

      const step = detectStep(currentModal)
      if (step === "submit") {
        return {
          kind: "review_ready",
          resumeUploaded,
          coverLetterAttached,
          transcriptAttached,
        }
      }

      const gate = await gateStep(step)
      if (!gate.approved) return { kind: "gate_denied", step, reason: gate.reason }

      if (step === "documents") {
        const resumeInput = findFileInput(currentModal, /resume/i)
        if (resumeInput) {
          if (resumeInput.disabled || resumeInput.getAttribute("aria-disabled") === "true") {
            const proceed = await lockedResumeWarning()
            if (!proceed) return { kind: "locked_resume_user_aborted" }
          } else if (prefs.tailoredResumeBlob) {
            resumeUploaded = injectFile(resumeInput, prefs.tailoredResumeBlob) || resumeUploaded
          }
        }
        if (prefs.transcriptBlob) {
          const transcriptInput = findFileInput(currentModal, /transcript/i)
          if (transcriptInput && !transcriptInput.disabled) {
            transcriptAttached = injectFile(transcriptInput, prefs.transcriptBlob) || transcriptAttached
          }
        }
      } else if (step === "cover_letter") {
        if (prefs.generatedCoverLetterBlob) {
          const clInput = findFileInput(currentModal, /cover|letter/i)
          if (clInput && !clInput.disabled) {
            coverLetterAttached = injectFile(clInput, prefs.generatedCoverLetterBlob) || coverLetterAttached
          }
        }
      }

      const advanced = await clickNextOrSubmit(currentModal)
      if (!advanced) return { kind: "max_steps_exceeded" }
      await sleep(400)
    }
    return { kind: "max_steps_exceeded" }
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

// ── Step detection ────────────────────────────────────────────────────────────

function findApplyButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button, a"))
  for (const btn of buttons) {
    const txt = (btn.textContent ?? "").trim().toLowerCase()
    if (txt === "apply" || txt === "apply now") return btn as HTMLButtonElement
  }
  return null
}

function detectStep(modalRoot: HTMLElement): StepKind {
  const text = (modalRoot.innerText ?? "").toLowerCase()
  if (modalRoot.querySelector("button[data-hook*='submit' i], button[type='submit']")) {
    if (/submit application|review and submit/i.test(text)) return "submit"
  }
  if (/cover letter/.test(text) && !/optional/.test(text.slice(0, 80))) {
    return "cover_letter"
  }
  if (modalRoot.querySelector("input[type='file']") || /select (resume|document)|upload/i.test(text)) {
    return "documents"
  }
  if (/submit application|review and submit/i.test(text)) return "submit"
  return "unknown"
}

function findFileInput(modalRoot: HTMLElement, labelPattern: RegExp): HTMLInputElement | null {
  const fields = Array.from(
    modalRoot.querySelectorAll<HTMLInputElement>("input[type='file']"),
  )
  for (const input of fields) {
    const label =
      (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null) ??
      input.closest("label")?.textContent ??
      input.getAttribute("aria-label") ??
      input.name
    if (label && labelPattern.test(label)) return input
  }
  return fields[0] ?? null
}

function injectFile(input: HTMLInputElement, blob: { base64: string; filename: string }): boolean {
  try {
    const binary = atob(blob.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const mime = blob.filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const file = new File([bytes], blob.filename, { type: mime, lastModified: Date.now() })
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  } catch {
    return false
  }
}

async function clickNextOrSubmit(modalRoot: HTMLElement): Promise<boolean> {
  // Important: we EXCLUDE the final submit. clickNextOrSubmit only clicks
  // forward-progress buttons; the submit step is detected before this is
  // called and we return review_ready instead.
  const buttons = Array.from(modalRoot.querySelectorAll<HTMLButtonElement>("button"))
  const next = buttons.find((b) => /continue|next|review/i.test(b.textContent ?? ""))
  if (!next || next.disabled) return false
  next.click()
  return true
}

// ── Dispatcher round-trips ────────────────────────────────────────────────────

async function gateStep(stepName: string): Promise<{ approved: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ approved: false, reason: "gate_timeout" }), 60000)
    if (!chrome.runtime?.id) {
      clearTimeout(timer)
      resolve({ approved: false, reason: "no_runtime" })
      return
    }
    chrome.runtime.sendMessage({ type: "SCOUT_GATE_STEP", driver: "handshake", stepName }, (response) => {
      clearTimeout(timer)
      if (chrome.runtime.lastError) {
        resolve({ approved: false, reason: chrome.runtime.lastError.message })
        return
      }
      const data = response as { approved?: boolean; reason?: string } | undefined
      resolve({ approved: !!data?.approved, reason: data?.reason })
    })
  })
}

async function lockedResumeWarning(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 60000)
    if (!chrome.runtime?.id) {
      clearTimeout(timer)
      resolve(false)
      return
    }
    chrome.runtime.sendMessage({ type: "SCOUT_LOCKED_RESUME", driver: "handshake" }, (response) => {
      clearTimeout(timer)
      if (chrome.runtime.lastError) {
        resolve(false)
        return
      }
      const data = response as { proceed?: boolean } | undefined
      resolve(!!data?.proceed)
    })
  })
}

// ── DOM utilities ────────────────────────────────────────────────────────────

function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const found = document.querySelector<HTMLElement>(selector)
    if (found) {
      resolve(found)
      return
    }
    const start = Date.now()
    const id = setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) {
        clearInterval(id)
        resolve(el)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id)
        resolve(null)
      }
    }, 200)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
