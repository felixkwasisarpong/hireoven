/**
 * Learned answers — auto-remember what the USER personally picks on a form, so
 * the next form that asks the same thing reuses THEIR answer instead of a
 * heuristic/AI guess.
 *
 * Capture: a document-level `change` listener gated on `event.isTrusted` — the
 * extension's own fills dispatch UNTRUSTED events (setReactValue / .click()), so
 * only genuine user edits are recorded. Auto-saved to chrome.storage.local
 * (per-device), keyed by the normalized question label.
 *
 * Reuse: surfaced as `custom_answers` (the same top-priority slot the dashboard
 * "Common questions" use), so the deterministic tier applies them before any
 * heuristic. Explicit dashboard answers still win (they're merged first).
 *
 * Scope (MVP): native radio / select / textarea / text controls (covers
 * Greenhouse-style forms). Custom widgets (spl-*, react-select, Ashby buttons)
 * don't fire native `change` with a committed value — a follow-up.
 */

const STORAGE_KEY = "hoLearnedAnswers"
const MAX_ENTRIES = 500

type LearnedEntry = { label: string; answer: string; updatedAt: number }
type LearnedStore = Record<string, LearnedEntry>
export type LearnedCustomAnswer = { question_pattern: string; answer: string }

// Labels already covered by the structured profile — no point re-learning PII.
const PROFILE_FIELD_LABEL_RE =
  /\b(first name|last name|full name|^name$|email|phone|mobile|linkedin|github|portfolio|website|street|address|^city$|state|province|zip|postal|country)\b/i

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200)
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").replace(/[*✱• ]+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function storageArea(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.local ?? null
  } catch {
    return null
  }
}

function readStore(): Promise<LearnedStore> {
  const area = storageArea()
  if (!area) return Promise.resolve({})
  return new Promise((resolve) => {
    try {
      area.get(STORAGE_KEY, (res) => {
        if (chrome.runtime?.lastError) return resolve({})
        resolve((res?.[STORAGE_KEY] as LearnedStore) ?? {})
      })
    } catch {
      resolve({})
    }
  })
}

async function writeEntry(key: string, entry: LearnedEntry): Promise<void> {
  const area = storageArea()
  if (!area) return
  const store = await readStore()
  store[key] = entry
  // Bound growth: drop the oldest when over the cap.
  const keys = Object.keys(store)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (store[a].updatedAt ?? 0) - (store[b].updatedAt ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k])
  }
  try {
    area.set({ [STORAGE_KEY]: store })
  } catch {
    // best-effort
  }
}

// ── Label / value derivation ──────────────────────────────────────────────────

const ROW_SELECTOR =
  "fieldset,[class*='fieldEntry' i],[class*='field-entry' i],[class*='application-question' i],[class*='question' i],[role='group'],.field,.form-group"

/** Text of a label-ish element, but only when it does NOT wrap a form control
 *  (so we get the QUESTION, not an option like "Yes"/"Male"). */
function questionLabelText(el: Element): string {
  if (el.querySelector("input,select,textarea")) return ""
  return cleanText(el.textContent)
}

/** Human question label for the control the user just edited. */
function deriveQuestionLabel(control: HTMLElement): string {
  const doc = control.ownerDocument
  // 1. Associated <label for=id> (skip if it's the option's own label).
  const id = control.id
  if (id) {
    const lbl = doc.querySelector<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`)
    const txt = cleanText(lbl?.textContent)
    // For radios/checkboxes the for-label is the OPTION text — not the question.
    const isChoice = control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")
    if (txt && !isChoice) return txt
  }
  // 2. Climb to the question row and take the first non-wrapping label/legend/heading.
  const row = control.closest<HTMLElement>(ROW_SELECTOR)
  if (row) {
    const candidates = row.querySelectorAll<HTMLElement>(
      "legend,label,[class*='label' i],[class*='heading' i],[class*='title' i],[class*='question' i]",
    )
    for (const c of candidates) {
      const txt = questionLabelText(c)
      if (txt && txt.length <= 200) return txt
    }
  }
  // 3. Fallbacks.
  const aria = control.getAttribute("aria-label")
  if (cleanText(aria)) return cleanText(aria)
  return cleanText(control.getAttribute("name") ?? id ?? "")
}

/** The value the user chose, in a form the fill layer can re-apply. */
function deriveAnswer(control: HTMLElement): string {
  if (control instanceof HTMLSelectElement) {
    const opt = control.options[control.selectedIndex]
    const text = cleanText(opt?.textContent || opt?.value)
    return /^(select|choose|--|\s*)$/i.test(text) ? "" : text
  }
  if (control instanceof HTMLInputElement) {
    if (control.type === "radio") {
      // The chosen option in the group → its visible option label.
      const chosen = control.checked ? control : null
      if (!chosen) return ""
      return optionLabelOf(chosen)
    }
    if (control.type === "checkbox") {
      return control.checked ? optionLabelOf(control) || "Yes" : ""
    }
    return cleanText(control.value)
  }
  if (control instanceof HTMLTextAreaElement) return cleanText(control.value)
  return ""
}

function optionLabelOf(input: HTMLInputElement): string {
  const id = input.id
  if (id) {
    const lbl = input.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`)
    if (cleanText(lbl?.textContent)) return cleanText(lbl?.textContent)
  }
  const wrap = input.closest("label")
  if (cleanText(wrap?.textContent)) return cleanText(wrap?.textContent)
  return cleanText(input.getAttribute("aria-label") ?? input.value)
}

function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  return typeof fn === "function" ? fn(value) : value.replace(/["\\]/g, "\\$&")
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Install the user-edit capture listener. Runs in EVERY frame (so it also
 *  learns inside embedded ATS iframes). Idempotent per document. */
export function installLearnedAnswerCapture(doc: Document = document): void {
  const w = doc.defaultView as (Window & { __hoLearnCaptureInstalled?: boolean }) | null
  if (!w || w.__hoLearnCaptureInstalled) return
  w.__hoLearnCaptureInstalled = true

  doc.addEventListener(
    "change",
    (event) => {
      if (!event.isTrusted) return // ignore the extension's own programmatic fills
      void recordUserEdit(event.target)
    },
    true, // capture — fires even if the widget stops propagation
  )
}

/**
 * Derive + persist the question/answer for a control the user just edited.
 * Exported (sans the isTrusted gate) so it's unit-testable — jsdom can't
 * synthesize a trusted event. Returns the stored entry, or null if skipped.
 */
export async function recordUserEdit(target: EventTarget | null): Promise<LearnedEntry | null> {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return null
  }
  if (target instanceof HTMLInputElement && /^(file|hidden|submit|button|reset|password)$/.test(target.type)) {
    return null
  }

  const label = deriveQuestionLabel(target)
  const answer = deriveAnswer(target)
  if (!label || !answer) return null
  if (PROFILE_FIELD_LABEL_RE.test(label)) return null // profile already covers these
  if (answer.length > 400) return null

  const entry: LearnedEntry = { label, answer, updatedAt: nowMs() }
  await writeEntry(normalizeKey(label), entry)
  return entry
}

function nowMs(): number {
  try {
    return Date.now()
  } catch {
    return 0
  }
}

/** Learned answers shaped as `custom_answers` for the deterministic fill tier. */
export async function getLearnedCustomAnswers(): Promise<LearnedCustomAnswer[]> {
  const store = await readStore()
  return Object.values(store)
    .filter((e) => e?.label && e?.answer)
    .map((e) => ({ question_pattern: escapeRegExp(e.label), answer: e.answer }))
}

/** Merge learned answers into a profile's custom_answers (explicit dashboard
 *  answers keep priority — they're listed first). Returns the same profile. */
export async function withLearnedAnswers<T extends { custom_answers?: LearnedCustomAnswer[] | null }>(
  profile: T,
): Promise<T> {
  try {
    const learned = await getLearnedCustomAnswers()
    if (learned.length > 0) {
      profile.custom_answers = [...(profile.custom_answers ?? []), ...learned]
    }
  } catch {
    // best-effort — never block a fill on the learned store
  }
  return profile
}
