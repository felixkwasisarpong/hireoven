/**
 * Detect required form fields that are still empty, so the apply agent never
 * clicks Submit on an incomplete form (the "too quick to hit submit while
 * fields are empty" bug). Returns the human labels of the unfilled required
 * fields — empty array means it's safe to submit.
 *
 * Covers the widgets real ATS forms use:
 *   - native required text/email/tel/url/number/date inputs, selects, textareas
 *   - typeahead comboboxes whose row is marked required (Ashby Location)
 *   - required file inputs with no file (Ashby Résumé — hidden, tabindex=-1)
 *   - Ashby Yes/No button groups (answered ⇒ a button has an "active" class)
 *   - radio groups and required consent checkboxes
 */

function clean(raw: string): string {
  return (raw || "Required field").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 140)
}

function rowOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(
    '[class*="fieldEntry" i],[class*="field-entry" i],.application-question,fieldset,.field,.input-wrapper',
  )
}

function labelText(el: Element): string {
  const row = rowOf(el)
  const lbl = row?.querySelector(
    'label,legend,[class*="label" i],[class*="title" i],[class*="question" i]',
  )
  return (lbl?.textContent ?? (el as HTMLElement).getAttribute?.("aria-label") ?? "").trim()
}

function isRowRequired(row: HTMLElement | null): boolean {
  if (!row) return false
  if (row.querySelector('[required],[aria-required="true"]')) return true
  const lbl = row.querySelector('label,legend,[class*="label" i],[class*="title" i]')
  if (!lbl) return false
  return /\*/.test(lbl.textContent ?? "") || /\brequired\b|_required/i.test(lbl.className)
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  // Style-based (not layout-based): correct for clipped/offscreen-but-shown
  // controls, and works without a layout engine. Walk a few ancestors so a
  // collapsed/display:none section (e.g. an inactive multi-step page) is skipped.
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    if (!style) break
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

export function findUnfilledRequiredFields(doc: Document = document): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const t = clean(raw)
    const key = t.toLowerCase()
    if (t && !seen.has(key)) {
      seen.add(key)
      out.push(t)
    }
  }

  // 1. Native required value-bearing controls + required-row comboboxes.
  doc
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input[required]:not([type=file]):not([type=radio]):not([type=checkbox]), textarea[required], select[required], input[role="combobox"]',
    )
    .forEach((el) => {
      const isCombobox = el.getAttribute("role") === "combobox"
      if (isCombobox && !el.hasAttribute("required") && !isRowRequired(rowOf(el))) return
      if (!isVisible(el)) return
      const value = "value" in el ? String((el as HTMLInputElement).value ?? "") : ""
      if (!value.trim()) push(labelText(el))
    })

  // 2. Required file inputs with no file (hidden/clipped — skip the visibility gate).
  doc.querySelectorAll<HTMLInputElement>('input[type=file][required]').forEach((el) => {
    if (!el.files || el.files.length === 0) push(labelText(el))
  })

  // 3. Custom required widgets: Yes/No button groups, radio groups, consent checkboxes.
  doc.querySelectorAll<HTMLElement>('[class*="fieldEntry" i], fieldset').forEach((row) => {
    if (!isRowRequired(row)) return
    const label =
      labelText(row.querySelector("input,button,[role=combobox]") ?? row) ||
      (row.querySelector('label,legend,[class*="label" i]')?.textContent ?? "")

    const yesNo = Array.from(row.querySelectorAll("button")).filter((b) =>
      /^(yes|no)$/i.test((b.textContent ?? "").trim()),
    )
    if (yesNo.length >= 2) {
      if (!yesNo.some((b) => /active/i.test(b.className))) push(label)
      return
    }

    const radios = Array.from(row.querySelectorAll<HTMLInputElement>('input[type=radio]'))
    if (radios.length > 0) {
      if (!radios.some((r) => r.checked)) push(label)
      return
    }

    const checks = Array.from(row.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
    if (checks.length > 0) {
      if (!checks.some((c) => c.checked)) push(label)
      return
    }
  })

  return out
}
