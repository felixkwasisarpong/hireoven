/**
 * Hireoven Apex Bridge — Content Script
 *
 * Boots the page-aware overlay on supported job sites and proxies
 * messages from background/popup to detection/extraction/fill helpers.
 *
 * Safety: never auto-submit; manual autofill requires explicit user action,
 * while agent-mode autofill only runs when a trusted extension command is issued.
 */

import { detectFormFields } from "./autofill/form-detector"
import { pickResumeFileInput } from "./autofill/resume-target"
import { extractLinkedInProfile, isOwnLinkedInProfile } from "./extractors/linkedin-profile"
import { scrapeConnectionResults } from "./apex-connection-scanner"
import { syncLinkedInBrandProfile } from "./api-client"
import { detectPage } from "./detectors/ats"
import { extractJobWithMeta } from "./extractors/job"
import { ApexBar } from "./overlay/apex-bar"
import { JobCardBadgeEngine } from "./overlay/job-card-badges"
import { unmountScreenerBar } from "./overlay/job-screener"
import {
  mountDetailApexPanel,
  unmountDetailApexPanel,
} from "./overlay/job-detail-apex"
import {
  detectExtensionPageMode,
  isJobBoardSite,
} from "./detectors/page-mode"
import { detectSite } from "./detectors/site"
import type {
  ContentMessage,
  ContentResponse,
  DetectedPage,
  FillFormFieldsMessage,
} from "./types"

type HireovenContentWindow = Window & {
  __hoContentBootstrapped?: boolean
}

let apexBarInstance: ApexBar | null = null

// Sites where the Apex Bar is allowed to mount.
//
// Intentionally EXCLUDED (job-board aggregators):
//   - linkedin.com   — external apply URLs hidden behind voyager API; extraction unreliable
//   - glassdoor.com  — same: aggregates jobs from real ATSes, doesn't expose direct apply URL
//   - indeed.com     — same
//   - joinhandshake.com — same; never was in this list
// Users save jobs from the company's real ATS instead, where Apply URL extraction is solid.
//
// These hosts still receive the content script (for the hireoven.com bridge),
// but shouldOverlayThisHost() returns false → bar never mounts there.
const OVERLAY_HOST_ALLOWLIST: readonly RegExp[] = [
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


function isTopFrame(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

// Job-board aggregators where Apex intentionally does NOT mount the bar.
// These sites' /jobs/ paths would otherwise match CAREER_PATH_PATTERN and
// trigger the overlay even though we've removed them from the allowlist.
// Save flow on these sites is unreliable (apply URL hidden behind their API)
// so we'd rather have no bar than a broken Save experience.
const OVERLAY_HOST_DENYLIST: readonly RegExp[] = [
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)glassdoor\.com$/i,
  /(?:^|\.)indeed\.com$/i,
  /(?:^|\.)joinhandshake\.com$/i,
]

function shouldOverlayThisHost(): boolean {
  const host = window.location.hostname.replace(/^www\./i, "").toLowerCase()
  if (OVERLAY_HOST_DENYLIST.some((re) => re.test(host))) return false
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

  // Contenteditable rich-text editors (Quill, TipTap, Draft.js)
  const ce = el.getAttribute("contenteditable")
  if (ce === "true" || ce === "") {
    el.focus()
    // Select all existing content and replace
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    // Use execCommand for broad compatibility — falls back to textContent
    if (!document.execCommand("insertText", false, value)) {
      el.textContent = value
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

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
        case "INJECT_RESUME_FILE": {
          const m = message as { base64: string; filename: string }
          const result = injectResumeFile(m.base64, m.filename)
          sendResponse(result)
          break
        }
        case "EXECUTE_APEX_COMMAND": {
          void (async () => {
            if (!apexBarInstance) {
              await mountApexBarWhenReady()
            }
            if (!apexBarInstance) {
              sendResponse({
                type: "APEX_COMMAND_EXECUTED",
                accepted: false,
                message: "Apex Bar is not mounted on this page.",
              })
              return
            }
            const cmdResult = await apexBarInstance.executeApexCommand(message.command, message.payload)
            // accepted:false on a login/redirect page so the background keeps the
            // pending agent context and retries after sign-in. `waiting` marks the
            // legitimate "deliberately paused" case (login) vs a stuck dead-end —
            // the background only resets its retry budget when truly waiting.
            sendResponse({ type: "APEX_COMMAND_EXECUTED", accepted: cmdResult.handled, waiting: cmdResult.waiting === true })
          })().catch((err) => {
            sendResponse({
              type: "APEX_COMMAND_EXECUTED",
              accepted: false,
              message: err instanceof Error ? err.message : "Command execution failed.",
            })
          })
          return true
        }
        case "SCRAPE_LINKEDIN_CONNECTIONS": {
          // LinkedIn renders results async via React — poll until profile links
          // appear, scrolling to trigger lazy-loading, or give up after ~12s.
          ;(async () => {
            // Count profile links in the main results area (exclude the few in nav/sidebar)
            const countProfileLinks = () =>
              document.querySelectorAll("a[href*='/in/']").length

            await new Promise<void>((resolve) => {
              const start = Date.now()
              let lastScroll = 0
              function check() {
                const links = countProfileLinks()
                const elapsed = Date.now() - start
                // Enough results, or timed out
                if (links >= 5 || elapsed > 12_000) {
                  resolve()
                  return
                }
                // Nudge lazy-loading by scrolling every ~1.2s
                if (elapsed - lastScroll > 1200) {
                  lastScroll = elapsed
                  window.scrollTo(0, document.body.scrollHeight * 0.6)
                }
                setTimeout(check, 400)
              }
              check()
            })

            const connections = scrapeConnectionResults()
            sendResponse({ type: "PAGE_DETECTED", page: { ats: "linkedin" }, connections } as never)
          })()
          return true  // keep message port open for async sendResponse
        }
        case "PUSH_SCAN_RESULT": {
          // Background finished the LinkedIn scan and is pushing the result to this Apex tab.
          // Relay it to the web app via window.postMessage.
          const msg = message as unknown as { ok: boolean; connections?: unknown[]; error?: string }
          window.postMessage({
            type: "APEX_SCAN_CONNECTIONS_RESULT",
            ok: msg.ok,
            connections: msg.connections,
            error: msg.error,
          }, window.location.origin)
          sendResponse({ type: "PAGE_DETECTED", page: { ats: "other" } } as never)
          break
        }
        case "SCRAPE_LINKEDIN_PROFILE": {
          // Runs on a LinkedIn profile (or /details/experience|education) tab.
          // Sections lazy-load on scroll, so walk to the bottom, expand any inline
          // "…see more" descriptions, then return the main content text for the
          // server AI parser to structure.
          ;(async () => {
            // Scroll until the page height stabilizes at the bottom, capped at ~6s.
            await new Promise<void>((resolve) => {
              const start = Date.now()
              let lastHeight = 0
              let stableSince = 0
              function step() {
                const elapsed = Date.now() - start
                const h = document.body?.scrollHeight ?? 0
                const atBottom = window.scrollY + window.innerHeight >= h - 240
                if (h === lastHeight && atBottom) {
                  if (!stableSince) stableSince = elapsed
                  if (elapsed - stableSince > 500) { resolve(); return }
                } else {
                  stableSince = 0
                }
                lastHeight = h
                if (elapsed > 6000) { resolve(); return }
                window.scrollBy(0, Math.round(window.innerHeight * 0.9))
                setTimeout(step, 280)
              }
              step()
            })

            // Expand inline truncated descriptions ("…see more"). Only the inline
            // text expander — NOT "Show all" links (those navigate away).
            document
              .querySelectorAll<HTMLElement>(
                'button.inline-show-more-text__button, button[aria-label*="see more" i]',
              )
              .forEach((btn) => {
                try { btn.click() } catch { /* best-effort */ }
              })
            await new Promise((r) => setTimeout(r, 400))

            window.scrollTo(0, 0)
            const root =
              document.querySelector<HTMLElement>("main") ??
              document.querySelector<HTMLElement>("[role='main']") ??
              document.body
            const rawText = (root?.innerText ?? document.body?.innerText ?? "")
              .replace(/[ \t]+/g, " ")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
            sendResponse({ type: "PAGE_DETECTED", page: { ats: "linkedin" }, rawText } as never)
          })()
          return true // keep the message port open for async sendResponse
        }
        case "PUSH_LINKEDIN_PROFILE_RESULT": {
          // Background finished the profile import and is pushing the result to this
          // Apex tab. Relay it to the web app via window.postMessage.
          const msg = message as unknown as { ok: boolean; rawText?: string; error?: string }
          window.postMessage({
            type: "LINKEDIN_PROFILE_RESULT",
            ok: msg.ok,
            rawText: msg.rawText,
            error: msg.error,
          }, window.location.origin)
          sendResponse({ type: "PAGE_DETECTED", page: { ats: "other" } } as never)
          break
        }
        default:
          sendResponse({ type: "ERROR", message: "Unknown message type" })
      }
      return true
    },
  )
}

// ── Resume file injection via DataTransfer ────────────────────────────────────
// Content scripts can set input.files using DataTransfer even though regular
// web pages cannot — Chrome grants this in the extension isolated world.

function isResumeFileInput(input: HTMLInputElement): boolean {
  // Accept attribute suggests document types
  const accept = input.accept.toLowerCase()
  if (/\.pdf|\.doc|application\/pdf|application\/msword/.test(accept)) return true

  // Name / id contains resume-related words
  const nameId = `${input.name} ${input.id}`.toLowerCase()
  if (/resume|cv|curriculum|upload.doc|document|attachment/.test(nameId)) return true

  // aria-label
  const aria = (input.getAttribute("aria-label") ?? "").toLowerCase()
  if (/resume|cv|curriculum/.test(aria)) return true

  // Associated label text
  if (input.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`)
    const labelText = (label?.textContent ?? "").toLowerCase()
    if (/resume|cv|curriculum|upload/.test(labelText)) return true
  }

  // Closest container with resume-related class/text
  const container = input.closest('[class*="resume"],[class*="upload"],[class*="document"],[class*="attachment"],[data-test*="resume"],[data-automation*="resume"]')
  if (container) return true

  // Generic: first file input on the page with no accept restriction is likely resume
  const allFileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
  if (allFileInputs.length === 1 && allFileInputs[0] === input) return true

  return false
}

/**
 * Fire a synthetic drag-and-drop carrying the file. Custom dropzones
 * (Ashby, SmartRecruiters, many React file widgets) listen for a `drop`
 * event with a populated `dataTransfer` on their root element — NOT for a
 * file-input `change` — so setting `input.files` alone never registers.
 * Mirrors WorkdayAutofiller.dispatchDropWithFile. Harmless on plain
 * `<input>` forms (Greenhouse) where nothing handles `drop`.
 */
function dispatchDropWithFile(target: HTMLElement, file: File): void {
  try {
    const dt = new DataTransfer()
    dt.items.add(file)
    for (const type of ["dragenter", "dragover", "drop"] as const) {
      let ev: Event & { dataTransfer?: DataTransfer }
      try {
        ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }) as DragEvent & {
          dataTransfer?: DataTransfer
        }
      } catch {
        ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: DataTransfer }
      }
      if (!ev.dataTransfer) {
        try { Object.defineProperty(ev, "dataTransfer", { value: dt }) } catch { /* read-only */ }
      }
      target.dispatchEvent(ev)
    }
  } catch { /* best-effort */ }
}

/** Nearest dropzone-like ancestor of a file input (for the drop fallback). */
function findDropzoneFor(input: HTMLInputElement): HTMLElement {
  const zone = input.closest<HTMLElement>(
    '[class*="dropzone" i],[class*="drop-zone" i],[class*="droparea" i],[class*="drag" i],' +
    '[class*="fileupload" i],[class*="file-upload" i],[class*="upload" i],[data-testid*="upload" i]',
  )
  if (zone) return zone
  const row = input.closest<HTMLElement>('[class*="fieldentry" i],[class*="field-entry" i],[class*="field" i]')
  return row ?? input.parentElement ?? input
}

function injectResumeFile(base64: string, filename: string): { type: "INJECT_RESUME_FILE_RESULT"; injected: boolean; selector?: string; error?: string } {
  try {
    // Convert base64 → Uint8Array
    const binary = atob(base64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    // File may be docx or pdf depending on what the server generated
    const mimeType = filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const blob = new Blob([bytes], { type: mimeType })
    const file = new File([blob], filename, { type: mimeType, lastModified: Date.now() })

    // Find the résumé *submission* input — scored, not first-match, so the
    // résumé doesn't land in an "Autofill from resume" parser banner that
    // sits above the real Resume field (Ashby/Greenhouse-react). Keep the
    // legacy heuristic as a fallback when the scorer is unsure.
    const target =
      pickResumeFileInput(document) ??
      [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(isResumeFileInput) ??
      document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!target) return { type: "INJECT_RESUME_FILE_RESULT", injected: false, error: "No file input found" }

    const dt = new DataTransfer()
    dt.items.add(file)

    // React-controlled inputs (and react-dropzone) only re-render when the
    // native setter is invoked BEFORE the input/change events fire — otherwise
    // React's onChange reads the synthesized value and ignores the later setter
    // call. Set first, dispatch second; plain assignment is the non-React path.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set
    if (nativeSetter) nativeSetter.call(target, dt.files)
    else target.files = dt.files

    target.dispatchEvent(new Event("input",  { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))

    // Plain-input ATSes (Greenhouse) register the file from the change above.
    // Custom dropzones (Ashby) ignore it and only react to a `drop` event with
    // a populated dataTransfer on the dropzone root — fire that too. Doing both
    // is safe: each ATS reacts to the mechanism it listens for.
    dispatchDropWithFile(findDropzoneFor(target), file)

    // Build a stable selector for the result
    const selector = target.id
      ? `#${CSS.escape(target.id)}`
      : target.name
        ? `input[name="${target.name}"]`
        : "input[type='file']"

    // We set the FileList on the input, so report success. (We can't reliably
    // verify a dropzone's internal React state, but the drop event is fired.)
    const injected = target.files != null && target.files.length > 0
    return injected
      ? { type: "INJECT_RESUME_FILE_RESULT", injected: true, selector }
      : { type: "INJECT_RESUME_FILE_RESULT", injected: false, selector, error: "File was rejected by the form" }
  } catch (err) {
    return { type: "INJECT_RESUME_FILE_RESULT", injected: false, error: String(err) }
  }
}

async function mountApexBarWhenReady(): Promise<void> {
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

  // ApexBar manages its own lifecycle (SPA URL observer, mount/teardown).
  if (!apexBarInstance) {
    apexBarInstance = new ApexBar()
  }
  await apexBarInstance.mount()
}

/**
 * Mount the job-card badge overlay on supported job-board sites
 * (LinkedIn / Indeed / Glassdoor / Handshake). This intentionally runs even
 * on hosts that ApexBar's denylist excludes — the badges ARE the Hireoven
 * surface for those sites.
 *
 * Re-checks the page mode whenever the URL changes (LinkedIn search → detail
 * → search) so we only run the engine when there are real cards to badge.
 */
async function mountJobCardBadgesWhenReady(): Promise<void> {
  if (!isTopFrame()) return

  if (!document.body) {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        document.removeEventListener("DOMContentLoaded", onReady)
        resolve()
      }
      document.addEventListener("DOMContentLoaded", onReady)
    })
  }

  let engine: JobCardBadgeEngine | null = null
  let lastSite: string | null = null

  const refresh = () => {
    const site = detectSite()
    if (!isJobBoardSite(site)) {
      engine?.stop()
      engine = null
      lastSite = null
      unmountScreenerBar()
      unmountDetailApexPanel()
      return
    }
    if (site === "linkedin") {
      // Product requirement: no extension overlay UI on LinkedIn.
      // Explicitly disable job-card badges + detail panel there.
      engine?.stop()
      engine = null
      lastSite = null
      unmountScreenerBar()
      unmountDetailApexPanel()
      return
    }
    const mode = detectExtensionPageMode(window.location.href, document)
    if (mode === "unknown") {
      engine?.stop()
      engine = null
      lastSite = null
      unmountScreenerBar()
      unmountDetailApexPanel()
      return
    }

    // Screener bar disabled — replaced by per-handler aggregator pills.
    // The Detail Apex panel still renders on job-detail pages.
    unmountScreenerBar()
    if (mode === "job_board_detail") {
      void mountDetailApexPanel(site)
    } else {
      unmountDetailApexPanel()
    }

    if (engine && lastSite === site) {
      // Engine already running on this site; nothing else to do.
      return
    }
    engine?.stop()
    engine = new JobCardBadgeEngine(site)
    engine.start()
    lastSite = site
  }

  refresh()

  // Cheap URL poll — same approach the Apex Bar uses for SPA navigation.
  let lastUrl = window.location.href
  setInterval(() => {
    if (window.location.href === lastUrl) return
    lastUrl = window.location.href
    refresh()
  }, 600)
}

// ── Hireoven dashboard ↔ extension bridge ─────────────────────────────────────
//
// This bridge runs ONLY on hireoven.com / localhost:3000 (the app itself).
// It relays lightweight context between the Apex dashboard page and the
// background service worker using window.postMessage as the page-facing
// protocol and chrome.runtime.sendMessage as the extension-facing protocol.
//
// Protocol (page → extension):
//   window.postMessage({ source: "hireoven-apex", type: "GET_ACTIVE_CONTEXT" })
//
// Protocol (extension → page):
//   window.postMessage({ source: "hireoven-ext", type: "ACTIVE_CONTEXT_RESULT" | "ACTIVE_CONTEXT_PUSH", context })

const APEX_SOURCE = "hireoven-apex"
const EXT_SOURCE = "hireoven-ext"

function isLocalAppHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "")
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]"
  )
}

function isHireovenPage(): boolean {
  const host = window.location.hostname.toLowerCase().replace(/^www\./, "")
  return host === "hireoven.com" || host.endsWith(".hireoven.com") || isLocalAppHost(host)
}

function registerPageBridge(): void {
  if (!isHireovenPage()) return

  // Page → extension: Apex dashboard requests current context
  // ── Page → Extension: Apex dashboard sends requests and commands ────────────
  const APEX_RELAY_COMMANDS = new Set([
    "OPEN_AUTOFILL",
    "START_TAILOR",
    "START_COMPARE",
    "START_WORKFLOW",
    "AGENT_AUTOFILL",
  ])

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    if (typeof event.data !== "object" || event.data === null) return
    const msg = event.data as Record<string, unknown>
    if (msg.source !== APEX_SOURCE) return

    // If the extension was reloaded, this content script is orphaned —
    // chrome.runtime.sendMessage would throw "Extension context invalidated".
    // Bail gracefully and, for scan requests, tell the page to refresh.
    if (!chrome.runtime?.id) {
      if (msg.type === "APEX_SCAN_CONNECTIONS") {
        window.postMessage({
          type: "APEX_SCAN_CONNECTIONS_RESULT",
          ok: false,
          error: "Extension was updated — please refresh this page (⌘⇧R) and try again.",
        }, window.location.origin)
      }
      return
    }

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

    // Apply agent — open job URL in a new tab, then auto-autofill when it loads
    if (msg.type === "OPERATOR_OPEN_TAB") {
      chrome.runtime.sendMessage({
        type: "OPERATOR_OPEN_TAB",
        url:           msg.url,
        jobId:         msg.jobId,
        jobTitle:      msg.jobTitle,
        company:       msg.company,
        coverLetterId: msg.coverLetterId,
        agentMode:     msg.agentMode ?? false,
      })
      return
    }

    // Shadow Network: fire scan request — result is pushed back via PUSH_SCAN_RESULT
    if (msg.type === "APEX_SCAN_CONNECTIONS") {
      chrome.runtime.sendMessage({
        type: "SCAN_LINKEDIN_CONNECTIONS",
        companyName: msg.companyName,
        jobTitle: msg.jobTitle,
      }).catch(() => {})
      return
    }

    // Resume import: open the given LinkedIn profile URL (or the user's own),
    // scrape it, and push the text back via PUSH_LINKEDIN_PROFILE_RESULT →
    // LINKEDIN_PROFILE_RESULT.
    if (msg.type === "IMPORT_LINKEDIN_PROFILE") {
      const url = typeof msg.url === "string" ? msg.url : undefined
      chrome.runtime.sendMessage({ type: "IMPORT_LINKEDIN_PROFILE", url }).catch(() => {})
      return
    }

    // Apex UI commands — relay to background which forwards to active job tab
    if (APEX_RELAY_COMMANDS.has(msg.type as string)) {
      chrome.runtime.sendMessage({
        type: "RELAY_APEX_COMMAND",
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

// ── LinkedIn own-profile sync ─────────────────────────────────────────────────
// Silently reads the user's OWN LinkedIn profile and syncs brand signals to
// Hireoven. Only fires on linkedin.com/in/[slug] pages where the user is the
// profile owner. Never touches other people's profiles.

// Match any linkedin.com/in/[slug] path — ignore query params and hash
const LINKEDIN_PROFILE_PATH_RE = /linkedin\.com\/in\/([^/?#]+)/

let linkedInSyncedSlug = ""

function maybeRunLinkedInProfileSync(): void {
  const href = window.location.href
  const slugMatch = href.match(LINKEDIN_PROFILE_PATH_RE)
  if (!slugMatch) return

  const currentSlug = slugMatch[1].toLowerCase()
  if (currentSlug === linkedInSyncedSlug) return  // already synced this slug

  // Wait for LinkedIn React hydration (it's a heavy SPA)
  setTimeout(() => {
    if (!chrome.runtime?.id) return

    chrome.runtime.sendMessage(
      { type: "GET_STORED_LINKEDIN_URL" },
      (response: unknown) => {
        if (chrome.runtime.lastError) return

        const storedUrl = (response as { linkedinUrl?: string | null } | null)?.linkedinUrl ?? null

        // Primary check: slug match against stored URL
        // Fallback: DOM edit-button detection (only if no URL stored yet)
        if (!isOwnLinkedInProfile(storedUrl)) return

        const profileData = extractLinkedInProfile()
        syncLinkedInBrandProfile(profileData)
        linkedInSyncedSlug = currentSlug
      }
    )
  }, 3000)  // 3s — give LinkedIn more time to fully render
}

function bootstrap(): void {
  const w = window as HireovenContentWindow
  if (w.__hoContentBootstrapped) return
  w.__hoContentBootstrapped = true

  registerMessageBridge()
  registerPageBridge()
  void mountApexBarWhenReady()
  void mountJobCardBadgesWhenReady()
  maybeRunLinkedInProfileSync()

  // Proactively announce to the Apex app that the extension is live.
  // This prevents the race condition where the app sends GET_ACTIVE_CONTEXT
  // before the content script is ready to respond.
  if (isHireovenPage()) {
    setTimeout(() => {
      if (!chrome.runtime?.id) return
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_CONTEXT" }, (response) => {
        if (chrome.runtime.lastError) return
        const ctx = (response as { context?: unknown })?.context ?? null
        window.postMessage(
          { source: "hireoven-ext", type: "ACTIVE_CONTEXT_CHANGED", context: ctx },
          window.location.origin,
        )
      })
    }, 300)
  }
}

// ── Agent resume (content-pull) ──────────────────────────────────────────────
// The reliable "resume after login" path. Instead of waiting for the background
// to push AGENT_AUTOFILL at exactly the right moment (fragile across MV3 worker
// death + slow page hydration), the in-page bar proactively asks the background
// whether THIS tab has a pending agent job and runs it. Runs on load, on each
// SPA navigation, and on a slow timer until the job is consumed.
let agentPullActive = false
let agentPullMisses = 0
let agentPullStuck = 0
let agentPullTimer: ReturnType<typeof setInterval> | null = null
const AGENT_PULL_MAX_MISSES = 6
// Bounded retries for a "stuck" agent run (form never detected, no login wait).
// ~8 × 1.5s ≈ 12s of SPA-hydration grace before we give up and stop looping.
const AGENT_PULL_MAX_STUCK = 8

async function checkPendingAgentJob(): Promise<void> {
  if (agentPullActive) return
  if (!chrome.runtime?.id) return
  if (isHireovenPage()) return

  let res: { type?: string; pending?: boolean; payload?: Record<string, unknown> } | undefined
  try {
    res = (await chrome.runtime.sendMessage({ type: "AGENT_PENDING_CHECK" })) as typeof res
  } catch {
    return
  }

  if (!res || res.type !== "AGENT_PENDING_RESULT" || !res.pending) {
    agentPullMisses += 1
    // No job for this tab after several checks — stop polling to save cycles.
    if (agentPullMisses >= AGENT_PULL_MAX_MISSES) stopAgentPull()
    return
  }

  agentPullMisses = 0
  agentPullActive = true
  try {
    if (!apexBarInstance) await mountApexBarWhenReady()
    if (apexBarInstance) {
      console.debug("[ho-agent] resuming pending agent job", res.payload)
      const result = await apexBarInstance.executeApexCommand("AGENT_AUTOFILL", res.payload ?? {})
      // Three outcomes:
      //  • handled:true  → terminal (submitted / filled+handed-off / unrecoverable):
      //    consume the context and stop the 1.5s pull. Without this the pull
      //    re-runs AGENT_AUTOFILL forever on SPAs (Ashby) that fill but never
      //    navigate to a confirmation page — the "filling loops unending" bug.
      //  • waiting:true  → deliberately paused (login/redirect/transition): keep
      //    polling so we resume after the user signs in.
      //  • neither       → a stuck dead-end (e.g. form never detected): retry a
      //    bounded number of times, then give up so it can't loop forever.
      if (result?.handled) {
        try { await chrome.runtime.sendMessage({ type: "AGENT_JOB_CONSUMED" }) } catch { /* worker asleep */ }
        stopAgentPull()
      } else if (result?.waiting) {
        agentPullStuck = 0
      } else {
        agentPullStuck += 1
        if (agentPullStuck >= AGENT_PULL_MAX_STUCK) {
          try { await chrome.runtime.sendMessage({ type: "AGENT_JOB_CONSUMED" }) } catch { /* worker asleep */ }
          stopAgentPull()
        }
      }
    }
  } catch {
    // ignore — the next tick retries while the job is still pending
  } finally {
    agentPullActive = false
  }
}

function startAgentPull(): void {
  if (agentPullTimer) return
  agentPullStuck = 0
  agentPullMisses = 0
  agentPullTimer = setInterval(() => void checkPendingAgentJob(), 1500)
}

function stopAgentPull(): void {
  if (agentPullTimer) {
    clearInterval(agentPullTimer)
    agentPullTimer = null
  }
}

// Kick the pull loop shortly after load (gives the page a moment to hydrate).
if (!isHireovenPage()) {
  setTimeout(() => {
    startAgentPull()
    void checkPendingAgentJob()
  }, 1200)
}

// URL-change poller — covers both LinkedIn SPA navigation and ATS pages where
// login → application is a client-side route change (no full page reload).
// When on an ATS page, signal the background to retry any pending agent context
// so autofill fires automatically after the user completes login.
let lastHref = window.location.href
setInterval(() => {
  const href = window.location.href
  if (href === lastHref) return
  lastHref = href

  maybeRunLinkedInProfileSync()

  // Notify background of the SPA navigation so it can retry pending agent tabs.
  if (chrome.runtime?.id) {
    chrome.runtime.sendMessage({ type: "SPA_NAVIGATION_COMPLETE", url: href }).catch(() => {})
  }

  // A navigation (incl. returning from login) is the best moment to re-check for
  // a pending agent job — revive the pull loop and probe immediately.
  agentPullMisses = 0
  startAgentPull()
  void checkPendingAgentJob()
}, 800)

bootstrap()
