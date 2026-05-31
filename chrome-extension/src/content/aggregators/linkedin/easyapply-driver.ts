/**
 * LinkedIn Easy Apply driver.
 *
 * Walks the modal step-by-step, filling contact / resume / screener pages and
 * stopping at the review step for the user to submit manually. Every step
 * transition gates through the BrowserContextRail (via dispatcher round-trip).
 *
 * Hard rules:
 *   - Never auto-clicks the final "Submit application" button on review.
 *   - Aborts if the modal switches to a "Continue on company site" external
 *     redirect mid-flow.
 */

import type { ScrapedJob } from "../base"

export interface QAEntry {
  question: string
  answer: string
}

export interface LinkedInEasyApplyPrefs {
  email?: string
  phone?: string
  /** Tailored resume bytes — handler/dispatcher fetches this from the user's account. */
  tailoredResumeBlob?: { base64: string; filename: string }
  /** Saved Q&A bank for fuzzy-matched screener answers (similarity > 0.9). */
  qaBank: QAEntry[]
}

export type DriverResult =
  | { kind: "review_ready"; stepsCompleted: number; questionsAnswered: number; resumeUploaded: boolean }
  | { kind: "gate_denied"; step: string; reason?: string }
  | { kind: "aborted_external_redirect" }
  | { kind: "modal_not_found" }
  | { kind: "max_steps_exceeded" }
  | { kind: "error"; message: string }

const MODAL_SELECTOR = ".jobs-easy-apply-modal, [aria-labelledby='jobs-apply-header']"
const MAX_STEPS = 10

type StepKind = "contact" | "resume" | "screeners" | "review" | "redirect" | "unknown"

export async function driveLinkedInEasyApply(
  job: ScrapedJob,
  prefs: LinkedInEasyApplyPrefs,
): Promise<DriverResult> {
  void job
  try {
    const applyBtn = findEasyApplyButton()
    if (!applyBtn) return { kind: "error", message: "Easy Apply button not found" }
    applyBtn.click()

    const modal = await waitForElement(MODAL_SELECTOR, 5000)
    if (!modal) return { kind: "modal_not_found" }

    let stepsCompleted = 0
    let questionsAnswered = 0
    let resumeUploaded = false

    for (let i = 0; i < MAX_STEPS; i++) {
      const currentModal = document.querySelector<HTMLElement>(MODAL_SELECTOR)
      if (!currentModal) return { kind: "modal_not_found" }

      const step = detectStep(currentModal)
      if (step === "redirect") return { kind: "aborted_external_redirect" }
      if (step === "review") {
        return { kind: "review_ready", stepsCompleted, questionsAnswered, resumeUploaded }
      }

      const gate = await gateStep(step, { stepsCompleted })
      if (!gate.approved) return { kind: "gate_denied", step, reason: gate.reason }

      if (step === "contact") fillContactStep(currentModal, prefs)
      else if (step === "resume") {
        const ok = await fillResumeStep(currentModal, prefs)
        resumeUploaded = resumeUploaded || ok
      } else if (step === "screeners") {
        questionsAnswered += await fillScreenerStep(currentModal, prefs)
      }

      const advanced = await clickNextOrReview(currentModal)
      if (!advanced) {
        // Couldn't advance — surface as max steps for now; user can take over.
        return { kind: "max_steps_exceeded" }
      }
      stepsCompleted++
      // Brief pause for the next step's DOM to render before re-detecting.
      await sleep(400)
    }

    return { kind: "max_steps_exceeded" }
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

// ── Step machine helpers ─────────────────────────────────────────────────────

function findEasyApplyButton(): HTMLButtonElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".jobs-apply-button, button.jobs-apply-button"),
  )
  for (const btn of candidates) {
    const txt = (btn.textContent ?? "").trim().toLowerCase()
    if (txt.includes("easy apply")) return btn
  }
  return candidates[0] ?? null
}

function detectStep(modalRoot: HTMLElement): StepKind {
  const text = (modalRoot.innerText ?? "").toLowerCase()

  const continueExternal = Array.from(modalRoot.querySelectorAll<HTMLElement>("button, a")).find((el) =>
    /continue\s+on\s+(company|employer)/i.test(el.textContent ?? ""),
  )
  if (continueExternal) return "redirect"

  if (modalRoot.querySelector("button[aria-label*='Submit application' i]")) return "review"
  if (/review your application|review the highlighted/i.test(text)) return "review"

  if (
    modalRoot.querySelector("input[type='file']") ||
    /upload resume|select a resume|choose a resume/i.test(text)
  ) {
    return "resume"
  }

  if (
    modalRoot.querySelector("textarea") ||
    modalRoot.querySelector("input[type='radio']") ||
    modalRoot.querySelectorAll("select").length > 1
  ) {
    return "screeners"
  }

  if (/phone number|email address|mobile phone|country code/i.test(text)) {
    return "contact"
  }

  return "unknown"
}

function fillContactStep(modalRoot: HTMLElement, prefs: LinkedInEasyApplyPrefs): void {
  if (prefs.email) {
    const emailSelect = findFieldByLabel(modalRoot, /email/i, "select") as HTMLSelectElement | null
    if (emailSelect) {
      const opt = Array.from(emailSelect.options).find((o) => o.text.toLowerCase().includes(prefs.email!.toLowerCase()))
      if (opt) {
        emailSelect.value = opt.value
        emailSelect.dispatchEvent(new Event("change", { bubbles: true }))
      }
    }
  }
  if (prefs.phone) {
    const phoneInput = findFieldByLabel(modalRoot, /phone|mobile/i, "input") as HTMLInputElement | null
    if (phoneInput) {
      setNativeValue(phoneInput, prefs.phone)
    }
  }
}

async function fillResumeStep(_modalRoot: HTMLElement, prefs: LinkedInEasyApplyPrefs): Promise<boolean> {
  if (!prefs.tailoredResumeBlob) return false
  const fileInput = document.querySelector<HTMLInputElement>("input[type='file']")
  if (!fileInput) return false

  try {
    const binary = atob(prefs.tailoredResumeBlob.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const mime = prefs.tailoredResumeBlob.filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const file = new File([bytes], prefs.tailoredResumeBlob.filename, { type: mime, lastModified: Date.now() })
    const dt = new DataTransfer()
    dt.items.add(file)
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event("input", { bubbles: true }))
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  } catch {
    return false
  }
}

async function fillScreenerStep(modalRoot: HTMLElement, prefs: LinkedInEasyApplyPrefs): Promise<number> {
  const groups = collectScreenerGroups(modalRoot)
  let answered = 0
  for (const group of groups) {
    const matched = matchAnswer(group.question, prefs.qaBank)
    let answer = matched
    if (!answer) {
      answer = await askForAnswer(group.question)
    }
    if (!answer) continue
    if (applyAnswer(group, answer)) answered++
  }
  return answered
}

interface ScreenerGroup {
  question: string
  inputs: HTMLElement[]
}

function collectScreenerGroups(modalRoot: HTMLElement): ScreenerGroup[] {
  // LinkedIn wraps each Q&A in a fieldset/group container with a label.
  const wrappers = Array.from(
    modalRoot.querySelectorAll<HTMLElement>(
      "[data-test-form-element], fieldset.fb-form-element, div.jobs-easy-apply-form-element",
    ),
  )
  if (wrappers.length === 0) return []
  const groups: ScreenerGroup[] = []
  for (const wrapper of wrappers) {
    const label = wrapper.querySelector("label, legend")?.textContent?.trim() ?? ""
    if (!label) continue
    const inputs = Array.from(
      wrapper.querySelectorAll<HTMLElement>("input, textarea, select"),
    ).filter((el) => {
      const type = (el as HTMLInputElement).type
      return type !== "hidden" && type !== "submit" && type !== "button"
    })
    if (inputs.length === 0) continue
    groups.push({ question: label, inputs })
  }
  return groups
}

function applyAnswer(group: ScreenerGroup, answer: string): boolean {
  const first = group.inputs[0]
  if (!first) return false

  if (first instanceof HTMLSelectElement) {
    const opt = Array.from(first.options).find(
      (o) => o.text.trim().toLowerCase() === answer.trim().toLowerCase(),
    )
    if (!opt) return false
    first.value = opt.value
    first.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  if (first instanceof HTMLInputElement && (first.type === "radio" || first.type === "checkbox")) {
    const target = group.inputs.find((el) => {
      if (!(el instanceof HTMLInputElement)) return false
      const labelText =
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ?? el.value
      return labelText?.trim().toLowerCase() === answer.trim().toLowerCase()
    }) as HTMLInputElement | undefined
    if (!target) return false
    target.checked = true
    target.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
    setNativeValue(first, answer)
    return true
  }

  return false
}

async function clickNextOrReview(modalRoot: HTMLElement): Promise<boolean> {
  const buttons = Array.from(modalRoot.querySelectorAll<HTMLButtonElement>("button"))
  const next = buttons.find((b) => /continue to next step|next/i.test(b.textContent ?? ""))
  const review = buttons.find((b) => /review( your application)?$/i.test((b.textContent ?? "").trim()))
  const target = next ?? review
  if (!target) return false
  if (target.disabled) return false
  target.click()
  return true
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function matchAnswer(question: string, qaBank: QAEntry[]): string | null {
  for (const entry of qaBank) {
    if (jaccardSimilarity(question, entry.question) > 0.9) return entry.answer
  }
  return null
}

function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((tok) => tok.length > 1))
  const A = tokenize(a)
  const B = tokenize(b)
  if (A.size === 0 || B.size === 0) return 0
  let intersect = 0
  for (const token of A) if (B.has(token)) intersect++
  const unionSize = A.size + B.size - intersect
  return unionSize === 0 ? 0 : intersect / unionSize
}

// ── Dispatcher round-trips ────────────────────────────────────────────────────

async function gateStep(stepName: string, payload: Record<string, unknown>): Promise<{ approved: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ approved: false, reason: "gate_timeout" }), 60000)
    if (!chrome.runtime?.id) {
      clearTimeout(timer)
      resolve({ approved: false, reason: "no_runtime" })
      return
    }
    chrome.runtime.sendMessage({ type: "APEX_GATE_STEP", driver: "linkedin", stepName, ...payload }, (response) => {
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

async function askForAnswer(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 60000)
    if (!chrome.runtime?.id) {
      clearTimeout(timer)
      resolve(null)
      return
    }
    chrome.runtime.sendMessage({ type: "APEX_NEEDS_ANSWER", driver: "linkedin", question }, (response) => {
      clearTimeout(timer)
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      const data = response as { answer?: string | null } | undefined
      resolve(data?.answer ?? null)
    })
  })
}

// ── DOM utilities ────────────────────────────────────────────────────────────

function findFieldByLabel(root: HTMLElement, pattern: RegExp, tag: "input" | "select"): HTMLElement | null {
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>("label"))
  for (const label of labels) {
    if (!pattern.test(label.textContent ?? "")) continue
    const forId = label.htmlFor
    if (forId) {
      const el = document.getElementById(forId)
      if (el && el.tagName.toLowerCase() === tag) return el
    }
    const nested = label.querySelector(tag)
    if (nested) return nested as HTMLElement
  }
  return null
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = el instanceof HTMLTextAreaElement ? nativeTextareaValueSetter : nativeInputValueSetter
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

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
