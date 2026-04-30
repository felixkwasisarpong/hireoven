/**
 * Hireoven Scout Bridge — Content Script
 *
 * Boots the page-aware overlay on supported job sites and proxies
 * messages from background/popup to detection/extraction/fill helpers.
 *
 * Safety: never auto-submit, never auto-fill without explicit user click.
 */

import { detectFormFields } from "./autofill/form-detector"
import { detectPage } from "./detectors/ats"
import { extractJobWithMeta } from "./extractors/job"
import { PageAwareControlSystem } from "./overlay/page-aware-control-system"
import type {
  ContentMessage,
  ContentResponse,
  DetectedPage,
  FillFormFieldsMessage,
} from "./types"

type HireovenContentWindow = Window & {
  __hoContentBootstrapped?: boolean
}

const OVERLAY_HOST_ALLOWLIST: readonly RegExp[] = [
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)glassdoor\.com$/i,
  /(?:^|\.)indeed\.com$/i,
  /(?:^|\.)greenhouse\.io$/i,
  /(?:^|\.)lever\.co$/i,
  /(?:^|\.)ashbyhq\.com$/i,
  /(?:^|\.)myworkdayjobs\.com$/i,
  /(?:^|\.)workday\.com$/i,
  /(?:^|\.)icims\.com$/i,
  /(?:^|\.)smartrecruiters\.com$/i,
  /(?:^|\.)bamboohr\.com$/i,
  /(?:^|\.)welcometothejungle\.com$/i,
  /(?:^|\.)wellfound\.com$/i,
  /(?:^|\.)builtin\.com$/i,
  /(?:^|\.)otta\.com$/i,
  /(?:^|\.)ziprecruiter\.com$/i,
  /(?:^|\.)monster\.com$/i,
]

const CAREER_PATH_PATTERN =
  /\/(?:job|jobs|career|careers|opening|openings|position|positions|vacancy|vacancies|opportunity|opportunities|apply|application)(?:\/|$|\?)/i

function resolveAppOrigin(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["devMode"], (r) => {
      resolve(r.devMode === false ? "https://hireoven.com" : "http://localhost:3000")
    })
  })
}

function isTopFrame(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

function shouldOverlayThisHost(): boolean {
  const host = window.location.hostname.replace(/^www\./i, "").toLowerCase()
  if (OVERLAY_HOST_ALLOWLIST.some((re) => re.test(host))) return true
  if (CAREER_PATH_PATTERN.test(window.location.pathname)) return true
  return false
}

const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set

function normStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

const VALUE_SYNONYM_MAP: Array<[string[], string[]]> = [
  [["male", "man"], ["male", "man", "he him", "mr"]],
  [["female", "woman"], ["female", "woman", "she her", "ms", "mrs"]],
  [["non binary", "nonbinary", "non-binary", "gender non"], ["non binary", "nonbinary", "genderqueer", "they them", "gender non", "agender"]],
  [["prefer not", "decline", "don t wish", "do not wish", "choose not", "no answer", "not wish"], ["prefer not", "decline", "don t wish", "do not wish", "choose not", "not to answer", "no response", "i d rather not", "not disclose"]],
  [["hispanic", "latino", "latina", "latinx"], ["hispanic", "latino", "latina", "latinx", "spanish"]],
  [["white", "caucasian"], ["white", "caucasian"]],
  [["black", "african american"], ["black", "african american", "african-american"]],
  [["asian"], ["asian"]],
  [["american indian", "alaska native", "native american"], ["american indian", "alaska native", "native american", "indigenous"]],
  [["pacific islander", "native hawaiian"], ["pacific islander", "native hawaiian", "pacific"]],
  [["two or more", "multiracial", "biracial", "mixed"], ["two or more", "multiracial", "biracial", "mixed race", "more than one"]],
  [["not a protected veteran", "not a veteran", "not veteran", "i am not"], ["not a protected", "not a veteran", "no veteran", "i am not", "non veteran"]],
  [["protected veteran", "i identify", "i am a veteran", "i identify as"], ["protected veteran", "i identify", "i am a veteran", "veteran who"]],
  [["no disability", "i do not have", "not disabled", "no i do not"], ["no disability", "do not have a disability", "i do not have", "not disabled", "no i do not", "no, i"]],
  [["yes disability", "i have a disability", "yes i have", "i have a"], ["yes i have", "i have a disability", "yes, i", "yes disability", "disabled"]],
]

function findSelectOption(select: HTMLSelectElement, targetValue: string): HTMLOptionElement | null {
  const targetNorm = normStr(targetValue)
  if (!targetNorm) return null

  const opts = Array.from(select.options).filter((o) => o.value !== "" && o.index !== 0)

  for (const opt of opts) {
    if (normStr(opt.value) === targetNorm || normStr(opt.text) === targetNorm) return opt
  }
  for (const opt of opts) {
    const optNorm = normStr(opt.text)
    if (optNorm && (targetNorm.startsWith(optNorm) || optNorm.startsWith(targetNorm))) return opt
  }
  for (const opt of opts) {
    const optNorm = normStr(opt.text)
    if (optNorm && (targetNorm.includes(optNorm) || optNorm.includes(targetNorm))) return opt
  }
  for (const [canonicals, synonyms] of VALUE_SYNONYM_MAP) {
    if (!canonicals.some((c) => targetNorm.includes(normStr(c)))) continue
    for (const opt of opts) {
      const optNorm = normStr(opt.text)
      if (synonyms.some((s) => optNorm.includes(normStr(s)))) return opt
    }
  }
  return null
}

function fillField(elementRef: string, value: string): boolean {
  let el: HTMLElement | null = null
  try {
    el = document.querySelector<HTMLElement>(elementRef)
  } catch {
    return false
  }
  if (!el) return false

  const tag = el.tagName.toLowerCase()
  const type = ((el as HTMLInputElement).type ?? "").toLowerCase()
  if (type === "file" || type === "submit" || type === "hidden") return false

  if (tag === "select") {
    const select = el as HTMLSelectElement
    const option = findSelectOption(select, value)
    if (option) {
      select.value = option.value
      select.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    }
    return false
  }

  if (type === "checkbox" || type === "radio") {
    const check = /^(true|yes|1)$/i.test(value)
    const input = el as HTMLInputElement
    if (input.type === "radio" && input.name) {
      const siblings = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type=\"radio\"][name=\"${input.name}\"]`),
      )
      const targetNorm = normStr(value)
      for (const sibling of siblings) {
        const sibLabel =
          (sibling.id
            ? document.querySelector(`label[for=\"${sibling.id}\"]`)?.textContent?.trim()
            : "") ?? sibling.value
        const sibNorm = normStr(sibLabel)
        if (sibNorm && (sibNorm === targetNorm || targetNorm.includes(sibNorm) || sibNorm.includes(targetNorm))) {
          if (!sibling.checked) {
            sibling.checked = true
            sibling.dispatchEvent(new Event("change", { bubbles: true }))
          }
          return true
        }
      }
    }

    if (input.checked !== check) {
      input.checked = check
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
    return true
  }

  if (tag === "textarea") {
    const ta = el as HTMLTextAreaElement
    nativeTextareaSetter?.call(ta, value)
    ta.dispatchEvent(new Event("input", { bubbles: true }))
    ta.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  const input = el as HTMLInputElement
  nativeInputSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("blur", { bubbles: true }))
  return true
}

function registerMessageBridge(): void {
  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse: (r: ContentResponse) => void) => {
      switch (message.type) {
        case "DETECT_PAGE": {
          const page: DetectedPage = detectPage()
          sendResponse({ type: "PAGE_DETECTED", page })
          break
        }
        case "EXTRACT_JOB": {
          const page = detectPage()
          const { job } = extractJobWithMeta(page.ats)
          sendResponse({ type: "JOB_EXTRACTED", job })
          break
        }
        case "DETECT_FORM_FIELDS": {
          const page = detectPage()
          const result = detectFormFields(message.profile, page.ats)
          sendResponse({
            type: "FORM_FIELDS_DETECTED",
            formFound: result.formFound,
            fields: result.fields,
          })
          break
        }
        case "FILL_FORM_FIELDS": {
          const msg = message as FillFormFieldsMessage
          let filledCount = 0
          let skippedCount = 0
          for (const { elementRef, value } of msg.fields) {
            if (fillField(elementRef, value)) filledCount++
            else skippedCount++
          }
          sendResponse({ type: "FORM_FILLED", filledCount, skippedCount })
          break
        }
        default:
          sendResponse({ type: "ERROR", message: "Unknown message type" })
      }
      return true
    },
  )
}

// Module-level ref so EXECUTE_SCOUT_COMMAND can reach the live overlay instance
let overlayRuntime: PageAwareControlSystem | null = null

async function mountOverlayWhenReady(): Promise<void> {
  if (!isTopFrame()) return
  if (!shouldOverlayThisHost()) return

  if (!document.body) {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        document.removeEventListener("DOMContentLoaded", onReady)
        resolve()
      }
      document.addEventListener("DOMContentLoaded", onReady)
    })
  }

  overlayRuntime = new PageAwareControlSystem({ resolveAppOrigin })
  await overlayRuntime.mount()
}

// ── Receive Scout commands on job site tabs ───────────────────────────────────
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return false
  const msg = message as Record<string, unknown>
  if (msg.type !== "EXECUTE_SCOUT_COMMAND" || !overlayRuntime) return false

  const cmd = msg.command as string
  overlayRuntime.executeAction(cmd)
  sendResponse({ ok: true })
  return true
})

// ── Hireoven dashboard ↔ extension bridge ─────────────────────────────────────
//
// This bridge runs ONLY on hireoven.com / localhost:3000 (the app itself).
// It relays lightweight context between the Scout dashboard page and the
// background service worker using window.postMessage as the page-facing
// protocol and chrome.runtime.sendMessage as the extension-facing protocol.
//
// Protocol (page → extension):
//   window.postMessage({ source: "hireoven-scout", type: "GET_ACTIVE_CONTEXT" })
//
// Protocol (extension → page):
//   window.postMessage({ source: "hireoven-ext", type: "ACTIVE_CONTEXT_RESULT" | "ACTIVE_CONTEXT_PUSH", context })

const SCOUT_SOURCE = "hireoven-scout"
const EXT_SOURCE = "hireoven-ext"

function isHireovenPage(): boolean {
  const host = window.location.hostname.toLowerCase().replace(/^www\./, "")
  return host === "hireoven.com" || host === "localhost"
}

function registerPageBridge(): void {
  if (!isHireovenPage()) return

  // Page → extension: Scout dashboard requests current context
  // ── Page → Extension: Scout dashboard sends requests and commands ────────────
  const SCOUT_RELAY_COMMANDS = new Set(["OPEN_AUTOFILL", "START_TAILOR", "START_COMPARE", "START_WORKFLOW"])

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    if (typeof event.data !== "object" || event.data === null) return
    const msg = event.data as Record<string, unknown>
    if (msg.source !== SCOUT_SOURCE) return

    if (msg.type === "GET_ACTIVE_CONTEXT") {
      // Pull: request stored context from background and echo back as ACTIVE_CONTEXT_CHANGED
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_CONTEXT" }, (response) => {
        if (chrome.runtime.lastError) return
        const ctx = (response as { context?: unknown })?.context ?? null
        window.postMessage(
          { source: EXT_SOURCE, type: "ACTIVE_CONTEXT_CHANGED", context: ctx },
          window.location.origin,
        )
      })
      return
    }

    // Scout UI commands — relay to background which forwards to active job tab
    if (SCOUT_RELAY_COMMANDS.has(msg.type as string)) {
      chrome.runtime.sendMessage({
        type: "RELAY_SCOUT_COMMAND",
        command: msg.type,
        payload: typeof msg.payload === "object" ? msg.payload : {},
      })
    }
  })

  // ── Extension → Page: background pushes context with spec-named events ────────
  // The existing registerMessageBridge() listener catches BROADCAST_CONTEXT in its
  // default case and sends an ERROR response — harmless; the window.postMessage still fires.
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return false
    const msg = message as Record<string, unknown>
    if (msg.type !== "BROADCAST_CONTEXT") return false

    const context = msg.context ?? null
    const events = Array.isArray(msg.events) ? (msg.events as string[]) : ["ACTIVE_CONTEXT_CHANGED"]

    for (const eventType of events) {
      window.postMessage(
        { source: EXT_SOURCE, type: eventType, context },
        window.location.origin,
      )
    }

    sendResponse({ ok: true })
    return true
  })
}

// ─────────────────────────────────────────────────────────────────────────────

function bootstrap(): void {
  const w = window as HireovenContentWindow
  if (w.__hoContentBootstrapped) return
  w.__hoContentBootstrapped = true

  registerMessageBridge()
  registerPageBridge()
  void mountOverlayWhenReady()
}

bootstrap()
