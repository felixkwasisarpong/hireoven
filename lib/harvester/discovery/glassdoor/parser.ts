import {
  cleanCompanyDisplayName,
  dedupeCompanyCandidates,
  normalizeCompanyName,
} from "./name-normalization"

export type GlassdoorParsedCompany = {
  companyNameRaw: string
  companyNameNormalized: string
  sourceUrl: string
  sourceName: "glassdoor"
  discoveredSectorKeyword: string
  discoveredLocationKeyword: string
  metadata: Record<string, unknown>
}

export type ParseGlassdoorCompaniesInput = {
  html: string
  sourceUrl: string
  sectorKeyword: string
  locationKeyword: string
}

const COMPANY_LINK_RE =
  /<a\b(?=[^>]*href=["'][^"']*\/(?:Overview|Reviews)\/[^"']*["'])[^>]*>([\s\S]{0,600}?)<\/a>/gi

const DATA_TEST_NAME_RE =
  /<([a-z0-9:-]+)\b[^>]*(?:data-test|data-test-id)=["'](?:employer-name|employerName|company-name|companyName)["'][^>]*>([\s\S]{0,600}?)<\/\1>/gi

const JSON_NAME_PATTERNS = [
  /"employerName"\s*:\s*"((?:\\.|[^"\\])+)"/g,
  /"companyName"\s*:\s*"((?:\\.|[^"\\])+)"/g,
  /"employer"\s*:\s*\{[^{}]{0,600}"name"\s*:\s*"((?:\\.|[^"\\])+)"/g,
  /"company"\s*:\s*\{[^{}]{0,600}"name"\s*:\s*"((?:\\.|[^"\\])+)"/g,
]

const INVALID_NAME_RE =
  /\b(?:glassdoor|sign in|log in|upload resume|reviews|salaries|interviews|benefits|jobs|browse companies|explore companies|find companies|company reviews)\b/i

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\"/g, "\"").replace(/\\u0026/g, "&")
  }
}

function isPlausibleCompanyName(value: string): boolean {
  const normalized = normalizeCompanyName(value)
  if (normalized.length < 2 || normalized.length > 100) return false
  if (INVALID_NAME_RE.test(value)) return false
  if (/https?:\/\//i.test(value) || /@/.test(value)) return false
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return false
  return true
}

function collectRawNames(html: string): Array<{ name: string; method: string }> {
  const out: Array<{ name: string; method: string }> = []

  for (const match of html.matchAll(DATA_TEST_NAME_RE)) {
    const name = cleanCompanyDisplayName(match[2] ?? "")
    if (isPlausibleCompanyName(name)) out.push({ name, method: "data_test" })
  }

  for (const match of html.matchAll(COMPANY_LINK_RE)) {
    const name = cleanCompanyDisplayName(match[1] ?? "")
    if (isPlausibleCompanyName(name)) out.push({ name, method: "company_link" })
  }

  for (const pattern of JSON_NAME_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      const name = cleanCompanyDisplayName(decodeJsonString(match[1] ?? ""))
      if (isPlausibleCompanyName(name)) out.push({ name, method: "json_blob" })
    }
  }

  return out
}

export function parseGlassdoorCompanyCandidates(
  input: ParseGlassdoorCompaniesInput
): GlassdoorParsedCompany[] {
  const rawNames = collectRawNames(input.html)
  const deduped = dedupeCompanyCandidates(
    rawNames.map((item) => ({ companyNameRaw: item.name, extractionMethod: item.method }))
  )

  return deduped.map((candidate) => ({
    companyNameRaw: candidate.companyNameRaw,
    companyNameNormalized: candidate.companyNameNormalized,
    sourceUrl: input.sourceUrl,
    sourceName: "glassdoor",
    discoveredSectorKeyword: input.sectorKeyword,
    discoveredLocationKeyword: input.locationKeyword,
    metadata: {
      extraction_method: candidate.extractionMethod,
    },
  }))
}
