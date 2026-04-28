/**
 * Autofill Form Detector
 *
 * Scans the current page for application form fields,
 * matches them to a profile, and returns a normalized field map.
 *
 * Safety: read-only. Never fills or submits anything.
 */

import type { ATSProvider } from "../types"

// ── Types ──────────────────────────────────────────────────────────────────────

export type FieldInputType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "select"
  | "checkbox"
  | "radio"
  | "textarea"
  | "file"
  | "number"
  | "date"

export interface DetectedField {
  /** Unique reference to re-find this element for filling */
  elementRef: string
  /** Human-readable label from the form */
  label: string
  /** HTML input type */
  type: FieldInputType
  /** Current value in the field */
  currentValue: string
  /** Value we'll suggest from the profile */
  detectedValue: string
  /** 0–1 confidence this is the right profile value */
  confidence: number
  /** Which profile key we matched against */
  suggestedProfileKey: string | null
  /** True if the user should review before filling */
  needsReview: boolean
}

export interface FormDetectionResult {
  formFound: boolean
  ats: ATSProvider | "generic"
  fields: DetectedField[]
}

// ── Safe profile (subset returned by /api/extension/autofill-profile) ─────────

export interface ExtensionSafeProfile {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  website_url: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  address_line1: string | null
  address_line2: string | null
  authorized_to_work: boolean | null
  requires_sponsorship: boolean | null
  sponsorship_statement: string | null
  work_authorization: string | null
  years_of_experience: number | null
  salary_expectation_min: number | null
  salary_expectation_max: number | null
  earliest_start_date: string | null
  willing_to_relocate: boolean | null
  highest_degree: string | null
  field_of_study: string | null
  university: string | null
  graduation_year: number | null
  gpa: string | null
  preferred_work_type: string | null
}

// ── Field matching patterns ────────────────────────────────────────────────────

interface FieldPattern {
  profileKey: keyof ExtensionSafeProfile
  patterns: RegExp[]
  /** Restrict match to specific input types */
  inputTypes?: FieldInputType[]
  /** Whether this field type requires user review */
  alwaysReview?: boolean
  /** Derive string value from the profile entry */
  getValue: (profile: ExtensionSafeProfile) => string
}

const FIELD_PATTERNS: FieldPattern[] = [
  {
    profileKey: "first_name",
    patterns: [/first[_\s-]?name/i, /fname/i, /given[_\s-]?name/i, /\bfirst\b/i],
    getValue: (p) => p.first_name ?? "",
  },
  {
    profileKey: "last_name",
    patterns: [/last[_\s-]?name/i, /lname/i, /family[_\s-]?name/i, /surname/i, /\blast\b/i],
    getValue: (p) => p.last_name ?? "",
  },
  {
    profileKey: "email",
    patterns: [/e[_\s-]?mail/i, /email[_\s-]?address/i],
    inputTypes: ["email", "text"],
    getValue: (p) => p.email ?? "",
  },
  {
    profileKey: "phone",
    patterns: [/phone/i, /mobile/i, /\bcell\b/i, /telephone/i, /contact[_\s-]?number/i, /phone[_\s-]?number/i],
    inputTypes: ["tel", "text"],
    getValue: (p) => p.phone ?? "",
  },
  {
    profileKey: "linkedin_url",
    patterns: [/linkedin/i, /linked[_\s-]?in/i, /linkedin[_\s-]?url/i, /linkedin[_\s-]?profile/i],
    inputTypes: ["url", "text"],
    getValue: (p) => p.linkedin_url ?? "",
  },
  {
    profileKey: "github_url",
    patterns: [/github/i, /git[_\s-]?hub/i, /github[_\s-]?url/i, /github[_\s-]?profile/i],
    inputTypes: ["url", "text"],
    getValue: (p) => p.github_url ?? "",
  },
  {
    profileKey: "portfolio_url",
    patterns: [/portfolio/i, /personal[_\s-]?site/i, /portfolio[_\s-]?url/i, /personal[_\s-]?website/i, /\bwebsite\b/i],
    inputTypes: ["url", "text"],
    getValue: (p) => p.portfolio_url ?? p.website_url ?? "",
  },
  {
    profileKey: "address_line1",
    patterns: [/address[_\s-]?line[_\s-]?1/i, /\baddress\b/i, /street[_\s-]?address/i, /mailing[_\s-]?address/i],
    getValue: (p) => p.address_line1 ?? "",
  },
  {
    profileKey: "address_line2",
    patterns: [/address[_\s-]?line[_\s-]?2/i, /apartment/i, /\bapt\b/i, /suite/i, /\bunit\b/i],
    getValue: (p) => p.address_line2 ?? "",
  },
  {
    profileKey: "city",
    patterns: [/\bcity\b/i, /\btown\b/i, /municipality/i],
    getValue: (p) => p.city ?? "",
  },
  {
    profileKey: "state",
    patterns: [/\bstate\b/i, /\bprovince\b/i, /\bregion\b/i],
    getValue: (p) => p.state ?? "",
  },
  {
    profileKey: "zip_code",
    patterns: [/\bzip\b/i, /postal/i, /zip[_\s-]?code/i, /postcode/i],
    getValue: (p) => p.zip_code ?? "",
  },
  {
    profileKey: "country",
    patterns: [/\bcountry\b/i, /country[_\s-]?of[_\s-]?residence/i],
    getValue: (p) => p.country ?? "",
  },
  {
    profileKey: "authorized_to_work",
    patterns: [
      /authorized[_\s-]?to[_\s-]?work/i,
      /eligible[_\s-]?to[_\s-]?work/i,
      /legally[_\s-]?authorized/i,
      /work[_\s-]?authoriz/i,
    ],
    alwaysReview: true,
    getValue: (p) => (p.authorized_to_work === true ? "Yes" : p.authorized_to_work === false ? "No" : ""),
  },
  {
    profileKey: "requires_sponsorship",
    patterns: [
      /require[_\s-]?sponsor/i,
      /need[_\s-]?sponsor/i,
      /visa[_\s-]?sponsor/i,
      /h[_\s-]?1[_\s-]?b/i,
      /future[_\s-]?sponsor/i,
    ],
    alwaysReview: true,
    getValue: (p) =>
      p.requires_sponsorship === true ? "Yes" : p.requires_sponsorship === false ? "No" : "",
  },
  {
    profileKey: "sponsorship_statement",
    patterns: [/sponsor.*detail/i, /authoriz.*explain/i, /additional.*visa/i, /work.*auth.*comment/i],
    getValue: (p) => p.sponsorship_statement ?? "",
  },
  {
    profileKey: "work_authorization",
    patterns: [/work[_\s-]?authorization/i, /visa[_\s-]?status/i, /immigration[_\s-]?status/i, /authorization[_\s-]?type/i],
    alwaysReview: true,
    getValue: (p) => p.work_authorization ?? "",
  },
  {
    profileKey: "years_of_experience",
    patterns: [
      /years[_\s-]?of[_\s-]?exp/i,
      /experience[_\s-]?years/i,
      /how[_\s-]?many[_\s-]?years/i,
      /total[_\s-]?experience/i,
      /years.*relevant/i,
    ],
    getValue: (p) => (p.years_of_experience != null ? String(p.years_of_experience) : ""),
  },
  {
    profileKey: "salary_expectation_min",
    patterns: [/salary/i, /compensation/i, /expected[_\s-]?salary/i, /desired[_\s-]?salary/i, /pay[_\s-]?expect/i],
    getValue: (p) => {
      if (p.salary_expectation_min && p.salary_expectation_max)
        return `$${p.salary_expectation_min.toLocaleString()} - $${p.salary_expectation_max.toLocaleString()}`
      if (p.salary_expectation_min) return `$${p.salary_expectation_min.toLocaleString()}`
      return ""
    },
  },
  {
    profileKey: "earliest_start_date",
    patterns: [/start[_\s-]?date/i, /available.*start/i, /notice[_\s-]?period/i, /when.*start/i, /earliest.*available/i],
    getValue: (p) => p.earliest_start_date ?? "",
  },
  {
    profileKey: "willing_to_relocate",
    patterns: [/relocat/i, /willing[_\s-]?to[_\s-]?move/i, /open[_\s-]?to[_\s-]?reloc/i],
    getValue: (p) =>
      p.willing_to_relocate === true ? "Yes" : p.willing_to_relocate === false ? "No" : "",
  },
  {
    profileKey: "preferred_work_type",
    patterns: [/work[_\s-]?type/i, /work[_\s-]?arrangement/i, /remote.*onsite/i, /work.*location.*prefer/i],
    getValue: (p) => p.preferred_work_type ?? "",
  },
  {
    profileKey: "highest_degree",
    patterns: [/\bdegree\b/i, /education[_\s-]?level/i, /highest[_\s-]?edu/i, /academic[_\s-]?level/i],
    getValue: (p) => p.highest_degree ?? "",
  },
  {
    profileKey: "field_of_study",
    patterns: [/field[_\s-]?of[_\s-]?study/i, /\bmajor\b/i, /area[_\s-]?of[_\s-]?study/i, /concentration/i],
    getValue: (p) => p.field_of_study ?? "",
  },
  {
    profileKey: "university",
    patterns: [/university/i, /college/i, /\bschool\b/i, /institution/i, /alma[_\s-]?mater/i],
    getValue: (p) => p.university ?? "",
  },
  {
    profileKey: "graduation_year",
    patterns: [/grad[_\s-]?year/i, /graduation[_\s-]?year/i, /class[_\s-]?of/i, /year[_\s-]?graduated/i],
    getValue: (p) => (p.graduation_year != null ? String(p.graduation_year) : ""),
  },
  {
    profileKey: "gpa",
    patterns: [/\bgpa\b/i, /grade[_\s-]?point/i, /academic.*average/i, /cumulative.*gpa/i],
    getValue: (p) => p.gpa ?? "",
  },
]

// These are resume/cover letter upload fields — flag them but never auto-fill
const RESUME_PATTERNS = [/resume/i, /curriculum[_\s-]?vitae/i, /\bcv\b/i]
const COVER_LETTER_PATTERNS = [/cover[_\s-]?letter/i, /coverletter/i]

// ── ATS-specific form container selectors ──────────────────────────────────────

const ATS_FORM_SELECTORS: Record<string, string[]> = {
  greenhouse: ["#grnhse_app", "form[action*='greenhouse']", ".greenhouse-application"],
  lever: [".lever-apply-form", "[data-lever-apply]", "form[action*='lever']"],
  ashby: ["._ashby-application-form", "form[data-testid*='apply']", "._ashby-application-form-container form"],
  workday: ["[data-automation-id='applicationSummaryStep']", "form[data-automation-id]"],
  icims: ["#icims_content form", ".iCIMS_Content form"],
  smartrecruiters: [".sr-apply-step", ".smartrecruiters-widget form"],
  bamboohr: ["#bamboohr-apply", ".BambooHR-ATS form"],
  generic: [
    "form[action*='apply']",
    "form[id*='apply']",
    "form[class*='apply']",
    "[id*='application-form']",
    "[class*='application-form']",
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findFormElement(ats: ATSProvider | "generic"): HTMLFormElement | HTMLElement | null {
  const selectors = [
    ...(ATS_FORM_SELECTORS[ats] ?? []),
    ...ATS_FORM_SELECTORS.generic,
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el as HTMLElement
  }
  // Fallback: find any form with inputs
  const forms = Array.from(document.querySelectorAll("form"))
  const withInputs = forms.find((f) => f.querySelectorAll("input, select, textarea").length > 3)
  return withInputs ?? null
}

function getLabelText(el: HTMLElement, form: HTMLElement): string {
  const id = el.id
  if (id) {
    const label = form.querySelector(`label[for="${id}"]`) ?? document.querySelector(`label[for="${id}"]`)
    if (label) return label.textContent?.trim() ?? ""
  }

  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) return ariaLabel.trim()

  const ariaLabelledby = el.getAttribute("aria-labelledby")
  if (ariaLabelledby) {
    const labelled = document.getElementById(ariaLabelledby)
    if (labelled) return labelled.textContent?.trim() ?? ""
  }

  const title = el.getAttribute("title")
  if (title) return title.trim()

  const placeholder = el.getAttribute("placeholder")
  if (placeholder) return placeholder.trim()

  // Check for wrapping label
  const parent = el.closest("label")
  if (parent) {
    const clone = parent.cloneNode(true) as HTMLElement
    const inputs = clone.querySelectorAll("input, select, textarea")
    inputs.forEach((i) => i.remove())
    return clone.textContent?.trim() ?? ""
  }

  // Check previous sibling text
  let prev = el.previousElementSibling
  while (prev) {
    const text = prev.textContent?.trim()
    if (text && text.length > 0 && text.length < 80) return text
    prev = prev.previousElementSibling
  }

  return (el as HTMLInputElement).name ?? el.id ?? ""
}

function makeElementRef(el: HTMLElement, index: number): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const name = (el as HTMLInputElement).name
  if (name) return `[name="${name}"]`
  const tagName = el.tagName.toLowerCase()
  return `${tagName}:nth-of-type(${index + 1})`
}

function getInputType(el: HTMLElement): FieldInputType {
  const tag = el.tagName.toLowerCase()
  if (tag === "select") return "select"
  if (tag === "textarea") return "textarea"
  const type = ((el as HTMLInputElement).type ?? "text").toLowerCase()
  const validTypes: FieldInputType[] = ["text", "email", "tel", "url", "checkbox", "radio", "file", "number", "date"]
  return validTypes.includes(type as FieldInputType) ? (type as FieldInputType) : "text"
}

function getCurrentValue(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  if (tag === "select") {
    return (el as HTMLSelectElement).value ?? ""
  }
  if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio") {
    return (el as HTMLInputElement).checked ? "true" : "false"
  }
  return (el as HTMLInputElement | HTMLTextAreaElement).value ?? ""
}

// ── Core detection ────────────────────────────────────────────────────────────

function matchField(
  label: string,
  name: string,
  id: string,
  inputType: FieldInputType,
  profile: ExtensionSafeProfile
): { profileKey: string; value: string; confidence: number; needsReview: boolean } | null {
  const combined = [label, name, id].join(" ").toLowerCase().replace(/[_-]/g, " ").trim()
  if (!combined) return null

  let best: { profileKey: string; value: string; confidence: number; needsReview: boolean } | null = null

  for (const fp of FIELD_PATTERNS) {
    // Skip if input type doesn't match
    if (fp.inputTypes && !fp.inputTypes.includes(inputType)) continue

    for (const pattern of fp.patterns) {
      if (pattern.test(combined)) {
        const value = fp.getValue(profile)
        if (!value) break // Profile missing this key

        // Exact id or name match → high confidence
        const exactMatch =
          new RegExp(`^(${pattern.source})$`, "i").test(name) ||
          new RegExp(`^(${pattern.source})$`, "i").test(id)
        const confidence = exactMatch ? 1.0 : 0.8

        if (!best || confidence > best.confidence) {
          best = {
            profileKey: fp.profileKey,
            value,
            confidence,
            needsReview: fp.alwaysReview ?? confidence < 0.8,
          }
        }
        break
      }
    }
  }

  return best
}

export function detectFormFields(
  profile: ExtensionSafeProfile,
  ats: ATSProvider | "generic" = "generic"
): FormDetectionResult {
  const formEl = findFormElement(ats)
  if (!formEl) {
    return { formFound: false, ats, fields: [] }
  }

  const inputs = Array.from(
    formEl.querySelectorAll<HTMLElement>("input, select, textarea")
  ).filter((el) => {
    const type = ((el as HTMLInputElement).type ?? "").toLowerCase()
    // Skip hidden, submit, button, image, reset
    return !["hidden", "submit", "button", "image", "reset"].includes(type)
  })

  const fields: DetectedField[] = []

  inputs.forEach((el, index) => {
    const inputType = getInputType(el)
    const id = el.id ?? ""
    const name = (el as HTMLInputElement).name ?? ""
    const label = getLabelText(el, formEl)
    const currentValue = getCurrentValue(el)
    const elementRef = makeElementRef(el, index)

    // Check resume/cover letter upload fields — flag but never auto-fill
    const combinedText = [label, name, id].join(" ").toLowerCase()
    if (inputType === "file") {
      if (RESUME_PATTERNS.some((p) => p.test(combinedText))) {
        fields.push({
          elementRef,
          label: label || "Resume upload",
          type: "file",
          currentValue,
          detectedValue: "",
          confidence: 0,
          suggestedProfileKey: "resume",
          needsReview: true,
        })
      } else if (COVER_LETTER_PATTERNS.some((p) => p.test(combinedText))) {
        fields.push({
          elementRef,
          label: label || "Cover letter",
          type: "file",
          currentValue,
          detectedValue: "",
          confidence: 0,
          suggestedProfileKey: "cover_letter",
          needsReview: true,
        })
      }
      return // Never auto-fill file inputs
    }

    const match = matchField(label, name, id, inputType, profile)
    if (!match) return // Skip unrecognized fields

    fields.push({
      elementRef,
      label: label || name || id,
      type: inputType,
      currentValue,
      detectedValue: match.value,
      confidence: match.confidence,
      suggestedProfileKey: match.profileKey,
      needsReview: match.needsReview,
    })
  })

  return { formFound: true, ats, fields }
}
