import { parseJobDescriptionSections } from "@/lib/jobs/description"
import type {
  CanonicalSectionKey,
  SourceAdapterKind,
} from "@/lib/jobs/normalization/types"

type AdapterStructuredExtraction = {
  sections: Partial<Record<CanonicalSectionKey, string[]>>
  compensationText: string | null
  visaText: string | null
}

type HeadingRule = {
  key: CanonicalSectionKey
  pattern: RegExp
}

type HeadingAlias = {
  key: CanonicalSectionKey
  alias: string
}

type MatchedHeading = {
  key: CanonicalSectionKey
  alias: string
  index: number
}

const PREFERRED_HEADING_RE =
  /\b(preferred qualifications|nice to have|additional qualifications)\b/i

const REQUIRED_HEADING_RE =
  /\b(minimum qualifications|basic qualifications|required qualifications|requirements)\b/i

const ATS_FIRST_ADAPTERS = new Set<SourceAdapterKind>([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "icims",
  "bamboohr",
  "jobvite",
  "oracle",
  "phenom",
  "google",
])

const COMMON_HEADING_RULES: HeadingRule[] = [
  {
    key: "about_role",
    pattern:
      /\b(about the role|about this role|role overview|job summary|position summary|overview|the opportunity|the role)\b/i,
  },
  {
    key: "responsibilities",
    pattern:
      /\b(responsibilit|what you(?:'|’)ll do|what you will do|what you'll be doing|day-to-day|in this role)\b/i,
  },
  {
    key: "requirements",
    pattern:
      /\b(requirements|minimum qualifications|required qualifications|basic qualifications|must have|who you are|your profile)\b/i,
  },
  {
    key: "preferred_qualifications",
    pattern:
      /\b(preferred qualifications|nice to have|bonus|plus|ideal candidate|additional qualifications)\b/i,
  },
  {
    key: "qualifications",
    pattern:
      /\b(qualifications|what you bring|candidate profile)\b/i,
  },
  {
    key: "skills",
    pattern:
      /\b(skills|technical skills|key skills|technologies|tech stack|tools)\b/i,
  },
  {
    key: "benefits",
    pattern:
      /\b(benefits|perks|what we offer|total rewards|compensation and benefits|life at)\b/i,
  },
  {
    key: "compensation",
    pattern:
      /\b(compensation|salary|pay range|base salary|total compensation)\b/i,
  },
  {
    key: "visa",
    pattern:
      /\b(visa|work authorization|sponsorship|authorized to work|h-?1b|opt)\b/i,
  },
  {
    key: "company_info",
    pattern:
      /\b(about us|about the company|our mission|our values|who we are|our culture|company)\b/i,
  },
  {
    key: "application_info",
    pattern:
      /\b(how to apply|application process|interview process|privacy notice|next steps)\b/i,
  },
  {
    key: "equal_opportunity",
    pattern:
      /\b(equal opportunity|eeo|accommodation|reasonable accommodation|protected veteran|affirmative action)\b/i,
  },
]

const ADAPTER_HEADING_RULES: Partial<Record<SourceAdapterKind, HeadingRule[]>> = {
  greenhouse: [
    {
      key: "requirements",
      pattern: /\b(who you are|what we're looking for|what we are looking for)\b/i,
    },
  ],
  lever: [
    {
      key: "about_role",
      pattern: /\b(the opportunity|the team|about the team)\b/i,
    },
    {
      key: "requirements",
      pattern: /\b(about you)\b/i,
    },
  ],
  ashby: [
    {
      key: "application_info",
      pattern: /\b(interview process|hiring process)\b/i,
    },
  ],
  workday: [
    {
      key: "requirements",
      pattern: /\b(basic qualifications)\b/i,
    },
  ],
  jobvite: [
    {
      key: "about_role",
      pattern: /\b(description|job description|overview|the opportunity)\b/i,
    },
    {
      key: "requirements",
      pattern: /\b(qualifications|requirements|what you bring|what we're looking for)\b/i,
    },
  ],
}

const INLINE_HEADING_MARKERS: Partial<Record<SourceAdapterKind, string[]>> = {
  greenhouse: [
    "About the Role",
    "Who We Are",
    "Responsibilities",
    "Requirements",
    "Qualifications",
    "Preferred Qualifications",
    "Skills",
    "Technical Skills",
    "Benefits",
    "Compensation",
  ],
  lever: [
    "The Opportunity",
    "The Team",
    "What You'll Do",
    "About You",
    "Requirements",
    "Qualifications",
    "Nice to Have",
    "Skills",
    "Technical Skills",
    "Benefits",
    "Compensation",
  ],
  ashby: [
    "About this role",
    "What you'll do",
    "Who you are",
    "Requirements",
    "Qualifications",
    "Nice to have",
    "Skills",
    "Technical Skills",
    "Benefits",
    "Interview Process",
  ],
  workday: [
    "Overview",
    "About the Role",
    "Job Description",
    "Responsibilities",
    "What you'll do",
    "What you will do",
    "Basic Qualifications",
    "Minimum Qualifications",
    "Required Qualifications",
    "Preferred Qualifications",
    "Additional Qualifications",
    "Skills",
    "Technical Skills",
    "Benefits",
    "Compensation",
    "Work Authorization",
  ],
  jobvite: [
    "Description",
    "Job Description",
    "Overview",
    "The Opportunity",
    "Responsibilities",
    "What you'll do",
    "What you will do",
    "Qualifications",
    "Requirements",
    "Minimum Qualifications",
    "Preferred Qualifications",
    "Nice to Have",
    "Skills",
    "Technical Skills",
    "Benefits",
    "Compensation",
    "EEO",
  ],
}

const SECTION_KEY_ALIASES: Array<[CanonicalSectionKey, string[]]> = [
  ["about_role", ["about", "overview", "summary", "role_overview", "job_summary"]],
  ["responsibilities", ["responsibilities", "duties", "what_youll_do"]],
  [
    "requirements",
    [
      "requirements",
      "qualifications",
      "minimum_qualifications",
      "basic_qualifications",
      "required_qualifications",
    ],
  ],
  ["qualifications", ["qualifications", "candidate_profile", "what_you_bring"]],
  [
    "preferred_qualifications",
    ["preferred_qualifications", "nice_to_have", "bonus_points"],
  ],
  ["skills", ["skills", "technical_skills", "key_skills", "technologies", "tech_stack"]],
  ["benefits", ["benefits", "perks", "what_we_offer"]],
  ["compensation", ["compensation", "salary", "salary_range", "pay_range", "total_compensation"]],
  ["visa", ["visa", "work_authorization", "sponsorship", "visa_sponsorship"]],
  ["company_info", ["company_info", "about_company", "about_us", "company_description"]],
  ["equal_opportunity", ["equal_opportunity", "eeo", "accommodation"]],
  [
    "application_info",
    ["application_info", "how_to_apply", "application_process"],
  ],
]

const COMMON_INLINE_ALIASES: HeadingAlias[] = [
  { key: "about_role", alias: "About the role" },
  { key: "about_role", alias: "About this role" },
  { key: "about_role", alias: "Role overview" },
  { key: "about_role", alias: "Overview" },
  { key: "about_role", alias: "Job summary" },
  { key: "responsibilities", alias: "Responsibilities" },
  { key: "responsibilities", alias: "What you'll do" },
  { key: "responsibilities", alias: "What you will do" },
  { key: "requirements", alias: "Requirements" },
  { key: "requirements", alias: "Minimum qualifications" },
  { key: "requirements", alias: "Basic qualifications" },
  { key: "requirements", alias: "Required qualifications" },
  { key: "qualifications", alias: "Qualifications" },
  { key: "qualifications", alias: "What you bring" },
  { key: "preferred_qualifications", alias: "Preferred qualifications" },
  { key: "preferred_qualifications", alias: "Additional qualifications" },
  { key: "preferred_qualifications", alias: "Nice to have" },
  { key: "skills", alias: "Skills" },
  { key: "skills", alias: "Technical skills" },
  { key: "skills", alias: "Key skills" },
  { key: "skills", alias: "Technologies" },
  { key: "benefits", alias: "Benefits" },
  { key: "benefits", alias: "Perks" },
  { key: "benefits", alias: "What we offer" },
  { key: "compensation", alias: "Compensation" },
  { key: "compensation", alias: "Salary range" },
  { key: "compensation", alias: "Pay range" },
  { key: "visa", alias: "Work authorization" },
  { key: "visa", alias: "Visa" },
  { key: "visa", alias: "Sponsorship" },
  { key: "company_info", alias: "About us" },
  { key: "company_info", alias: "Who we are" },
  { key: "equal_opportunity", alias: "Equal opportunity" },
  { key: "equal_opportunity", alias: "EEO" },
  { key: "application_info", alias: "Application process" },
  { key: "application_info", alias: "How to apply" },
  { key: "application_info", alias: "Equal opportunity" },
]

const INLINE_ALIASES_BY_ADAPTER: Partial<Record<SourceAdapterKind, HeadingAlias[]>> = {
  greenhouse: [...COMMON_INLINE_ALIASES],
  lever: [
    ...COMMON_INLINE_ALIASES,
    { key: "about_role", alias: "The opportunity" },
    { key: "about_role", alias: "The team" },
    { key: "requirements", alias: "About you" },
  ],
  ashby: [
    ...COMMON_INLINE_ALIASES,
    { key: "application_info", alias: "Interview process" },
  ],
  workday: [...COMMON_INLINE_ALIASES],
  jobvite: [
    ...COMMON_INLINE_ALIASES,
    { key: "about_role", alias: "Description" },
    { key: "about_role", alias: "The opportunity" },
    { key: "application_info", alias: "EEO" },
  ],
  icims: [...COMMON_INLINE_ALIASES],
  bamboohr: [...COMMON_INLINE_ALIASES],
  oracle: [...COMMON_INLINE_ALIASES],
  phenom: [...COMMON_INLINE_ALIASES],
  google: [...COMMON_INLINE_ALIASES],
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
}

function uniqCaseInsensitive(values: string[], max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 16)
}

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function isNearDuplicate(left: string, right: string): boolean {
  const a = normalizeForCompare(left)
  const b = normalizeForCompare(right)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

function itemsFromSection(section: { bullets: string[]; paragraphs: string[] }): string[] {
  const bullets = section.bullets
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)

  if (bullets.length > 0) {
    return uniqCaseInsensitive(bullets, 14)
  }

  const sentences = section.paragraphs
    .flatMap((paragraph) => splitSentences(paragraph))
    .filter((line) => line.length >= 24 && line.length <= 260)

  return uniqCaseInsensitive(sentences, 12)
}

function itemsFromInlineSegment(
  key: CanonicalSectionKey,
  segment: string
): string[] {
  const normalized = segment
    .replace(/[•]/g, "\n- ")
    .replace(/\s*;\s+/g, "\n- ")
    .trim()

  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const bullets = rawLines
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length >= 8)

  const sentenceItems = splitSentences(normalized)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length >= 16 && line.length <= 260)

  const candidates = bullets.length > 1 ? bullets : sentenceItems
  const cleaned = uniqCaseInsensitive(candidates, 14)

  if (key === "about_role" || key === "company_info") {
    return cleaned.slice(0, 4)
  }
  return cleaned
}

function sanitizeParsedItemsForKey(
  key: CanonicalSectionKey,
  items: string[]
): string[] {
  return items.filter((item) => {
    if (key === "requirements" && PREFERRED_HEADING_RE.test(item)) return false
    if (key === "preferred_qualifications" && REQUIRED_HEADING_RE.test(item)) return false
    if (
      (key === "about_role" || key === "responsibilities") &&
      (PREFERRED_HEADING_RE.test(item) || REQUIRED_HEADING_RE.test(item))
    ) {
      return false
    }
    return true
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findInlineHeadings(
  text: string,
  aliases: HeadingAlias[]
): MatchedHeading[] {
  const matches: MatchedHeading[] = []
  const lowerText = text.toLowerCase()

  for (const entry of aliases) {
    const aliasLower = entry.alias.toLowerCase()
    let cursor = 0

    while (cursor < lowerText.length) {
      const index = lowerText.indexOf(aliasLower, cursor)
      if (index < 0) break

      let beforeNonWhitespace = ""
      for (let i = index - 1; i >= 0; i -= 1) {
        const char = text[i]
        if (char === " " || char === "\n" || char === "\r" || char === "\t") continue
        beforeNonWhitespace = char
        break
      }
      const afterIndex = index + aliasLower.length
      const after = afterIndex < text.length ? text[afterIndex] : ""

      const hasStartBoundary =
        index === 0 ||
        beforeNonWhitespace === "" ||
        beforeNonWhitespace === "\n" ||
        beforeNonWhitespace === "\r" ||
        beforeNonWhitespace === "." ||
        beforeNonWhitespace === "!" ||
        beforeNonWhitespace === "?" ||
        beforeNonWhitespace === ":"
      const hasEndSignal =
        after === ":" ||
        after === "-" ||
        after === " " ||
        after === "\n" ||
        after === "\r"

      if (hasStartBoundary && hasEndSignal) {
        matches.push({
          key: entry.key,
          alias: entry.alias,
          index,
        })
      }

      cursor = index + aliasLower.length
    }
  }

  const dedupedByIndex = new Map<number, MatchedHeading>()
  for (const match of matches.sort((left, right) => {
    if (left.index !== right.index) return left.index - right.index
    return right.alias.length - left.alias.length
  })) {
    if (!dedupedByIndex.has(match.index)) {
      dedupedByIndex.set(match.index, match)
    }
  }

  return [...dedupedByIndex.values()].sort((left, right) => left.index - right.index)
}

function extractSectionsFromInlineHeadings(
  adapter: SourceAdapterKind,
  description: string
): Partial<Record<CanonicalSectionKey, string[]>> {
  const aliases = INLINE_ALIASES_BY_ADAPTER[adapter]
  if (!aliases || aliases.length === 0) return {}

  const headings = findInlineHeadings(description, aliases)
  if (headings.length === 0) return {}

  const out: Partial<Record<CanonicalSectionKey, string[]>> = {}
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i]
    const next = headings[i + 1]

    let start = current.index + current.alias.length
    while (start < description.length) {
      const char = description[start]
      if (char === ":" || char === "-" || char === " " || char === "\n" || char === "\r") {
        start += 1
        continue
      }
      break
    }

    const end = next ? next.index : description.length
    const segment = description.slice(start, end).trim()
    if (!segment) continue

    const items = itemsFromInlineSegment(current.key, segment)
    if (items.length === 0) continue

    out[current.key] = uniqCaseInsensitive([...(out[current.key] ?? []), ...items], 14)
  }

  return out
}

function normalizeInlineHeadingsForAdapter(
  adapter: SourceAdapterKind,
  description: string
): string {
  const markers = INLINE_HEADING_MARKERS[adapter]
  if (!markers || markers.length === 0) return description

  let output = description
  for (const marker of markers) {
    const escaped = escapeRegExp(marker)
    output = output.replace(
      new RegExp(`\\b(${escaped})\\s*[-–—]\\s*`, "gi"),
      "\n\n$1:\n- "
    )
    output = output.replace(
      new RegExp(`\\b(${escaped})\\s*:\\s*`, "gi"),
      "\n\n$1:\n"
    )
    output = output.replace(
      new RegExp(`\\b(${escaped})\\s+(?=[A-Z0-9])`, "gi"),
      "\n\n$1:\n"
    )
  }

  return output
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function classifyHeadingByAdapter(
  adapter: SourceAdapterKind,
  heading: string | null
): CanonicalSectionKey {
  const value = heading?.trim()
  if (!value) return "other"

  for (const rule of ADAPTER_HEADING_RULES[adapter] ?? []) {
    if (rule.pattern.test(value)) return rule.key
  }

  for (const rule of COMMON_HEADING_RULES) {
    if (rule.pattern.test(value)) return rule.key
  }

  return "other"
}

function mergeSections(
  primary: Partial<Record<CanonicalSectionKey, string[]>>,
  secondary: Partial<Record<CanonicalSectionKey, string[]>>
): Partial<Record<CanonicalSectionKey, string[]>> {
  const out: Partial<Record<CanonicalSectionKey, string[]>> = {}
  const keys = new Set<CanonicalSectionKey>([
    ...(Object.keys(primary) as CanonicalSectionKey[]),
    ...(Object.keys(secondary) as CanonicalSectionKey[]),
  ])

  for (const key of keys) {
    const combined = uniqCaseInsensitive([
      ...(primary[key] ?? []),
      ...(secondary[key] ?? []),
    ])
    if (combined.length > 0) out[key] = combined
  }

  return out
}

function sentenceContaining(text: string, matcher: RegExp): string | null {
  const lines = text
    .split(/\n+/)
    .flatMap((line) => splitSentences(line))
    .map((line) => line.trim())
    .filter((line) => line.length >= 16)

  for (const line of lines) {
    if (!matcher.test(line)) continue
    return line.slice(0, 240)
  }

  return null
}

function extractCompensationSnippet(description: string | null): string | null {
  if (!description) return null
  return sentenceContaining(
    description,
    /\b(\$\s?\d|usd|salary|pay range|compensation|base pay|annual(?:ly)?|per year)\b/i
  )
}

function extractVisaSnippet(description: string | null): string | null {
  if (!description) return null
  return sentenceContaining(
    description,
    /\b(visa|work authorization|sponsorship|authorized to work|h-?1b|opt)\b/i
  )
}

function extractStructuredFromRawData(
  rawData: Record<string, unknown> | null
): AdapterStructuredExtraction {
  if (!rawData) {
    return {
      sections: {},
      compensationText: null,
      visaText: null,
    }
  }

  const roots = [rawData, asRecord(rawData.raw)].filter(
    (value): value is Record<string, unknown> => Boolean(value)
  )

  const sections: Partial<Record<CanonicalSectionKey, string[]>> = {}
  for (const [key, aliases] of SECTION_KEY_ALIASES) {
    const collected: string[] = []
    for (const root of roots) {
      for (const alias of aliases) {
        const fromArray = asStringArray(root[alias])
        if (fromArray.length > 0) {
          collected.push(...fromArray)
          continue
        }
        const fromString = toStringOrNull(root[alias])
        if (fromString) collected.push(fromString)
      }
    }
    const unique = uniqCaseInsensitive(collected, key === "other" ? 20 : 14)
    if (unique.length > 0) sections[key] = unique
  }

  const compensationText =
    toStringOrNull(rawData.compensation) ??
    toStringOrNull(rawData.salary_range) ??
    toStringOrNull(rawData.pay_range) ??
    toStringOrNull(asRecord(rawData.raw)?.compensation) ??
    null

  const visaText =
    toStringOrNull(rawData.visa) ??
    toStringOrNull(rawData.work_authorization) ??
    toStringOrNull(rawData.sponsorship) ??
    toStringOrNull(asRecord(rawData.raw)?.work_authorization) ??
    null

  return {
    sections,
    compensationText,
    visaText,
  }
}

function extractStructuredFromDescription(
  adapter: SourceAdapterKind,
  description: string | null
): Partial<Record<CanonicalSectionKey, string[]>> {
  if (!description) return {}

  const fromInline = extractSectionsFromInlineHeadings(adapter, description)
  const normalizedDescription = normalizeInlineHeadingsForAdapter(adapter, description)
  const parsed = parseJobDescriptionSections(normalizedDescription)
  if (parsed.length === 0) return fromInline

  const out: Partial<Record<CanonicalSectionKey, string[]>> = { ...fromInline }

  for (const section of parsed) {
    const key = classifyHeadingByAdapter(adapter, section.heading)
    if (key === "header" || key === "other") continue

    const items = sanitizeParsedItemsForKey(key, itemsFromSection(section))
    if (items.length === 0) continue

    const existing = out[key] ?? []
    const merged = [...existing]

    for (const item of items) {
      if (existing.some((current) => isNearDuplicate(current, item))) continue
      if (merged.some((current) => isNearDuplicate(current, item))) continue
      merged.push(item)
    }

    out[key] = uniqCaseInsensitive(merged, 14)
  }

  const requirements = out.requirements ?? []
  const preferred = out.preferred_qualifications ?? []
  if (requirements.length > 0 && preferred.length > 0) {
    out.requirements = requirements.filter(
      (item) => !preferred.some((preferredItem) => isNearDuplicate(item, preferredItem))
    )
  }

  return out
}

export function extractStructuredFromAts(input: {
  adapter: SourceAdapterKind
  description: string | null
  rawData: Record<string, unknown> | null
}): AdapterStructuredExtraction {
  const fromRaw = extractStructuredFromRawData(input.rawData)

  if (!ATS_FIRST_ADAPTERS.has(input.adapter)) {
    return fromRaw
  }

  const fromDescription = extractStructuredFromDescription(
    input.adapter,
    input.description
  )

  const mergedSections = mergeSections(fromDescription, fromRaw.sections)

  const compensationText =
    fromRaw.compensationText ??
    extractCompensationSnippet(input.description) ??
    mergedSections.compensation?.[0] ??
    null

  const visaText =
    fromRaw.visaText ??
    extractVisaSnippet(input.description) ??
    mergedSections.visa?.[0] ??
    null

  return {
    sections: mergedSections,
    compensationText,
    visaText,
  }
}
