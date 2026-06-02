const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
}

const LEGAL_SUFFIX_WORDS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "group",
  "holdings",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "llp",
  "ltd",
  "plc",
])

const TRAILING_DISPLAY_SUFFIX_RE =
  /\s+(?:reviews?|jobs?|salaries|interviews?|benefits|overview)(?:\s*\|\s*glassdoor)?\s*$/i

export type CompanyNameInput = {
  companyNameRaw: string
}

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    }
    return HTML_ENTITY_MAP[lower] ?? entity
  })
}

export function stripHtmlTags(input: string): string {
  return input
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}

export function cleanCompanyDisplayName(input: string): string {
  return decodeHtmlEntities(stripHtmlTags(input))
    .replace(/\s+/g, " ")
    .replace(/\s+\|\s*Glassdoor\s*$/i, "")
    .replace(/^Working at\s+/i, "")
    .replace(TRAILING_DISPLAY_SUFFIX_RE, "")
    .replace(/\s+-\s+Glassdoor\s*$/i, "")
    .trim()
}

export function normalizeCompanyName(input: string): string {
  const cleaned = cleanCompanyDisplayName(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bd[./\s]*b[./\s]*a\b.*$/i, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .trim()

  const tokens = cleaned.split(/\s+/).filter(Boolean)
  while (tokens.length > 1 && LEGAL_SUFFIX_WORDS.has(tokens[tokens.length - 1]!)) {
    tokens.pop()
  }

  return tokens.join(" ")
}

export function companySlug(input: string, maxLength = 60): string {
  return normalizeCompanyName(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
}

export function dedupeCompanyCandidates<T extends CompanyNameInput>(
  candidates: readonly T[]
): Array<T & { companyNameNormalized: string }> {
  const seen = new Set<string>()
  const out: Array<T & { companyNameNormalized: string }> = []

  for (const candidate of candidates) {
    const companyNameNormalized = normalizeCompanyName(candidate.companyNameRaw)
    if (!companyNameNormalized || seen.has(companyNameNormalized)) continue
    seen.add(companyNameNormalized)
    out.push({ ...candidate, companyNameNormalized })
  }

  return out
}
