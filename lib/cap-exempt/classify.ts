// Cap-exempt classifier (INA 214(g)(5)). Pure function over data we actually have on
// companies: name, industry, domain. (No naics_code / is_nonprofit columns exist, so the
// NAICS and nonprofit-confirmation branches from the spec are intentionally omitted —
// affiliated-nonprofit/hospital detection needs an authoritative list, deferred.)
// Conservative by design: a false cap-exempt flag is worse than a miss.

export type CapExemptReason = "university" | "govt_research" | "nonprofit_research"
export type CapExemptConfidence = "high" | "medium" | "low"

export interface CapExemptResult {
  is_cap_exempt: boolean
  reason: CapExemptReason | null
  confidence: CapExemptConfidence | null
  source: string | null
}

const NOT_EXEMPT: CapExemptResult = {
  is_cap_exempt: false,
  reason: null,
  confidence: null,
  source: null,
}

const FEDERAL_LAB_PATTERNS: RegExp[] = [
  /national laborator/i,
  /\bnational lab\b/i,
  /\b(nih|nasa|noaa|nist)\b/i,
  /\b(argonne|brookhaven|lawrence livermore|los alamos|oak ridge|sandia|fermilab|jet propulsion)\b/i,
]

export function classifyCapExempt(company: {
  name: string
  industry: string | null
  domain: string | null
}): CapExemptResult {
  const name = (company.name ?? "").toLowerCase()
  const domain = (company.domain ?? "").toLowerCase()
  const industry = (company.industry ?? "").toLowerCase()

  // HIGH — .edu domain is authoritative for higher education.
  if (domain.endsWith(".edu")) {
    return { is_cap_exempt: true, reason: "university", confidence: "high", source: "edu_domain" }
  }

  // HIGH — federal research labs.
  if (FEDERAL_LAB_PATTERNS.some((p) => p.test(name))) {
    return { is_cap_exempt: true, reason: "govt_research", confidence: "high", source: "federal_lab_pattern" }
  }

  // HIGH — unambiguous higher-ed name tokens.
  if (/\b(university|universities)\b/.test(name) || /\binstitute of technology\b/.test(name) || /\bcommunity college\b/.test(name)) {
    return { is_cap_exempt: true, reason: "university", confidence: "high", source: "name_heuristic" }
  }

  // MEDIUM — "College" alone (some for-profit/company uses of the word) or an education industry.
  if (/\bcollege\b/.test(name) || /higher education|colleges? & universities|university/.test(industry)) {
    return { is_cap_exempt: true, reason: "university", confidence: "medium", source: "name_or_industry" }
  }

  // LOW — research-mission name signal (can't confirm nonprofit status). Requires both a
  // "research" token and an institute/foundation/lab token, in any order. Carries the
  // "verify with employer" disclaimer in the UI.
  if (/\bresearch\b/.test(name) && /\b(institute|foundation|laborator)/.test(name)) {
    return { is_cap_exempt: true, reason: "nonprofit_research", confidence: "low", source: "research_name_heuristic" }
  }

  return NOT_EXEMPT
}
