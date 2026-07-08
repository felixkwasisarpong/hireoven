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

import { deepParentElement, queryAllDeep } from "./shadow-dom"

function clean(raw: string): string {
  return (raw || "Required field")
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/, "")
    .replace(/\s+required\s*$/i, "")
    .trim()
    .slice(0, 140)
}

function isConditionalFollowUp(raw: string): boolean {
  return /^if\b/i.test(clean(raw))
}

const VALUE_CONTROL_SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select'
const CHECKABLE_SELECTOR =
  'input[type=radio], input[type=checkbox], [role="radio"], [role="checkbox"], spl-radio, spl-checkbox, [aria-pressed]'
const ROW_SELECTOR = [
  '[class*="fieldEntry" i]',
  '[class*="field-entry" i]',
  '[class*="field-wrap" i]',
  '[class*="application-question" i]',
  '[class*="form-field" i]',
  '[class*="question" i]',
  "sr-question-field-radio",
  "sr-question-field-checkbox",
  "sr-question-field-select",
  "sr-question-field-text",
  "sr-question-field-number",
  "sr-question-field-textarea",
  "sr-screening-question",
  "spl-form-element",
  "spl-form-field",
  "fieldset",
  ".field",
  ".input-wrapper",
].join(",")

function queryWithin<T extends Element>(root: ParentNode, selector: string): T[] {
  const out = queryAllDeep<T>(root, selector)
  if (root instanceof HTMLElement && root.shadowRoot) {
    out.push(...queryAllDeep<T>(root.shadowRoot, selector))
  }
  return out
}

function shadowHostOf(el: Element): HTMLElement | null {
  const root = el.getRootNode()
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null
}

function rowOf(el: Element): HTMLElement | null {
  let fallback: HTMLElement | null = shadowHostOf(el)
  let node: HTMLElement | null = el instanceof HTMLElement ? el : null
  for (let depth = 0; node && depth < 14; depth += 1, node = deepParentElement(node)) {
    const host = shadowHostOf(node)
    if (host?.getAttribute("label") || host?.getAttribute("aria-required") === "true") {
      fallback = host
    }
    if (node.matches?.(ROW_SELECTOR)) return node
    if (
      node.getAttribute("label") ||
      node.getAttribute("aria-required") === "true" ||
      node.hasAttribute("required") ||
      node.getAttribute("data-required") === "true"
    ) {
      fallback = node
    }
  }
  return fallback
}

function labelText(el: Element): string {
  const row = rowOf(el)
  const host = shadowHostOf(el)
  const direct =
    (el as HTMLElement).getAttribute?.("label") ??
    host?.getAttribute("label") ??
    (el as HTMLElement).getAttribute?.("aria-label") ??
    host?.getAttribute("aria-label")
  if (direct?.trim()) return clean(direct)

  const labelSelectors = 'label,legend,[class*="label" i],[class*="title" i],[class*="question" i]'
  const labels = row ? queryWithin<HTMLElement>(row, labelSelectors) : []
  for (const lbl of labels) {
    if (lbl.querySelector(VALUE_CONTROL_SELECTOR) || lbl.querySelector(CHECKABLE_SELECTOR)) continue
    const txt = clean(lbl.textContent ?? lbl.getAttribute("label") ?? "")
    if (txt && !/^(value is|required|this field|invalid)$/i.test(txt)) return txt
  }

  const rowAttr = row?.getAttribute("label") ?? row?.getAttribute("aria-label")
  if (rowAttr?.trim()) return clean(rowAttr)
  const rowText = clean(row?.textContent ?? "")
  if (rowText && !/^(value is|required|this field|invalid)$/i.test(rowText)) return rowText

  // Placeholder is a LAST-resort label source: comboboxes carry a generic
  // "Start typing…" / "Select…" placeholder that must never shadow the row's
  // real <label> (Ashby Location). Only used when no row label was found
  // (SmartRecruiters EEO typeaheads labeled ONLY by placeholder).
  const placeholder = (el as HTMLElement).getAttribute?.("placeholder")
  if (placeholder?.trim() && !/^(start typing|select|choose|search|type )/i.test(placeholder.trim())) {
    return clean(placeholder)
  }

  return clean((el as HTMLElement).getAttribute?.("name") ?? (el as HTMLElement).id ?? "Required field")
}

function isRowRequired(row: HTMLElement | null): boolean {
  if (!row) return false
  if (
    row.hasAttribute("required") ||
    row.getAttribute("aria-required") === "true" ||
    row.getAttribute("data-required") === "true"
  ) {
    return true
  }
  if (queryWithin(row, '[required],[aria-required="true"],[data-required="true"]').length > 0) return true
  const lbl = queryWithin<HTMLElement>(row, 'label,legend,[class*="label" i],[class*="title" i]')[0]
  if (!lbl) return false
  return /\*/.test(lbl.textContent ?? "") || /\brequired\b|_required/i.test(String(lbl.className))
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  // Style-based (not layout-based): correct for clipped/offscreen-but-shown
  // controls, and works without a layout engine. Walk a few ancestors so a
  // collapsed/display:none section (e.g. an inactive multi-step page) is skipped.
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 10; depth += 1, node = deepParentElement(node)) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    if (!style) break
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

function selectedLike(el: Element): boolean {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked
  const ariaChecked = el.getAttribute("aria-checked")
  const ariaSelected = el.getAttribute("aria-selected")
  const ariaPressed = el.getAttribute("aria-pressed")
  if (ariaChecked === "true" || ariaSelected === "true" || ariaPressed === "true") return true
  // State classes use varied delimiters — Ashby's yes/no button is "_active",
  // others use "is-selected" / "active". A plain \bword\b boundary MISSES
  // "_active" (underscore is a word char, so there's no boundary before it),
  // so match any non-letter delimiter (or string edge) around the token.
  if (/(?:^|[^a-z])(?:active|checked|selected)(?:[^a-z]|$)/i.test(String((el as HTMLElement).className ?? ""))) return true
  return false
}

function selectionHost(input: HTMLInputElement): HTMLElement | null {
  const host = shadowHostOf(input)
  if (!host) return null
  let node: HTMLElement | null = host
  for (let depth = 0; node && depth < 8; depth += 1, node = deepParentElement(node)) {
    if (/^sr-question-field-select$/i.test(node.tagName)) return node
  }
  return host.tagName.toLowerCase().startsWith("spl-") ? host : null
}

function hasSelectionProp(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  const record = el as unknown as Record<string, unknown>
  for (const key of ["values", "selectedValues", "selected", "value"]) {
    const value = record[key]
    if (Array.isArray(value) && value.length > 0) return true
    if (typeof value === "string" && clean(value)) return true
  }
  return false
}

function comboboxHasValue(input: HTMLInputElement, row: HTMLElement | null): boolean {
  if (input.value.trim()) return true
  const host = shadowHostOf(input)
  const field = selectionHost(input)
  if (hasSelectionProp(host) || hasSelectionProp(field)) return true
  const scopes = [row, shadowHostOf(input), input.parentElement].filter((el): el is HTMLElement => Boolean(el))
  if (field && !scopes.includes(field)) scopes.push(field)
  for (const scope of scopes) {
    const chips = queryWithin<HTMLElement>(
      scope,
      [
        '[class*="singleValue" i]',
        '[class*="single-value" i]',
        '[class*="multiValue" i]',
        '[class*="multi-value" i]',
        "spl-chip",
        "spl-tag",
        '[part*="chip" i]',
        '[slot*="tag" i]',
        '[aria-selected="true"]',
      ].join(","),
    )
    if (chips.some((chip) => clean(chip.textContent || chip.getAttribute("label") || chip.getAttribute("value") || ""))) {
      return true
    }
  }
  return false
}

function valueControlEmpty(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, row: HTMLElement | null): boolean {
  if (el instanceof HTMLInputElement && el.type === "file") {
    return !el.files || el.files.length === 0
  }
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    const group = row ? queryWithin<HTMLInputElement>(row, `input[type=${el.type}]`) : [el]
    return !group.some((item) => item.checked)
  }
  if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") {
    return !comboboxHasValue(el, row)
  }
  if (el instanceof HTMLSelectElement) {
    const selected = el.options[el.selectedIndex]
    const label = clean(selected?.textContent || selected?.value || "")
    return !el.value.trim() || /^select|choose|--$/i.test(label)
  }
  return !String(el.value ?? "").trim()
}

export function findUnfilledRequiredFields(doc: Document = document): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const t = clean(raw)
    if (isConditionalFollowUp(t)) return
    const key = t.toLowerCase()
    if (t && !seen.has(key)) {
      seen.add(key)
      out.push(t)
    }
  }

  // 1. Native and shadow-DOM value-bearing controls.
  queryAllDeep<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(doc, VALUE_CONTROL_SELECTOR)
    .forEach((el) => {
      // Radios & checkboxes are answered as a GROUP and are handled by the
      // custom-widget pass (section 3), which understands Yes/No BUTTON groups.
      // Ashby's yes/no widget keeps a hidden helper <input type=checkbox> that
      // stays unchecked even when a button is active — flagging it here would
      // report an answered question as missing. Leave them entirely to pass 3.
      if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) return
      const row = rowOf(el)
      const isFile = el instanceof HTMLInputElement && el.type === "file"
      if (!isFile && !isVisible(el)) return
      if (!el.hasAttribute("required") && el.getAttribute("aria-required") !== "true" && !isRowRequired(row)) return
      if (valueControlEmpty(el, row)) push(labelText(el))
    })

  // 2. Required file inputs with no file (hidden/clipped — skip the visibility gate).
  queryAllDeep<HTMLInputElement>(doc, 'input[type=file][required]').forEach((el) => {
    if (!el.files || el.files.length === 0) push(labelText(el))
  })

  // 3. Custom required widgets: Yes/No button groups, radio groups, consent checkboxes.
  const rows = new Set<HTMLElement>(queryAllDeep<HTMLElement>(doc, ROW_SELECTOR))
  queryAllDeep<HTMLElement>(doc, `${VALUE_CONTROL_SELECTOR},${CHECKABLE_SELECTOR}`).forEach((el) => {
    const row = rowOf(el)
    if (row) rows.add(row)
  })

  rows.forEach((row) => {
    if (!isRowRequired(row)) return
    const label =
      labelText(queryWithin(row, "input,button,[role=combobox],[role=radio],[role=checkbox]")[0] ?? row) ||
      (queryWithin<HTMLElement>(row, 'label,legend,[class*="label" i]')[0]?.textContent ?? "")

    const yesNo = queryWithin<HTMLElement>(row, "button,[aria-pressed]").filter((b) =>
      /^(yes|no)$/i.test(clean(b.textContent ?? b.getAttribute("aria-label") ?? "")),
    )
    if (yesNo.length >= 2) {
      if (!yesNo.some(selectedLike)) push(label)
      return
    }

    const radios = queryWithin<HTMLElement>(row, 'input[type=radio], [role="radio"], spl-radio')
      .filter(isVisible)
    if (radios.length > 0) {
      if (!radios.some(selectedLike)) push(label)
      return
    }

    const checks = queryWithin<HTMLElement>(row, 'input[type=checkbox], [role="checkbox"], spl-checkbox')
      .filter(isVisible)
    if (checks.length > 0) {
      if (!checks.some(selectedLike)) push(label)
      return
    }
  })

  return out
}
