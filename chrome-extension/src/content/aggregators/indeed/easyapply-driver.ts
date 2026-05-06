/**
 * Indeed Apply driver.
 *
 * Walks the Indeed Apply modal: contact → resume → screeners → review.
 * Hard rules:
 *   - Never auto-clicks the final submit button on review.
 *   - BEFORE filling screeners, scans for hard-disqualifier yes/no questions and
 *     pauses for user decision (SCOUT_DISQUALIFY_WARNING) when a saved answer
 *     would end the flow.
 *   - Never polls Indeed; never re-fetches from background. Indeed rate-limits
 *     aggressively, so all DOM observation is event-driven.
 */

import type { ScrapedJob } from "../base"

export interface IndeedQAEntry {
  question: string
  answer: string
  /** When true, this answer is one we know would disqualify the candidate. */
  knownDisqualifier?: boolean
}

export interface IndeedApplyPrefs {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  tailoredResumeBlob?: { base64: string; filename: string }
  qaBank: IndeedQAEntry[]
}

export type IndeedDriverResult =
  | { kind: "review_ready"; stepsCompleted: number; questionsAnswered: number; resumeUploaded: boolean }
  | { kind: "gate_denied"; step: string; reason?: string }
  | { kind: "disqualified_user_aborted"; question: string }
  | { kind: "modal_not_found" }
  | { kind: "max_steps_exceeded" }
  | { kind: "error"; message: string }

const MODAL_SELECTOR =
  "[data-testid='IndeedApply-Modal'], [aria-label='Indeed Apply'], #ia-container, .ia-Modal"
const MAX_STEPS = 10

type StepKind = "contact" | "resume" | "screeners" | "review" | "unknown"

export async function driveIndeedApply(
  job: ScrapedJob,
  prefs: IndeedApplyPrefs,
): Promise<IndeedDriverResult> {
  void job
  try {
    const applyBtn = findApplyButton()
    if (!applyBtn) return { kind: "error", message: "Indeed Apply button not found" }
    applyBtn.click()

    const modal = await waitForElement(MODAL_SELECTOR, 6000)
    if (!modal) return { kind: "modal_not_found" }

    let stepsCompleted = 0
    let questionsAnswered = 0
    let resumeUploaded = false

    for (let i = 0; i < MAX_STEPS; i++) {
      const currentModal = document.querySelector<HTMLElement>(MODAL_SELECTOR)
      if (!currentModal) return { kind: "modal_not_found" }

      const step = detectStep(currentModal)
      if (step === "review") {
        return { kind: "review_ready", stepsCompleted, questionsAnswered, resumeUploaded }
      }

      const gate = await gateStep(step, { stepsCompleted })
      if (!gate.approved) return { kind: "gate_denied", step, reason: gate.reason }

      if (step === "contact") {
        fillContactStep(currentModal, prefs)
      } else if (step === "resume") {
        const ok = await fillResumeStep(prefs)
        resumeUploaded = resumeUploaded || ok
      } else if (step === "screeners") {
        const groups = collectScreenerGroups(currentModal)
        // Disqualifier scan FIRST.
        for (const group of groups) {
          const dq = scanDisqualifier(group, prefs.qaBank)
          if (dq) {
            const ok = await disqualifyWarning(group.question, dq.answer)
            if (!ok) return { kind: "disqualified_user_aborted", question: group.question }
          }
        }
        for (const group of groups) {
          const matched = matchAnswer(group.question, prefs.qaBank)
          let answer = matched
          if (!answer) answer = await askForAnswer(group.question)
          if (!answer) continue
          if (applyAnswer(group, answer)) questionsAnswered++
        }
      }

      const advanced = await clickNextOrReview(currentModal)
      if (!advanced) return { kind: "max_steps_exceeded" }
      stepsCompleted++
      await sleep(400)
    }

    return { kind: "max_steps_exceeded" }
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

// ── Step detection ────────────────────────────────────────────────────────────

function findApplyButton(): HTMLButtonElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "[data-testid='indeedApplyButton'], button.indeedApplyButton, button[buttonid*='indeedApply' i]",
    ),
  )
  return candidates[0] ?? null
}

function detectStep(modalRoot: HTMLElement): StepKind {
  const text = (modalRoot.innerText ?? "").toLowerCase()

  if (
    /review your application|review the highlighted/i.test(text) ||
    modalRoot.querySelector("button[data-testid*='review' i]")
  ) {
    return "review"
  }

  if (modalRoot.querySelector("input[type='file']") || /upload resume|attach resume|choose file/i.test(text)) {
    return "resume"
  }

  if (
    modalRoot.querySelector("textarea") ||
    modalRoot.querySelector("input[type='radio']") ||
    /screener|additional questions|please answer/i.test(text)
  ) {
    return "screeners"
  }

  if (/full name|first name|email|phone/i.test(text)) {
    return "contact"
  }

  return "unknown"
}

function fillContactStep(modalRoot: HTMLElement, prefs: IndeedApplyPrefs): void {
  if (prefs.firstName) {
    const el = findFieldByLabel(modalRoot, /first\s*name/i, "input") as HTMLInputElement | null
    if (el) setNativeValue(el, prefs.firstName)
  }
  if (prefs.lastName) {
    const el = findFieldByLabel(modalRoot, /last\s*name/i, "input") as HTMLInputElement | null
    if (el) setNativeValue(el, prefs.lastName)
  }
  if (prefs.email) {
    const el = findFieldByLabel(modalRoot, /email/i, "input") as HTMLInputElement | null
    if (el) setNativeValue(el, prefs.email)
  }
  if (prefs.phone) {
    const el = findFieldByLabel(modalRoot, /phone|mobile/i, "input") as HTMLInputElement | null
    if (el) setNativeValue(el, prefs.phone)
  }
}

async function fillResumeStep(prefs: IndeedApplyPrefs): Promise<boolean> {
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

interface ScreenerGroup {
  question: string
  inputs: HTMLElement[]
  /** Pre-extracted yes/no labels when the group is a binary radio set. */
  yesNoOptions: { yes?: HTMLInputElement; no?: HTMLInputElement } | null
}

function collectScreenerGroups(modalRoot: HTMLElement): ScreenerGroup[] {
  const wrappers = Array.from(
    modalRoot.querySelectorAll<HTMLElement>(
      "fieldset, [data-testid*='screener' i], [data-testid*='question' i], div.ia-Questions-item",
    ),
  )
  const groups: ScreenerGroup[] = []
  for (const wrapper of wrappers) {
    const labelEl = wrapper.querySelector("legend, label, [class*='question' i]")
    const question = labelEl?.textContent?.trim() ?? ""
    if (!question) continue
    const inputs = Array.from(wrapper.querySelectorAll<HTMLElement>("input, textarea, select")).filter((el) => {
      const type = (el as HTMLInputElement).type
      return type !== "hidden" && type !== "submit" && type !== "button"
    })
    if (inputs.length === 0) continue
    groups.push({ question, inputs, yesNoOptions: extractYesNoRadios(inputs) })
  }
  return groups
}

function extractYesNoRadios(inputs: HTMLElement[]): ScreenerGroup["yesNoOptions"] {
  const radios = inputs.filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "radio",
  )
  if (radios.length !== 2) return null
  const labelOf = (el: HTMLInputElement) =>
    (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ?? el.value
  const a = (labelOf(radios[0]) ?? "").trim().toLowerCase()
  const b = (labelOf(radios[1]) ?? "").trim().toLowerCase()
  if (!/^(yes|no)$/.test(a) || !/^(yes|no)$/.test(b)) return null
  return {
    yes: a === "yes" ? radios[0] : radios[1],
    no: a === "no" ? radios[0] : radios[1],
  }
}

/**
 * If the saved answer to a binary question is one the user has flagged as a
 * known disqualifier, surface a warning before continuing. Returns the saved
 * answer that triggered the warning.
 */
function scanDisqualifier(group: ScreenerGroup, qaBank: IndeedQAEntry[]): { answer: string } | null {
  if (!group.yesNoOptions) return null
  const matched = qaBank.find(
    (q) => jaccardSimilarity(q.question, group.question) > 0.9 && q.knownDisqualifier === true,
  )
  if (!matched) return null
  return { answer: matched.answer }
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
  const next = buttons.find((b) => /continue|next/i.test(b.textContent ?? ""))
  const review = buttons.find((b) => /review( your application)?$/i.test((b.textContent ?? "").trim()))
  const target = next ?? review
  if (!target || target.disabled) return false
  target.click()
  return true
}

// ── Fuzzy match ──────────────────────────────────────────────────────────────

function matchAnswer(question: string, qaBank: IndeedQAEntry[]): string | null {
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
    chrome.runtime.sendMessage({ type: "SCOUT_GATE_STEP", driver: "indeed", stepName, ...payload }, (response) => {
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
    chrome.runtime.sendMessage({ type: "SCOUT_NEEDS_ANSWER", driver: "indeed", question }, (response) => {
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

/** Returns true if the user wants to continue past a known disqualifier; false to abort. */
async function disqualifyWarning(question: string, savedAnswer: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 60000)
    if (!chrome.runtime?.id) {
      clearTimeout(timer)
      resolve(false)
      return
    }
    chrome.runtime.sendMessage(
      { type: "SCOUT_DISQUALIFY_WARNING", driver: "indeed", question, savedAnswer },
      (response) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          resolve(false)
          return
        }
        const data = response as { proceed?: boolean } | undefined
        resolve(!!data?.proceed)
      },
    )
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
