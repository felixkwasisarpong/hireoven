/**
 * Autofill Intelligence Layer — V1
 *
 * Enriches raw DetectedField[] with status, source, risk level, and smart
 * warnings. Runs entirely client-side — no API calls, no profile data sent.
 *
 * Input:  DetectedField[] from form-detector (already matched to profile keys)
 * Output: AutofillIntelligenceResult — grouped, annotated, ready to render
 */

import type { DetectedField } from "./form-detector"

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutofillFieldStatus =
  | "ready"          // high confidence, low risk, value present
  | "review_needed"  // medium confidence or medium risk — user should verify
  | "missing_data"   // profile has no value for this field
  | "sensitive"      // legal/demographic/visa — must not auto-fill silently
  | "unsupported"    // file upload or unknown type — manual only

export type AutofillFieldSource =
  | "profile"        // came from autofill profile directly
  | "cover_letter"   // AI-generated or manual cover letter
  | "manual"         // requires user action (file upload)
  | "derived"        // computed from multiple profile fields (e.g. full name)

export type AutofillRiskLevel = "low" | "medium" | "high"

export type AutofillFieldCategory =
  | "contact"        // name, email, phone, URLs
  | "location"       // address, city, state, zip, country
  | "work"           // experience, start date, relocate, work type
  | "education"      // degree, major, university, GPA
  | "sponsorship"    // visa, work auth, sponsorship — HIGH RISK
  | "salary"         // salary expectations — MEDIUM RISK
  | "demographic"    // EEO fields — HIGH RISK, voluntary
  | "cover_letter"   // cover letter textarea
  | "resume_upload"  // file upload
  | "other"          // unrecognized

export type AutofillIntelligentField = {
  elementRef: string
  label: string
  type?: string
  value?: string
  confidence: number
  profileKey: string | null

  status: AutofillFieldStatus
  source: AutofillFieldSource
  riskLevel: AutofillRiskLevel
  category: AutofillFieldCategory
  notes: string[]
}

export type AutofillWarning = {
  level: "info" | "warning" | "blocker"
  message: string
}

export type AutofillReadinessState =
  | "ready"          // all fields ready or review_needed — can proceed
  | "needs_review"   // has review_needed or missing_data fields
  | "has_blockers"   // has sensitive or unsupported fields that must be addressed

export type AutofillIntelligenceResult = {
  fields: AutofillIntelligentField[]
  warnings: AutofillWarning[]
  guidanceSummary: string
  readiness: AutofillReadinessState
  counts: {
    ready: number
    review: number
    missing: number
    sensitive: number
    unsupported: number
  }
}

// ── Profile key metadata ──────────────────────────────────────────────────────

type FieldMeta = {
  category: AutofillFieldCategory
  riskLevel: AutofillRiskLevel
  source: AutofillFieldSource
}

const KEY_META: Record<string, FieldMeta> = {
  first_name:            { category: "contact",      riskLevel: "low",    source: "profile" },
  last_name:             { category: "contact",      riskLevel: "low",    source: "profile" },
  email:                 { category: "contact",      riskLevel: "low",    source: "profile" },
  phone:                 { category: "contact",      riskLevel: "low",    source: "profile" },
  linkedin_url:          { category: "contact",      riskLevel: "low",    source: "profile" },
  github_url:            { category: "contact",      riskLevel: "low",    source: "profile" },
  portfolio_url:         { category: "contact",      riskLevel: "low",    source: "profile" },
  website_url:           { category: "contact",      riskLevel: "low",    source: "profile" },

  address_line1:         { category: "location",     riskLevel: "low",    source: "profile" },
  address_line2:         { category: "location",     riskLevel: "low",    source: "profile" },
  city:                  { category: "location",     riskLevel: "low",    source: "profile" },
  state:                 { category: "location",     riskLevel: "low",    source: "profile" },
  zip_code:              { category: "location",     riskLevel: "low",    source: "profile" },
  country:               { category: "location",     riskLevel: "low",    source: "profile" },

  years_of_experience:   { category: "work",         riskLevel: "medium", source: "profile" },
  earliest_start_date:   { category: "work",         riskLevel: "medium", source: "profile" },
  willing_to_relocate:   { category: "work",         riskLevel: "low",    source: "profile" },
  preferred_work_type:   { category: "work",         riskLevel: "low",    source: "profile" },

  highest_degree:        { category: "education",    riskLevel: "low",    source: "profile" },
  field_of_study:        { category: "education",    riskLevel: "low",    source: "profile" },
  university:            { category: "education",    riskLevel: "low",    source: "profile" },
  graduation_year:       { category: "education",    riskLevel: "low",    source: "profile" },
  gpa:                   { category: "education",    riskLevel: "medium", source: "profile" },

  authorized_to_work:    { category: "sponsorship",  riskLevel: "high",   source: "profile" },
  requires_sponsorship:  { category: "sponsorship",  riskLevel: "high",   source: "profile" },
  work_authorization:    { category: "sponsorship",  riskLevel: "high",   source: "profile" },
  sponsorship_statement: { category: "sponsorship",  riskLevel: "high",   source: "profile" },

  salary_expectation_min: { category: "salary",      riskLevel: "medium", source: "profile" },

  gender:                { category: "demographic",  riskLevel: "high",   source: "profile" },
  ethnicity:             { category: "demographic",  riskLevel: "high",   source: "profile" },
  veteran_status:        { category: "demographic",  riskLevel: "high",   source: "profile" },
  disability_status:     { category: "demographic",  riskLevel: "high",   source: "profile" },

  cover_letter_text:     { category: "cover_letter", riskLevel: "medium", source: "cover_letter" },
  cover_letter:          { category: "resume_upload", riskLevel: "medium", source: "manual" },
  resume:                { category: "resume_upload", riskLevel: "low",    source: "manual" },
}

// ── Status resolution ─────────────────────────────────────────────────────────

function resolveStatus(field: DetectedField, meta: FieldMeta): AutofillFieldStatus {
  if (field.type === "file")                              return "unsupported"
  if (field.suggestedProfileKey === "cover_letter_text") return "review_needed"
  if (meta.riskLevel === "high")                         return "sensitive"
  if (!field.detectedValue)                              return "missing_data"
  if (field.needsReview || meta.riskLevel === "medium")  return "review_needed"
  if (field.confidence >= 0.8)                           return "ready"
  return "review_needed"
}

// ── Per-field notes ───────────────────────────────────────────────────────────

function buildNotes(field: DetectedField, meta: FieldMeta): string[] {
  const notes: string[] = []
  const key = field.suggestedProfileKey ?? ""

  if (key === "requires_sponsorship") {
    const val = field.detectedValue.toLowerCase()
    if (val === "yes") notes.push("Answering 'Yes' signals visa sponsorship need — confirm this is correct.")
    if (val === "no")  notes.push("Answering 'No' means you are already work-authorized in this country.")
  }

  if (key === "authorized_to_work") {
    notes.push("Legal authorization question — verify your answer is accurate.")
  }

  if (key === "salary_expectation_min") {
    notes.push("Verify this aligns with the role's offered range before submitting.")
  }

  if (meta.category === "demographic") {
    notes.push("EEO voluntary field. Answering is optional and used for compliance only.")
  }

  if (field.type === "file") {
    notes.push("File uploads require manual action — cannot be autofilled.")
  }

  if (field.confidence > 0 && field.confidence < 0.8) {
    notes.push("Lower confidence match — double-check the suggested value.")
  }

  return notes
}

// ── Guidance summary ──────────────────────────────────────────────────────────

function buildGuidance(
  counts: AutofillIntelligenceResult["counts"],
  categories: Set<AutofillFieldCategory>,
): string {
  if (categories.has("sponsorship")) {
    return "Visa sponsorship questions detected — review your answers carefully before filling."
  }
  if (categories.has("salary") && counts.review > 0) {
    return "Salary fields present — confirm your expected range aligns with this role."
  }
  if (counts.missing > 1) {
    return `${counts.missing} fields need manual input — check your profile is complete.`
  }
  if (categories.has("demographic")) {
    return "EEO voluntary fields detected — answering is optional and confidential."
  }
  if (counts.sensitive > 0) {
    return `${counts.sensitive} sensitive field${counts.sensitive > 1 ? "s" : ""} require your explicit review.`
  }
  if (counts.review > 0) {
    return `${counts.review} field${counts.review > 1 ? "s" : ""} need review before filling.`
  }
  if (counts.ready > 0) {
    return `${counts.ready} fields ready. Review values before clicking Fill.`
  }
  return "Review all fields carefully — no auto-submit ever happens."
}

// ── Global warnings ───────────────────────────────────────────────────────────

function buildWarnings(
  enriched: AutofillIntelligentField[],
): AutofillWarning[] {
  const warnings: AutofillWarning[] = []
  const cats = new Set(enriched.map((f) => f.category))
  const missingCount = enriched.filter((f) => f.status === "missing_data").length

  if (cats.has("sponsorship")) {
    warnings.push({
      level: "warning",
      message: "This application asks about visa sponsorship status.",
    })
  }
  if (cats.has("salary")) {
    warnings.push({
      level: "info",
      message: "Salary expectation may affect your application outcome.",
    })
  }
  if (cats.has("demographic")) {
    warnings.push({
      level: "info",
      message: "Voluntary EEO questions detected. Answering is entirely optional.",
    })
  }
  if (cats.has("resume_upload")) {
    warnings.push({
      level: "info",
      message: "Resume file upload requires manual attachment — not autofilled.",
    })
  }
  if (missingCount > 0) {
    warnings.push({
      level: missingCount > 2 ? "warning" : "info",
      message: `${missingCount} field${missingCount > 1 ? "s" : ""} not in your profile — fill manually.`,
    })
  }

  return warnings
}

// ── Main export ───────────────────────────────────────────────────────────────

export function enrichFields(fields: DetectedField[]): AutofillIntelligenceResult {
  const enriched: AutofillIntelligentField[] = fields.map((field) => {
    const key = field.suggestedProfileKey ?? ""
    const meta: FieldMeta = KEY_META[key] ?? {
      category: "other",
      riskLevel: "medium",
      source: "manual",
    }
    const status = resolveStatus(field, meta)
    const notes = buildNotes(field, meta)

    return {
      elementRef: field.elementRef,
      label: field.label,
      type: field.type,
      value: field.detectedValue || undefined,
      confidence: field.confidence,
      profileKey: field.suggestedProfileKey,
      status,
      source: field.type === "file" ? "manual" : meta.source,
      riskLevel: meta.riskLevel,
      category: meta.category,
      notes,
    }
  })

  const counts = {
    ready:       enriched.filter((f) => f.status === "ready").length,
    review:      enriched.filter((f) => f.status === "review_needed").length,
    missing:     enriched.filter((f) => f.status === "missing_data").length,
    sensitive:   enriched.filter((f) => f.status === "sensitive").length,
    unsupported: enriched.filter((f) => f.status === "unsupported").length,
  }

  const categories = new Set(enriched.map((f) => f.category))
  const warnings = buildWarnings(enriched)
  const guidanceSummary = buildGuidance(counts, categories)

  const readiness: AutofillReadinessState =
    counts.sensitive > 0 ? "has_blockers" :
    counts.missing > 0 || counts.review > 0 ? "needs_review" :
    "ready"

  return { fields: enriched, warnings, guidanceSummary, readiness, counts }
}
