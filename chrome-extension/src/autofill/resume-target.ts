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

/**
 * When a résumé is already attached to the form — a returning applicant, a
 * profile prefill, or a prior step — the tailored résumé must REPLACE it, not
 * sit beside the stale file. Find a remove/delete control scoped to a résumé
 * file attachment and click it, so the field is clear before we inject. Scoped
 * to BOTH a résumé context AND an actual filename so we never click an unrelated
 * "remove" (a cover letter, a portfolio item, some other page control). Returns
 * true if it removed something.
 */
export function removeExistingResumeAttachment(root: Document = document): boolean {
  const RESUME_HINT = /r[eé]sum[eé]|\bcv\b|curriculum/i
  const FILE_NAME = /\.(pdf|docx?|rtf|txt)\b/i
  const REMOVE_LABEL = /\b(remove|delete|clear|discard)\b/i
  const REMOVE_ICON = /^\s*[×✕✖✗xX]\s*$/

  const controls = root.querySelectorAll<HTMLElement>(
    'button, a[href], [role="button"], [aria-label], [title]',
  )
  for (const el of controls) {
    const style = getComputedStyle(el)
    if (el.hidden || style.display === "none" || style.visibility === "hidden") continue
    const label = [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent]
      .filter(Boolean)
      .join(" ")
      .trim()
    const isRemove =
      REMOVE_LABEL.test(label) ||
      REMOVE_ICON.test(el.textContent ?? "") ||
      /(^|[-_ ])(remove|delete)([-_ ]|$)/i.test(el.className)
    if (!isRemove) continue
    // The control must sit inside a résumé file attachment — a container that
    // mentions résumé/CV AND shows a filename — so we only clear the résumé.
    const section =
      el.closest<HTMLElement>(
        'li, tr, [role="listitem"], section, fieldset, [class*="attach" i], [class*="upload" i], [class*="file" i], [class*="resume" i], [class*="document" i]',
      ) ?? el.parentElement
    const text = (section?.textContent ?? "").toLowerCase()
    if (RESUME_HINT.test(text) && FILE_NAME.test(text)) {
      el.click()
      return true
    }
  }
  return false
}
