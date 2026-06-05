import {
  injectDocxFile,
  setReactValue,
  type ResumeBytes,
  type SafeProfile,
} from "./safe-fields"

type AshbyQuestionType = "text" | "textarea" | "yesno" | "select"

export type AshbyQuestionRequest = {
  id: string
  label: string
  type: AshbyQuestionType
  options?: string[]
}

export type AshbyMatchedAnswer = {
  id: string
  value: string | null
  confidence: "high" | "medium" | "low"
}

export type AshbyFillNote = {
  label: string
  valuePreview?: string
  filled: boolean
  skippedReason?: string
}

export type AshbyQuestionFillSummary = {
  attemptedCount: number
  filledCount: number
  manualReviewCount: number
  notes: AshbyFillNote[]
}

export type RequiredQuestionRequest = AshbyQuestionRequest
export type RequiredMatchedAnswer = AshbyMatchedAnswer
export type RequiredFieldFillNote = AshbyFillNote
export type RequiredFieldFillSummary = AshbyQuestionFillSummary

export type AshbyResumeParserResult = {
  attempted: boolean
  uploaded: boolean
  parsed: boolean
  reason?: string
}

type FormControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

type AshbyQuestionTarget = {
  id: string
  label: string
  type: AshbyQuestionType
  options?: string[]
  row: HTMLElement
  controls: HTMLElement[]
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "button"
}

const FORM_CONTROL_SELECTOR =
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea"
const DOC_ACCEPT_RE =
  /\.pdf|\.docx?|\.rtf|\.txt|pdf|msword|wordprocessing|officedocument|document|text\/plain|rich\s*text/i
const IMAGE_ACCEPT_RE = /image|\.png|\.jpe?g|\.gif|\.heic|\.webp|\.svg/i
const TEXT_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "search"])

const SENSITIVE_QUESTION_RE =
  /\b(gender|sex|ethnicit|race|racial|hispanic|latino|veteran|disabilit|sexual orientation|pronoun|date of birth|birth\s?date|dob|salary|compensation)\b/i

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cleanLabel(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\s*\*\s*$/g, "")
    .replace(/\s+required\s*$/i, "")
    .trim()
}

function titleCaseName(value: string | null | undefined): string | null {
  const raw = normalizeText(value)
  if (!raw) return null
  return raw
    .split(/\s+/)
    .map((part) =>
      part
        .split("-")
        .map((piece) => {
          if (!piece) return piece
          if (piece.length <= 2 && piece === piece.toUpperCase()) return piece
          return `${piece.charAt(0).toUpperCase()}${piece.slice(1).toLowerCase()}`
        })
        .join("-"),
    )
    .join(" ")
}

function fullName(profile: SafeProfile): string | null {
  const parts = [titleCaseName(profile.first_name), titleCaseName(profile.last_name)].filter(
    (part): part is string => Boolean(part),
  )
  return parts.length > 0 ? parts.join(" ") : null
}

function locationValue(profile: SafeProfile): string | null {
  const parts = [profile.city, profile.state, profile.country]
    .map((part) => normalizeText(part))
    .filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

function companiesFromProfile(profile: SafeProfile): string[] {
  const rows = Array.isArray(profile.work_experience) ? profile.work_experience : []
  const companies = [
    profile.current_company,
    ...rows.map((row) => row?.company ?? null),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const company of companies) {
    const clean = normalizeText(company)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function currentCompany(profile: SafeProfile): string | null {
  const current = normalizeText(profile.current_company)
  if (current) return current
  const rows = Array.isArray(profile.work_experience) ? profile.work_experience : []
  const explicitCurrent = rows.find((row) => row?.is_current && normalizeText(row.company))
  if (explicitCurrent?.company) return normalizeText(explicitCurrent.company)
  const first = rows.find((row) => normalizeText(row?.company))
  return first?.company ? normalizeText(first.company) : null
}

function hasCompany(profile: SafeProfile, re: RegExp): boolean {
  return companiesFromProfile(profile).some((company) => re.test(company))
}

function profileHasWorkHistory(profile: SafeProfile): boolean {
  return companiesFromProfile(profile).length > 0
}

function isElementUsable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.hasAttribute("disabled")) return false
  const control = el as Partial<FormControlElement>
  if (control.disabled) return false
  return true
}

function fileInputAcceptsDocs(input: HTMLInputElement): boolean {
  const accept = input.getAttribute("accept") ?? ""
  if (!accept) return true
  if (IMAGE_ACCEPT_RE.test(accept) && !DOC_ACCEPT_RE.test(accept)) return false
  return DOC_ACCEPT_RE.test(accept)
}

function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  return typeof fn === "function" ? fn(value) : value.replace(/["\\]/g, "\\$&")
}

function contextText(el: HTMLElement, maxDepth = 5): string {
  const parts: string[] = [
    el.getAttribute("name") ?? "",
    el.id ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("accept") ?? "",
  ]
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`)
    if (lbl?.textContent) parts.push(lbl.textContent)
  }
  let node: HTMLElement | null = el.parentElement
  for (let depth = 0; node && depth < maxDepth; depth += 1, node = node.parentElement) {
    const text = normalizeText(node.textContent)
    if (text.length <= 700) parts.push(text)
  }
  return normalizeKey(parts.join(" "))
}

export function findAshbyResumeParserInput(doc: Document = document): HTMLInputElement | null {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => isElementUsable(input) && fileInputAcceptsDocs(input))
  if (inputs.length === 0) return null

  const scored = inputs
    .map((input) => {
      const ctx = contextText(input)
      let score = 0
      const hasParserSignal =
        /\bautofill from resume\b/.test(ctx) ||
        /\bupload your resume here to autofill\b/.test(ctx) ||
        /\bkey application fields\b/.test(ctx) ||
        /\b(auto fill|autofill|pre fill|prefill|parse|populate)\b/.test(ctx)
      if (/\bautofill from resume\b/.test(ctx)) score += 14
      if (/\bupload your resume here to autofill\b/.test(ctx)) score += 12
      if (/\bkey application fields\b/.test(ctx)) score += 8
      if (/\b(auto fill|autofill|pre fill|prefill|parse|populate)\b/.test(ctx)) score += 6
      if (/\bresume\b|\bcv\b/.test(ctx)) score += 2
      if (/\bcover letter\b/.test(ctx)) score -= 20
      if (/\bresume\b/.test(ctx) && /\brequired\b|\*/.test(ctx) && !/\bautofill\b|\bpre fill\b|\bparse\b/.test(ctx)) {
        score -= 10
      }
      return { input, score, hasParserSignal }
    })
    .filter((item) => item.hasParserSignal && item.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.input ?? null
}

export function hasAshbyResumeParserInput(doc: Document = document): boolean {
  return Boolean(findAshbyResumeParserInput(doc))
}

export async function runAshbyResumeParserPrefill(args: {
  profile: SafeProfile
  resumeBytes: ResumeBytes | null
  doc?: Document
  timeoutMs?: number
}): Promise<AshbyResumeParserResult> {
  const doc = args.doc ?? document
  const input = findAshbyResumeParserInput(doc)
  if (!input) return { attempted: false, uploaded: false, parsed: false, reason: "Ashby parser upload not found." }
  if (!args.resumeBytes) return { attempted: true, uploaded: false, parsed: false, reason: "No resume bytes available." }

  const uploaded = injectDocxFile(input, args.resumeBytes)
  if (!uploaded) return { attempted: true, uploaded: false, parsed: false, reason: "Parser upload rejected the resume file." }

  const parsed = await waitForAshbyParserFill(args.profile, doc, args.timeoutMs ?? 9000)
  return { attempted: true, uploaded: true, parsed }
}

/**
 * Fill Ashby typeahead comboboxes (e.g. the required Location field) directly:
 * type the value, wait for the option list, then click the matching option.
 * applySafeFills skips comboboxes, and a plain value-set doesn't register a
 * selection, so without this the Location field stays "missing" and blocks the
 * form. Returns the number of comboboxes filled.
 */
export async function fillAshbyComboboxes(profile: SafeProfile, doc: Document = document): Promise<number> {
  let filled = 0
  const combos = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[role="combobox"], input[aria-autocomplete="list"]'),
  ).filter((el) => isElementUsable(el) && !normalizeText(el.value))

  for (const input of combos) {
    const row = input.closest<HTMLElement>('[class*="fieldEntry" i], .ashby-application-form-field-entry')
    const label = row ? getQuestionLabel(row) : normalizeText(input.getAttribute("aria-label"))
    if (isSensitiveAshbyQuestion(label)) continue
    const value = /\blocation\b|\bcity\b|\baddress\b|\bresidence\b/i.test(label) ? locationValue(profile) : null
    if (!value) continue
    if (await fillAshbyTypeahead(input, value, doc)) filled += 1
  }
  return filled
}

async function fillAshbyTypeahead(input: HTMLInputElement, value: string, doc: Document): Promise<boolean> {
  try {
    input.focus()
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    input.click()
    const city = (value.split(",")[0] || value).trim()

    const collect = (): HTMLElement[] =>
      Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[role="option"], [data-automation-id*="option" i], [class*="option" i], [class*="menuItem" i], li[role]',
        ),
      ).filter((el) => isElementUsable(el) && normalizeText(el.textContent).length > 0)

    for (const query of [value, city]) {
      setReactValue(input, query, { blur: false })
      let options: HTMLElement[] = []
      const deadline = Date.now() + 1800
      while (Date.now() < deadline) {
        options = collect()
        if (options.length) break
        await sleep(150)
      }
      if (options.length === 0) continue
      const match =
        options.find((o) => normalizeText(o.textContent).toLowerCase().includes(city.toLowerCase())) ?? options[0]
      match.scrollIntoView({ block: "center" })
      match.click()
      await sleep(250)
      if (normalizeText(input.value).length > 0) return true
    }

    // Fallback: accept the top suggestion with Enter.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))
    await sleep(200)
    return normalizeText(input.value).length > 0
  } catch {
    return false
  }
}

async function waitForAshbyParserFill(
  profile: SafeProfile,
  doc: Document,
  timeoutMs: number,
): Promise<boolean> {
  const expectedCount = [
    fullName(profile),
    normalizeText(profile.email),
    normalizeText(profile.phone),
    locationValue(profile),
  ].filter(Boolean).length

  await sleep(900)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const filled = countFilledContactFields(profile, doc)
    if (filled >= Math.min(2, Math.max(expectedCount, 1))) return true
    if (filled > 0 && expectedCount <= 1) return true
    await sleep(350)
  }
  return countFilledContactFields(profile, doc) > 0
}

function countFilledContactFields(profile: SafeProfile, doc: Document): number {
  const targets: Array<[RegExp, string | null]> = [
    [/\b(full )?name\b|^name$/i, fullName(profile)],
    [/\bemail\b/i, normalizeText(profile.email)],
    [/\bphone\b|\bmobile\b|\btelephone\b/i, normalizeText(profile.phone)],
    [/\blocation\b|\bcity\b/i, locationValue(profile)],
  ]

  let count = 0
  for (const [labelRe, expected] of targets) {
    if (!expected) continue
    const control = findTextControlByLabel(doc, labelRe)
    if (!control) continue
    const value = normalizeText(control.value)
    if (value && value.toLowerCase() === expected.toLowerCase()) count += 1
    else if (value.length > 2) count += 1
  }
  return count
}

function findTextControlByLabel(doc: Document, re: RegExp): HTMLInputElement | HTMLTextAreaElement | null {
  const rows = collectAshbyRows(doc)
  for (const row of rows) {
    const label = getQuestionLabel(row)
    if (!re.test(label)) continue
    const control = row.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea")
    if (control && isElementUsable(control)) return control
  }
  return null
}

export async function fillAshbyRequiredFields(args: {
  profile: SafeProfile
  doc?: Document
  matchQuestions?: (questions: AshbyQuestionRequest[]) => Promise<AshbyMatchedAnswer[]>
}): Promise<AshbyQuestionFillSummary> {
  return fillRequiredAtsFields(args)
}

export async function fillRequiredAtsFields(args: {
  profile: SafeProfile
  doc?: Document
  matchQuestions?: (questions: RequiredQuestionRequest[]) => Promise<RequiredMatchedAnswer[]>
}): Promise<RequiredFieldFillSummary> {
  const doc = args.doc ?? document
  const notes: AshbyFillNote[] = []
  let attemptedCount = 0
  let filledCount = 0

  for (const target of collectAshbyQuestionTargets(doc, { requiredOnly: false })) {
    if (isQuestionAnswered(target)) continue
    const value = deterministicAnswerFor(target, args.profile)
    if (value === null) continue
    attemptedCount += 1
    const filled = applyAnswerToTarget(target, value)
    if (filled) filledCount += 1
    notes.push({
      label: target.label,
      valuePreview: previewAnswer(value),
      filled,
      skippedReason: filled ? undefined : "Could not set Ashby field value.",
    })
    if (filled) await sleep(70 + Math.round(Math.random() * 120))
  }

  const remaining = collectAshbyQuestionTargets(doc, { requiredOnly: true })
    .filter((target) => !isQuestionAnswered(target))
    .filter((target) => !deterministicAnswerFor(target, args.profile))
    .slice(0, 12)

  if (remaining.length > 0 && args.matchQuestions) {
    attemptedCount += remaining.length
    let answers: AshbyMatchedAnswer[] = []
    try {
      answers = await args.matchQuestions(remaining.map(toQuestionRequest))
    } catch {
      answers = []
    }
    const byId = new Map(answers.map((answer) => [answer.id, answer]))
    for (const target of remaining) {
      const answer = byId.get(target.id)
      const value = answer?.value ? normalizeText(answer.value) : ""
      if (!value || answer?.confidence === "low") {
        notes.push({
          label: target.label,
          filled: false,
          skippedReason: "Needs manual review.",
        })
        continue
      }
      const filled = applyAnswerToTarget(target, value)
      if (filled) filledCount += 1
      notes.push({
        label: target.label,
        valuePreview: previewAnswer(value),
        filled,
        skippedReason: filled ? undefined : "Could not set Ashby field value.",
      })
      if (filled) await sleep(70 + Math.round(Math.random() * 120))
    }
  } else {
    for (const target of remaining) {
      notes.push({
        label: target.label,
        filled: false,
        skippedReason: "Needs manual review.",
      })
    }
  }

  const manualReviewCount = collectAshbyQuestionTargets(doc, { requiredOnly: true })
    .filter((target) => !isQuestionAnswered(target))
    .length

  return { attemptedCount, filledCount, manualReviewCount, notes }
}

function previewAnswer(value: string): string {
  if (/^(yes|no)$/i.test(value)) return value.toLowerCase() === "yes" ? "Yes" : "No"
  return value.length > 80 ? `${value.slice(0, 77)}...` : value
}

function toQuestionRequest(target: AshbyQuestionTarget): AshbyQuestionRequest {
  return {
    id: target.id,
    label: target.label,
    type: target.type,
    ...(target.options?.length ? { options: target.options } : {}),
  }
}

function collectAshbyQuestionTargets(
  doc: Document,
  opts: { requiredOnly: boolean },
): AshbyQuestionTarget[] {
  const rows = collectAshbyRows(doc)
  const targets: AshbyQuestionTarget[] = []
  const seenLabels = new Set<string>()

  for (const row of rows) {
    if (!isElementUsable(row)) continue
    const label = getQuestionLabel(row)
    if (!label || isSensitiveAshbyQuestion(label)) continue
    const controls = getControlsForRow(row)
    if (controls.length === 0) continue
    if (controls.some((el) => el instanceof HTMLInputElement && el.type === "file")) continue
    if (opts.requiredOnly && !hasRequiredSignal(row, controls, doc)) continue

    const target = buildQuestionTarget(row, label, controls)
    if (!target) continue
    const key = normalizeKey(target.label)
    if (seenLabels.has(key)) continue
    seenLabels.add(key)
    targets.push(target)
  }

  return targets
}

function isSensitiveAshbyQuestion(label: string): boolean {
  const normalized = normalizeKey(label)
  if (/\bredact\b|\bage identifying\b|\bcandidate privacy\b|\bprivacy notice\b/.test(normalized)) {
    return false
  }
  return SENSITIVE_QUESTION_RE.test(label)
}

function collectAshbyRows(doc: Document): HTMLElement[] {
  const root = findAshbyRoot(doc) ?? doc.body
  const controls = Array.from(root.querySelectorAll<HTMLElement>(FORM_CONTROL_SELECTOR))
    .filter(isElementUsable)
  const seen = new Set<HTMLElement>()
  const rows: HTMLElement[] = []

  for (const control of controls) {
    const row = findRowForControl(control)
    if (!row || seen.has(row)) continue
    seen.add(row)
    rows.push(row)
  }

  return rows
}

function findAshbyRoot(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(
    "._ashby-application-form, ._ashby-application-form-container form, form[action*='ashby'], form[action*='ashbyhq'], form[data-testid*='apply'], form",
  )
}

function findRowForControl(control: HTMLElement): HTMLElement | null {
  let fallback: HTMLElement | null = control.parentElement
  let node: HTMLElement | null = control.parentElement
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    const className = typeof node.className === "string" ? node.className : ""
    const controls = node.querySelectorAll(FORM_CONTROL_SELECTOR).length
    if (/fieldentry|field-entry|application-question|form-field|question/i.test(className)) return node
    if (controls > 1 && node.querySelector("legend, label, [class*='label' i]")) return node
    if (controls === 1 && node.querySelector("label, [class*='label' i]")) fallback = node
    if (controls > 8) break
  }
  return fallback
}

function getControlsForRow(row: HTMLElement): HTMLElement[] {
  const controls = Array.from(row.querySelectorAll<HTMLElement>(FORM_CONTROL_SELECTOR))
    .filter(isElementUsable)

  const roleControls = Array.from(
    row.querySelectorAll<HTMLElement>(
      "[role='radio'], [role='checkbox'], [role='option'], button, [aria-pressed]",
    ),
  )
    .filter(isElementUsable)
    .filter((el) => {
      const text = normalizeText(el.textContent)
      if (!text) return false
      if (/submit|apply|continue|next|upload file/i.test(text)) return false
      return true
    })

  return [...controls, ...roleControls]
}

function getQuestionLabel(row: HTMLElement): string {
  const legend = row.querySelector<HTMLElement>("legend")
  if (legend?.textContent) return cleanLabel(legend.textContent)

  const labels = Array.from(row.querySelectorAll<HTMLElement>("label, [class*='label' i], [data-testid*='label' i]"))
  for (const label of labels) {
    if (label.querySelector("input, select, textarea")) continue
    const text = cleanLabel(label.textContent)
    if (text) return text
  }

  const text = cleanLabel(row.textContent)
  if (!text) return ""
  return text
    .replace(/\b(Yes|No|Prefer not to answer|Select|Choose)\b\s*$/gi, "")
    .trim()
}

function hasRequiredSignal(row: HTMLElement, controls: HTMLElement[], doc: Document): boolean {
  if (controls.some((control) => control.hasAttribute("required") || control.getAttribute("aria-required") === "true")) {
    return true
  }
  if (
    controls.some((control) => control.getAttribute("aria-invalid") === "true") &&
    /\b(required|missing|blank|empty|invalid|must|please)\b/i.test(row.textContent ?? "")
  ) {
    return true
  }
  if (/\*/.test(row.textContent ?? "")) return true
  const missing = missingRequiredLabels(doc)
  if (missing.length === 0) return false
  const labelKey = normalizeKey(getQuestionLabel(row))
  return missing.some((item) => item.includes(labelKey) || labelKey.includes(item))
}

function missingRequiredLabels(doc: Document): string[] {
  const text = normalizeText(doc.body?.textContent ?? "")
  if (!/missing entry for required field/i.test(text)) return []
  return text
    .split(/missing entry for required field\s*:/i)
    .slice(1)
    .map((part) => normalizeKey(part.split(" Missing entry for required field")[0] ?? part).slice(0, 220))
    .filter(Boolean)
}

function buildQuestionTarget(
  row: HTMLElement,
  label: string,
  controls: HTMLElement[],
): AshbyQuestionTarget | null {
  const nativeControls = controls.filter((el): el is FormControlElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement,
  )

  const radios = nativeControls.filter((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === "radio",
  )
  if (radios.length > 0) {
    const options = dedupe(radios.map((radio) => getOptionLabel(radio, row)).filter(Boolean))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options,
      row,
      controls: radios,
      kind: "radio",
    }
  }

  const roleOptions = controls.filter((el) => {
    const role = el.getAttribute("role")
    return role === "radio" || role === "option" || el.tagName.toLowerCase() === "button" || el.hasAttribute("aria-pressed")
  })
  if (roleOptions.length > 0 && !nativeControls.some((el) => el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type))) {
    const options = dedupe(roleOptions.map((option) => cleanLabel(option.textContent)).filter(Boolean))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options,
      row,
      controls: roleOptions,
      kind: "button",
    }
  }

  const select = nativeControls.find((el): el is HTMLSelectElement => el instanceof HTMLSelectElement)
  if (select) {
    const options = Array.from(select.options)
      .map((option) => normalizeText(option.textContent || option.value))
      .filter((option) => option && !/^select|choose|--$/i.test(option))
    return {
      id: buildTargetId(row, label),
      label,
      type: isYesNoOptions(options) ? "yesno" : "select",
      options: dedupe(options),
      row,
      controls: [select],
      kind: "select",
    }
  }

  const checkbox = nativeControls.find((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === "checkbox",
  )
  if (checkbox) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "yesno",
      options: ["Yes", "No"],
      row,
      controls: [checkbox],
      kind: "checkbox",
    }
  }

  const textarea = nativeControls.find((el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement)
  if (textarea) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "textarea",
      row,
      controls: [textarea],
      kind: "textarea",
    }
  }

  const input = nativeControls.find((el): el is HTMLInputElement =>
    el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.type ?? "").toLowerCase()),
  )
  if (input) {
    return {
      id: buildTargetId(row, label),
      label,
      type: "text",
      row,
      controls: [input],
      kind: "text",
    }
  }

  return null
}

function buildTargetId(row: HTMLElement, label: string): string {
  const control = row.querySelector<HTMLElement>(FORM_CONTROL_SELECTOR)
  const raw = control?.id || control?.getAttribute("name") || label
  return `ashby:${normalizeKey(raw).slice(0, 90)}`
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = cleanLabel(value)
    if (!clean) continue
    const key = normalizeKey(clean)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function isYesNoOptions(options: string[] | undefined): boolean {
  if (!options || options.length === 0) return false
  const keys = options.map((option) => normalizeKey(option))
  return keys.some((key) => key === "yes" || key === "y") && keys.some((key) => key === "no" || key === "n")
}

function getOptionLabel(input: HTMLInputElement, row: HTMLElement): string {
  if (input.id) {
    const lbl = input.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${cssEscape(input.id)}"]`)
    if (lbl?.textContent) return cleanLabel(lbl.textContent)
  }
  const wrapping = input.closest("label")
  if (wrapping?.textContent) {
    const text = cleanLabel(wrapping.textContent)
    if (text && normalizeKey(text) !== normalizeKey(getQuestionLabel(row))) return text
  }
  const aria = input.getAttribute("aria-label")
  if (aria) return cleanLabel(aria)
  return cleanLabel(input.value)
}

function isQuestionAnswered(target: AshbyQuestionTarget): boolean {
  if (target.kind === "text" || target.kind === "textarea") {
    const control = target.controls[0] as HTMLInputElement | HTMLTextAreaElement | undefined
    return Boolean(normalizeText(control?.value))
  }
  if (target.kind === "select") {
    const select = target.controls[0] as HTMLSelectElement | undefined
    if (!select) return false
    const selected = select.options[select.selectedIndex]
    const label = normalizeText(selected?.textContent || selected?.value)
    return Boolean(normalizeText(select.value)) && !/^select|choose|--$/i.test(label)
  }
  if (target.kind === "radio") {
    return target.controls.some((control) => control instanceof HTMLInputElement && control.checked)
  }
  if (target.kind === "checkbox") {
    return target.controls.some((control) => control instanceof HTMLInputElement && control.checked)
  }
  return target.controls.some((control) =>
    control.getAttribute("aria-checked") === "true" ||
    control.getAttribute("aria-selected") === "true" ||
    control.getAttribute("aria-pressed") === "true",
  )
}

function deterministicAnswerFor(target: AshbyQuestionTarget, profile: SafeProfile): string | null {
  const label = target.label
  const key = normalizeKey(label)

  if (/\b(full name|candidate name)\b|^name$/.test(key)) return fullName(profile)
  if (/\bemail\b/.test(key)) return normalizeText(profile.email) || null
  if (/\bphone\b|\bmobile\b|\btelephone\b/.test(key)) return normalizeText(profile.phone) || null
  if (/\blocation\b|\bcity\b/.test(key)) return locationValue(profile)
  if (/\bwhere have you most recently worked\b|\bmost recent(ly)? worked\b|\bcurrent employer\b/.test(key)) {
    return currentCompany(profile)
  }

  if (/\bprivacy notice\b|\bprocess your personal information\b|\bcandidate privacy\b/.test(key)) {
    return "yes"
  }
  if (/\b(agree|accept|acknowledge|consent|certify|confirm)\b/.test(key) && target.kind === "checkbox") {
    return "yes"
  }
  if (/\bredact\b|\bage identifying\b|\bschool attendance\b|\bgraduation\b/.test(key)) {
    return "yes"
  }

  if (/\bsponsorship\b|\bwork authorization status\b/.test(key)) {
    if (profile.requires_sponsorship === true) return "yes"
    if (profile.requires_sponsorship === false) return "no"
    return null
  }
  if (/\bauthorized to work\b|\blegally authorized\b|\bauthorised to work\b/.test(key)) {
    if (profile.authorized_to_work === true) return "yes"
    if (profile.authorized_to_work === false) return "no"
    return null
  }

  if (/\bsnowflake\b/.test(key) && /\b(worked|employee|employed|past|previous)\b/.test(key)) {
    return hasCompany(profile, /\bsnowflake\b/i) ? "yes" : "no"
  }
  if (/\b(pricewaterhousecoopers|pwc)\b/.test(key)) {
    return hasCompany(profile, /\b(pricewaterhousecoopers|pwc)\b/i) ? "yes" : "no"
  }
  if (
    /\bgovernment\b|\bmilitary\b|\bstate owned\b|\bpublicly funded\b|\bprocurement\b/.test(key) &&
    profileHasWorkHistory(profile)
  ) {
    const governmentLike = /\b(government|military|army|navy|air force|department of|ministry|state owned|publicly funded)\b/i
    return hasCompany(profile, governmentLike) ? "yes" : "no"
  }

  return null
}

function applyAnswerToTarget(target: AshbyQuestionTarget, value: string): boolean {
  if (target.kind === "text" || target.kind === "textarea") {
    const control = target.controls[0]
    return control ? setReactValue(control, value) : false
  }
  if (target.kind === "checkbox") {
    const control = target.controls[0]
    return control instanceof HTMLInputElement ? setReactChecked(control, normalizeKey(value) !== "no") : false
  }
  if (target.kind === "select") {
    const select = target.controls[0]
    if (!(select instanceof HTMLSelectElement)) return false
    const option = findMatchingOption(
      Array.from(select.options).map((item) => ({
        value: item.value,
        label: normalizeText(item.textContent || item.value),
      })),
      value,
    )
    if (!option) return false
    return setReactValue(select, option.value)
  }

  const option = findMatchingOption(
    target.controls.map((control) => ({
      value: control instanceof HTMLInputElement ? control.value : normalizeText(control.textContent),
      label: control instanceof HTMLInputElement ? getOptionLabel(control, target.row) : cleanLabel(control.textContent),
      control,
    })),
    value,
  )
  if (!option?.control) return false
  if (option.control instanceof HTMLInputElement) {
    return setReactChecked(option.control, true)
  }
  try {
    option.control.scrollIntoView({ block: "center", inline: "nearest" })
  } catch {
    // best-effort
  }
  option.control.click()
  option.control.dispatchEvent(new Event("input", { bubbles: true }))
  option.control.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}

function findMatchingOption<T extends { value: string; label: string }>(
  options: T[],
  desired: string,
): T | null {
  const key = normalizeKey(desired)
  const yesNo = key === "yes" || key === "y" || key === "true"
    ? "yes"
    : key === "no" || key === "n" || key === "false"
      ? "no"
      : null
  const candidates = options.filter((option) => normalizeText(option.label) || normalizeText(option.value))
  if (yesNo) {
    const exact = candidates.find((option) => normalizeKey(option.label) === yesNo || normalizeKey(option.value) === yesNo)
    if (exact) return exact
  }
  return (
    candidates.find((option) => normalizeKey(option.label) === key || normalizeKey(option.value) === key) ??
    candidates.find((option) => normalizeKey(option.label).includes(key) || key.includes(normalizeKey(option.label))) ??
    null
  )
}

function setReactChecked(input: HTMLInputElement, checked: boolean): boolean {
  try {
    input.focus({ preventScroll: true })
  } catch {
    // best-effort
  }
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set
    if (setter) setter.call(input, checked)
    else input.checked = checked
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.dispatchEvent(new Event("blur", { bubbles: true }))
    return input.checked === checked
  } catch {
    return false
  }
}
