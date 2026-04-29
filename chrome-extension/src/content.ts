/**
 * Hireoven Scout Bridge - Content Script
 *
 * Page-aware in-page controls for job and application pages.
 * This injects the floating Hireoven action bar + drawers and also keeps
 * the message bridge used by popup/background for detection/extraction/filling.
 *
 * Safety:
 * - Never auto-submit
 * - Never auto-fill without explicit user click
 */

import { detectFormFields } from "./autofill/form-detector"
import { detectPage, looksLikeLikelyJobPage } from "./detectors/ats"
import { extractJobWithMeta } from "./extractors/job"
import { PageAwareControlSystem } from "./overlay/page-aware-control-system"
import type {
  ContentMessage,
  ContentResponse,
  DetectedPage,
  FillFormFieldsMessage,
} from "./types"

let overlaySystem: PageAwareControlSystem | null = null
let overlayInitInFlight = false

function resolveAppOrigin(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["devMode"], (r) => {
      resolve(r.devMode === false ? "https://hireoven.com" : "http://localhost:3000")
    })
  })
}

function overlayCandidateHost(): boolean {
  const h = window.location.hostname.replace(/^www\./, "").toLowerCase()
  if (h.includes("linkedin.com")) return true
  if (h.includes("glassdoor.com")) return true
  if (h.includes("greenhouse.io")) return true
  if (h.includes("lever.co")) return true
  if (h.includes("ashbyhq.com")) return true
  if (h.includes("myworkdayjobs.com")) return true
  if (h.includes("icims.com")) return true
  if (h.includes("smartrecruiters.com")) return true
  if (h.includes("bamboohr.com")) return true
  return false
}

function shouldRunOverlay(): boolean {
  const page = detectPage()
  if (page.pageType === "job_listing" || page.pageType === "application_form") return true
  if (overlayCandidateHost() && looksLikeLikelyJobPage(window.location.href)) return true
  if (overlayCandidateHost() && /\/jobs\//i.test(window.location.pathname)) return true
  return false
}

async function ensureOverlay(): Promise<void> {
  if (overlaySystem || overlayInitInFlight) return
  if (!shouldRunOverlay()) return

  overlayInitInFlight = true
  try {
    const runtime = new PageAwareControlSystem({ resolveAppOrigin })
    await runtime.mount()
    overlaySystem = runtime
  } catch {
    overlaySystem = null
  } finally {
    overlayInitInFlight = false
  }
}

function reconcileOverlayLifecycle(): void {
  if (shouldRunOverlay()) {
    void ensureOverlay()
    return
  }
  if (overlaySystem) {
    overlaySystem.destroy()
    overlaySystem = null
  }
}

function wireHistoryHooks(): void {
  const w = window as Window & { __hoScoutOverlayHooks?: boolean }
  if (w.__hoScoutOverlayHooks) return
  w.__hoScoutOverlayHooks = true

  const onNav = () => window.setTimeout(() => reconcileOverlayLifecycle(), 80)

  const push = history.pushState.bind(history)
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    push(...args)
    onNav()
  }

  const replace = history.replaceState.bind(history)
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    replace(...args)
    onNav()
  }

  window.addEventListener("popstate", onNav)
  window.addEventListener("hashchange", onNav)
}

function startUrlMutationWatcher(): void {
  let lastUrl = window.location.href
  const observer = new MutationObserver(() => {
    if (window.location.href === lastUrl) return
    lastUrl = window.location.href
    reconcileOverlayLifecycle()
  })
  if (document.body) observer.observe(document.body, { childList: true, subtree: true })
}

// Native setter trick for React/Vue/Angular controlled inputs.
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
    const targetMatchesGroup = canonicals.some((c) => targetNorm.includes(normStr(c)))
    if (!targetMatchesGroup) continue

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
    if (input.type === "radio") {
      const name = input.name
      if (name) {
        const siblings = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type=\"radio\"][name=\"${name}\"]`),
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
          const filled = fillField(elementRef, value)
          if (filled) filledCount++
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

wireHistoryHooks()
startUrlMutationWatcher()
reconcileOverlayLifecycle()

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconcileOverlayLifecycle()
})
