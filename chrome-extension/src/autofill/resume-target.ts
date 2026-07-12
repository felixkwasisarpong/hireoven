/**
 * Picks the file input that is the actual résumé *submission* field on an
 * application page — used by the "Snap Resume" flow.
 *
 * The naive "first file input that accepts documents" rule breaks on modern
 * ATS forms (Ashby, Greenhouse react) that render a convenience
 * "Autofill from resume" parser banner ABOVE the real Resume field. Both
 * accept .pdf/.docx, so DOM order wins and the résumé lands in the parser
 * (which never shows a file chip) instead of the required Resume dropzone —
 * the "couldn't snap in" symptom. We score candidates instead of taking the
 * first match: real Resume field wins, parser banners / cover-letter slots /
 * avatar uploads lose.
 */

const DOC_ACCEPT_RE =
  /\.pdf|\.docx?|\.rtf|\.txt|pdf|msword|wordprocessing|officedocument|document|text\/plain|rich\s*text/
const IMAGE_ACCEPT_RE = /image|\.png|\.jpe?g|\.gif|\.heic|\.webp|\.svg/

function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  return typeof fn === "function" ? fn(value) : value.replace(/["\\]/g, "\\$&")
}

/**
 * Short, label-ish text in and around a file input — enough to tell a Resume
 * field from a parser banner / cover-letter / photo upload, without scooping
 * the entire form (we cap each ancestor's text so a giant container doesn't
 * drown the signal).
 */
function resumeContextText(el: HTMLInputElement, doc: Document): string {
  const parts: string[] = [
    el.getAttribute("name") ?? "",
    el.id ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("accept") ?? "",
  ]
  if (el.id) {
    const lbl = doc.querySelector(`label[for="${cssEscape(el.id)}"]`)
    if (lbl?.textContent) parts.push(lbl.textContent)
  }
  let node: HTMLElement | null = el.parentElement
  for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
    const text = node.textContent ?? ""
    // Cap per-ancestor: the tight field row is short; the form root is huge.
    if (text.length <= 240) parts.push(text)
  }
  return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim()
}

export function scoreResumeFileInput(el: HTMLInputElement, doc: Document): number {
  const accept = (el.getAttribute("accept") ?? "").toLowerCase()
  const acceptsDocs = accept === "" || DOC_ACCEPT_RE.test(accept)
  const acceptsImages = IMAGE_ACCEPT_RE.test(accept)
  // Image/avatar-only uploads are never the résumé slot.
  if (acceptsImages && !acceptsDocs) return -100

  const ctx = resumeContextText(el, doc)
  let score = 0
  if (acceptsDocs) score += 2
  if (el.required || el.getAttribute("aria-required") === "true") score += 2
  if (/\bresume\b|\bcv\b|curriculum\s*vitae/.test(ctx)) score += 5
  if (/\bcover\s*letter\b/.test(ctx)) score -= 8
  if (/\b(photo|avatar|headshot|profile\s*picture|logo)\b/.test(ctx)) score -= 20
  // "Autofill from resume" / "upload to prefill" parser banners are NOT the
  // submission field — strongly de-prioritise so the real Resume field wins.
  if (/autofill|auto-fill|pre-?fill|parse|populate (the )?(form|field)|to fill/.test(ctx)) {
    score -= 9
  }
  return score
}

/** Highest-scoring résumé file input, or the first file input as a last resort. */
export function pickResumeFileInput(doc: Document = document): HTMLInputElement | null {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'))
  if (inputs.length === 0) return null

  let best: { el: HTMLInputElement; score: number } | null = null
  for (const el of inputs) {
    const score = scoreResumeFileInput(el, doc)
    if (score <= -50) continue // disqualified (image/avatar/photo)
    if (!best || score > best.score) best = { el, score }
  }
  return best?.el ?? inputs[0] ?? null
}

const RESUME_HINT = /r[eé]sum[eé]|\bcv\b|curriculum/i
// No trailing anchor: in DOM textContent the filename often runs straight into
// an adjacent control's label ("Resume.pdf" + "Remove" → "Resume.pdfRemove"), so
// a word/letter boundary would miss it. A "." + doc extension is signal enough.
const FILE_NAME = /\.(pdf|docx?|rtf|txt)/i
// Explicit "clear this file" affordances — labels, aria, title, icons, classes.
const CLEAR_HINT = /\b(remove|delete|clear|discard|reset|trash|detach|unattach|start\s*over)\b|^\s*[×✕✖✗xX🗑␡]\s*$/i
const CLEAR_CLASS = /(^|[-_ ])(remove|delete|clear|trash|close|dismiss|bin)([-_ ]|$)/i
// The control is a "replace/change" affordance — also fine to click, AS LONG AS
// it doesn't open a native OS file dialog (handled by opensNativePicker below).
const REPLACE_HINT = /\b(replace|change|update|swap|re-?upload|re-?attach|different\s+file)\b/i
// Controls we must NOT click: they only view the file, or they pop a native file
// dialog that would block an autonomous run.
const NON_REMOVE = /\b(download|view|preview|open|see|show|edit\s+details)\b/i

function isControlVisible(el: HTMLElement): boolean {
  if (el.hidden) return false
  const s = getComputedStyle(el)
  return s.display !== "none" && s.visibility !== "hidden"
}

/** True when clicking this control would open a native OS file picker (a
 *  <label for=fileinput>, a control wrapping/pointing at an <input type=file>),
 *  which we can't drive and would deadlock the flow — so we avoid it. */
function opensNativePicker(el: HTMLElement): boolean {
  if (el.tagName === "LABEL") return true
  const forId = (el as HTMLLabelElement).htmlFor
  if (forId && el.ownerDocument.getElementById(forId)?.matches('input[type="file"]')) return true
  if (el.querySelector('input[type="file"]')) return true
  if (el.closest("label")) return true
  return false
}

function controlLabel(el: HTMLElement): string {
  return [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent, el.className]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * When a résumé is already attached to the form — a returning applicant, a
 * profile prefill, or a prior step — the tailored résumé must REPLACE it, not
 * sit beside the stale file. This finds the résumé attachment row (context: it
 * mentions résumé/CV AND shows a filename) and clicks its clear/replace control
 * so the field is empty before we inject.
 *
 * The control's LABEL varies wildly (Remove, Delete, Clear, Replace, Change, an
 * × or trash icon, or nothing), so we don't rely on a fixed word list: we scope
 * to the résumé row and pick its clear/replace control by intent, explicitly
 * skipping (a) view/download controls and (b) anything that would open a native
 * OS file dialog. Falls back to the row's sole actionable control when the label
 * is unrecognisable. Returns true if it clicked one.
 */
export function removeExistingResumeAttachment(root: Document = document): boolean {
  // 1. Résumé attachment rows: tightest containers that mention résumé + a file.
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>(
      'li, tr, [role="listitem"], section, fieldset, div, [class*="attach" i], [class*="upload" i], [class*="file" i], [class*="resume" i], [class*="document" i]',
    ),
  ).filter((row) => {
    const t = (row.textContent ?? "").toLowerCase()
    return RESUME_HINT.test(t) && FILE_NAME.test(t)
  })
  // Tightest first, so we act on the attachment row itself, not the whole form.
  rows.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)

  const seen = new Set<HTMLElement>()
  for (const row of rows) {
    const controls = Array.from(
      row.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [aria-label], [title]'),
    ).filter((el) => !seen.has(el) && isControlVisible(el) && !opensNativePicker(el))
    controls.forEach((el) => seen.add(el))
    if (controls.length === 0) continue

    // Prefer an explicit clear control; then a safe replace/change control; then,
    // if the row has exactly one plausible control, trust it whatever it says.
    const scored = controls.filter((el) => {
      const l = controlLabel(el)
      return !NON_REMOVE.test(l) || CLEAR_HINT.test(l)
    })
    const target =
      scored.find((el) => CLEAR_HINT.test(controlLabel(el)) || CLEAR_CLASS.test(el.className)) ??
      scored.find((el) => REPLACE_HINT.test(controlLabel(el))) ??
      (scored.length === 1 ? scored[0] : null)
    if (target) {
      target.click()
      return true
    }
  }
  return false
}
