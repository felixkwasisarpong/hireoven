import { parseJobDescriptionSections } from "@/lib/jobs/description"
import {
  CANONICAL_SECTION_ORDER,
  classifyHeading,
  classifyTextByHeuristic,
  sectionLabel,
  uniqCaseInsensitive,
} from "@/lib/jobs/normalization/section-taxonomy"
import type {
  CanonicalSection,
  CanonicalSectionKey,
  FieldProvenance,
  SourceAdapterKind,
} from "@/lib/jobs/normalization/types"

type SectionBucket = {
  items: string[]
  confidences: number[]
  provenance: FieldProvenance[]
  isFallback: boolean
}

const REQUIREMENT_LIKE_RE =
  /\b(required|required qualifications|minimum qualifications|minimum requirements|basic qualifications|must have|must be|years of experience|experience with|bachelor|degree|proficiency|strong understanding)\b/i

const PREFERRED_LIKE_RE =
  /\b(preferred qualifications|preferred|nice to have|bonus|plus|ideal candidate|would be a plus)\b/i

const RESPONSIBILITY_LIKE_RE =
  /\b(build|design|develop|deliver|collaborate|partner|lead|own|create|drive|maintain|implement|optimize|support)\b/i

const BENEFITS_LIKE_RE =
  /\b(benefits|perks|health|dental|vision|401\s?\(k\)|retirement|paid time off|pto|parental leave|wellness|stipend|bonus)\b/i

const COMPANY_LIKE_RE =
  /\b(we are|we(?:'|’)re looking|our mission|our values|our culture|founded|part of|customers|global team|across [a-z]+ countries|we offer|about us)\b/i

const APPLICATION_LIKE_RE =
  /\b(apply for this role|apply now|application process|how to apply|interview process|equal opportunity|eeo|accommodation|encouraged to apply)\b/i

const LOCATION_META_LIKE_RE =
  /\b(office locations?|office-assigned|job type|work model|on-site|onsite|hybrid|remote|location[s]?)\b/i

const PROMOTIONAL_LIKE_RE =
  /\b(opportunity|career advancement|grow your skills|grow and develop|personal development plans|join [a-z][a-z ]+ and do work that matters|stand out|set you apart|extraordinary twists and turns|welcome diverse perspectives|challenge assumptions)\b/i

const COMPENSATION_LIKE_RE =
  /\b(\$\s?\d|usd|salary|pay range|base salary|on target earnings|annual(?:ly)?|per year|ote)\b/i

const NON_SUBSTANTIVE_REQUIREMENT_RE =
  /\b(meets? the minimum requirements|encouraged to apply|not a requirement|requirements are still being parsed)\b/i

const COMPANY_POSITIONING_RE =
  /\b(platform|mission|industry|customers|community|financial services|value out of|across europe)\b/i

const ABOUT_BLOCKED_RE =
  /\b(what you(?:'|’)ll do|what you will do|responsibilit|minimum qualifications|basic qualifications|required qualifications|preferred qualifications|requirements|benefits|compensation|application process)\b/i

const SECTION_MARKER_RE =
  /\b(minimum qualifications|minimum requirements|basic qualifications|required qualifications|preferred qualifications|responsibilities|benefits|compensation)\b/i

type InlineHeadingAlias = {
  key: CanonicalSectionKey
  alias: string
}

type InlineHeadingMatch = InlineHeadingAlias & {
  index: number
}

const INLINE_SECTION_ALIASES: InlineHeadingAlias[] = [
  { key: "about_role", alias: "About the role" },
  { key: "about_role", alias: "About this role" },
  { key: "about_role", alias: "Role overview" },
  { key: "about_role", alias: "Overview" },
  { key: "about_role", alias: "About the team" },
  { key: "responsibilities", alias: "Responsibilities" },
  { key: "responsibilities", alias: "What you'll do" },
  { key: "responsibilities", alias: "What you will do" },
  { key: "requirements", alias: "Requirements" },
  { key: "requirements", alias: "Qualifications" },
  { key: "requirements", alias: "Minimum requirements" },
  { key: "requirements", alias: "Minimum qualifications" },
  { key: "requirements", alias: "Basic qualifications" },
  { key: "requirements", alias: "Required qualifications" },
  { key: "requirements", alias: "Who you are" },
  { key: "preferred_qualifications", alias: "Preferred qualifications" },
  { key: "preferred_qualifications", alias: "Additional qualifications" },
  { key: "preferred_qualifications", alias: "Nice to have" },
  { key: "benefits", alias: "Benefits" },
  { key: "benefits", alias: "Perks" },
  { key: "benefits", alias: "What we offer" },
  { key: "benefits", alias: "Additional benefits" },
  { key: "company_info", alias: "Who we are" },
  { key: "company_info", alias: "About us" },
  { key: "application_info", alias: "How to apply" },
  { key: "application_info", alias: "Application process" },
  { key: "application_info", alias: "Apply for this role" },
  { key: "application_info", alias: "Office locations" },
  { key: "application_info", alias: "Job type" },
]

function createEmptyBuckets(): Record<CanonicalSectionKey, SectionBucket> {
  return {
    header: { items: [], confidences: [], provenance: [], isFallback: false },
    compensation: { items: [], confidences: [], provenance: [], isFallback: false },
    visa: { items: [], confidences: [], provenance: [], isFallback: false },
    about_role: { items: [], confidences: [], provenance: [], isFallback: false },
    responsibilities: { items: [], confidences: [], provenance: [], isFallback: false },
    requirements: { items: [], confidences: [], provenance: [], isFallback: false },
    preferred_qualifications: {
      items: [],
      confidences: [],
      provenance: [],
      isFallback: false,
    },
    benefits: { items: [], confidences: [], provenance: [], isFallback: false },
    company_info: { items: [], confidences: [], provenance: [], isFallback: false },
    application_info: { items: [], confidences: [], provenance: [], isFallback: false },
    other: { items: [], confidences: [], provenance: [], isFallback: false },
  }
}

function addItems(
  bucket: SectionBucket,
  items: string[],
  confidence: number,
  provenance: FieldProvenance,
  maxItems = 30
) {
  if (items.length === 0) return

  const trimmed = items
    .map((item) =>
      item
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((item) => item.length >= 3)

  const unique = uniqCaseInsensitive([...bucket.items, ...trimmed], maxItems)
  const addedCount = Math.max(0, unique.length - bucket.items.length)

  bucket.items = unique
  for (let i = 0; i < addedCount; i += 1) {
    bucket.confidences.push(confidence)
  }
  if (addedCount > 0) {
    bucket.provenance.push(provenance)
  }
}

function sectionConfidence(bucket: SectionBucket): number {
  if (bucket.items.length === 0) return 0
  if (bucket.confidences.length === 0) return bucket.isFallback ? 0.42 : 0.6
  const total = bucket.confidences.reduce((sum, value) => sum + value, 0)
  return Math.max(0.1, Math.min(1, total / bucket.confidences.length))
}

function splitParagraphIntoBullets(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12)
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function flattenSectionContent(section: { bullets: string[]; paragraphs: string[] }): string[] {
  const bulletItems = section.bullets
    .map((item) => item.trim())
    .filter(Boolean)

  if (bulletItems.length > 0) return bulletItems

  return section.paragraphs
    .flatMap((paragraph) => splitParagraphIntoBullets(paragraph))
    .filter(Boolean)
}

const EXPLICIT_HEADING_PATTERN =
  /(about the role|about the team|role overview|job summary|what you(?:'|’)ll do|what you will do|responsibilities|qualifications|minimum qualifications|minimum requirements|required qualifications|basic qualifications|requirements|preferred qualifications|nice to have|benefits|compensation|about us|about the company|who we are|company|application process|how to apply|work authorization|visa|sponsorship)\s*:/gi

function extractExplicitHeadingSegments(description: string): Array<{ heading: string; body: string }> {
  const matches = [...description.matchAll(EXPLICIT_HEADING_PATTERN)]
  if (matches.length === 0) return []

  const out: Array<{ heading: string; body: string }> = []
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const next = matches[i + 1]
    const heading = current[1]?.trim()
    if (!heading) continue

    const start = (current.index ?? 0) + current[0].length
    const end = next?.index ?? description.length
    const body = description.slice(start, end).trim()
    if (!body) continue

    out.push({ heading, body })
  }

  return out
}

function itemsFromTextBlock(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const bullets: string[] = []
  for (const line of lines) {
    if (/^[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s+/, "").trim())
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, "").trim())
      continue
    }
    bullets.push(...splitParagraphIntoBullets(line))
  }

  return uniqCaseInsensitive(bullets)
}

function fallbackFromFirstParagraphs(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  description: string,
  adapter: SourceAdapterKind
) {
  if (buckets.about_role.items.length > 0) return

  const paragraphs = description
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20)

  const fallbackItems = paragraphs
    .slice(0, 4)
    .flatMap((paragraph) => splitIntoSentences(paragraph))
    .map((line) => line.trim())
    .filter((line) => line.length >= 40 && line.length <= 240)
    .filter((line) => !ABOUT_BLOCKED_RE.test(line))
    .filter((line) => !RESPONSIBILITY_LIKE_RE.test(line))
    .filter((line) => !REQUIREMENT_LIKE_RE.test(line))
    .filter((line) => !PREFERRED_LIKE_RE.test(line))
    .filter((line) => !COMPANY_LIKE_RE.test(line))
    .filter((line) => !COMPANY_POSITIONING_RE.test(line))
    .filter((line) => !PROMOTIONAL_LIKE_RE.test(line))
    .slice(0, 3)

  if (fallbackItems.length === 0) return

  addItems(
    buckets.about_role,
    fallbackItems,
    0.46,
    {
      adapter,
      method: "fallback",
      source_path: "description",
    },
    6
  )
  buckets.about_role.isFallback = true
}

function fallbackResponsibilities(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.responsibilities.items.length > 0) return
  if (buckets.other.items.length === 0) return

  const candidates = buckets.other.items.filter((item) =>
    /\b(build|design|develop|collaborate|lead|deliver|create|drive|partner)\b/i.test(item)
  )

  if (candidates.length === 0) return

  addItems(
    buckets.responsibilities,
    candidates.slice(0, 8),
    0.44,
    {
      adapter,
      method: "fallback",
      source_path: "other",
    },
    12
  )
  buckets.responsibilities.isFallback = true
}

function fallbackRequirements(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.requirements.items.length > 0) return

  const sourceKeys: CanonicalSectionKey[] = ["other", "responsibilities"]

  const fromMixedSections = sourceKeys.flatMap((key) =>
    buckets[key].items.filter((item) =>
      REQUIREMENT_LIKE_RE.test(item) &&
      item.length <= 260 &&
      splitIntoSentences(item).length <= 3 &&
      !BENEFITS_LIKE_RE.test(item) &&
      !COMPANY_LIKE_RE.test(item) &&
      !APPLICATION_LIKE_RE.test(item) &&
      !LOCATION_META_LIKE_RE.test(item) &&
      !COMPENSATION_LIKE_RE.test(item)
    )
  )

  if (fromMixedSections.length === 0) return

  addItems(
    buckets.requirements,
    fromMixedSections.slice(0, 10),
    0.44,
    {
      adapter,
      method: "fallback",
      source_path: "mixed_sections",
    },
    14
  )
  buckets.requirements.isFallback = true
}

function enrichFromMixedText(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const sourceKeys: CanonicalSectionKey[] = ["about_role", "other"]

  for (const sourceKey of sourceKeys) {
    for (const item of buckets[sourceKey].items) {
      const candidates =
        item.length > 260 || SECTION_MARKER_RE.test(item)
          ? splitIntoSentences(item)
          : [item]

      for (const candidateRaw of candidates) {
        const candidate = candidateRaw.trim()
        if (candidate.length < 24 || candidate.length > 240) continue
        if (SECTION_MARKER_RE.test(candidate) && splitIntoSentences(candidate).length > 1) continue

        const classification = classifyTextByHeuristic(candidate)
        if (classification.key === "other" || classification.key === sourceKey) continue

        addItems(
          buckets[classification.key],
          [candidate],
          0.58,
          {
            adapter,
            method: "heuristic",
            source_path: `${sourceKey}.mixed`,
            source_excerpt: candidate.slice(0, 240),
          },
          14
        )
      }
    }
  }
}

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findInlineHeadingMatches(description: string): InlineHeadingMatch[] {
  const lower = description.toLowerCase()
  const matches: InlineHeadingMatch[] = []

  for (const alias of INLINE_SECTION_ALIASES) {
    const target = alias.alias.toLowerCase()
    let cursor = 0

    while (cursor < lower.length) {
      const index = lower.indexOf(target, cursor)
      if (index < 0) break

      let beforeNonWhitespace = ""
      for (let i = index - 1; i >= 0; i -= 1) {
        const char = description[i]
        if (char === " " || char === "\n" || char === "\r" || char === "\t") continue
        beforeNonWhitespace = char
        break
      }
      const after = description[index + target.length] ?? ""

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
        !after ||
        after === ":" ||
        after === "-" ||
        after === "\n" ||
        after === "\r" ||
        after === " " ||
        /[A-Z0-9]/.test(after)

      if (hasStartBoundary && hasEndSignal) {
        matches.push({ ...alias, index })
      }

      cursor = index + target.length
    }
  }

  const byIndex = new Map<number, InlineHeadingMatch>()
  for (const match of matches.sort((left, right) => {
    if (left.index !== right.index) return left.index - right.index
    return right.alias.length - left.alias.length
  })) {
    if (!byIndex.has(match.index)) {
      byIndex.set(match.index, match)
    }
  }

  return [...byIndex.values()].sort((left, right) => left.index - right.index)
}

function extractInlineHeadingSegments(description: string): Array<{
  key: CanonicalSectionKey
  heading: string
  body: string
}> {
  const matches = findInlineHeadingMatches(description)
  if (matches.length === 0) return []

  const out: Array<{ key: CanonicalSectionKey; heading: string; body: string }> = []

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const next = matches[i + 1]
    const escapedAlias = escapeRegExp(current.alias)
    const leadPattern = new RegExp(`^${escapedAlias}\\s*[:\\-]?\\s*`, "i")

    const start = current.index
    const end = next?.index ?? description.length
    const rawSegment = description.slice(start, end).trim()
    const body = rawSegment.replace(leadPattern, "").trim()
    if (!body || body.length < 8) continue

    out.push({
      key: current.key,
      heading: current.alias,
      body,
    })
  }

  return out
}

function splitApplicationInfoFragments(value: string): string[] {
  const withMarkers = value
    .replace(
      /\b(Office locations?|Job type|Apply for this role|Application process|How to apply|Equal opportunity)\b/gi,
      "\n$1"
    )
    .replace(/\s+(At [A-Z][A-Za-z0-9&.' -]{1,48},?\s+we(?:'|’)re)\b/g, "\n$1")
    .replace(/\s+(Team)\s+(?=[A-Z])/g, "\n$1 ")
    .replace(/\.\s+/g, "\n")

  return withMarkers
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12 && item.length <= 220)
}

function looksLikeRequirementItem(value: string): boolean {
  if (NON_SUBSTANTIVE_REQUIREMENT_RE.test(value)) return false
  if (APPLICATION_LIKE_RE.test(value) || LOCATION_META_LIKE_RE.test(value)) return false
  if (COMPENSATION_LIKE_RE.test(value) || BENEFITS_LIKE_RE.test(value)) return false

  if (REQUIREMENT_LIKE_RE.test(value)) return true
  if (/\b\d+\+?\s+years?\b/i.test(value)) return true
  if (/\b(experience in|experience with|proven|ability to|track record|expertise|knowledge of)\b/i.test(value)) {
    return true
  }
  return false
}

function uniqNearDuplicate(values: string[], max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeForCompare(value)
    if (!normalized) continue

    if (
      out.some((existing) => {
        const current = normalizeForCompare(existing)
        return current === normalized || current.includes(normalized) || normalized.includes(current)
      })
    ) {
      continue
    }
    out.push(value)
    if (out.length >= max) break
  }

  return out
}

function moveItem(
  from: SectionBucket,
  to: SectionBucket,
  item: string,
  confidence: number,
  provenance: FieldProvenance
) {
  from.items = from.items.filter((entry) => entry !== item)
  addItems(to, [item], confidence, provenance, 20)
}

function rebalanceQualificationBuckets(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const movedFromResponsibilities = [...buckets.responsibilities.items]
  for (const item of movedFromResponsibilities) {
    if (BENEFITS_LIKE_RE.test(item)) {
      moveItem(
        buckets.responsibilities,
        buckets.benefits,
        item,
        0.66,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    if (PREFERRED_LIKE_RE.test(item)) {
      moveItem(
        buckets.responsibilities,
        buckets.preferred_qualifications,
        item,
        0.62,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
      continue
    }

    if (
      REQUIREMENT_LIKE_RE.test(item) &&
      !BENEFITS_LIKE_RE.test(item)
    ) {
      moveItem(
        buckets.responsibilities,
        buckets.requirements,
        item,
        0.6,
        {
          adapter,
          method: "heuristic",
          source_path: "responsibilities.rebalanced",
          source_excerpt: item.slice(0, 220),
        }
      )
    }
  }

  const movedFromRequirements = [...buckets.requirements.items]
  for (const item of movedFromRequirements) {
    if (!PREFERRED_LIKE_RE.test(item)) continue
    moveItem(
      buckets.requirements,
      buckets.preferred_qualifications,
      item,
      0.66,
      {
        adapter,
        method: "heuristic",
        source_path: "requirements.rebalanced",
        source_excerpt: item.slice(0, 220),
      }
    )
  }
}

function cleanQualificationLeadIn(value: string): string {
  return value
    .replace(/^job description\s*[:\-]?\s*/i, "")
    .replace(/^minimum requirements?\b[:\s-]*/i, "")
    .replace(/^(minimum|basic|required|preferred)\s+qualifications?\b[:\s-]*/i, "")
    .replace(/^qualifications?\b[:\s-]*/i, "")
    .trim()
}

function splitQualificationItem(item: string): string[] {
  const withMarkers = item
    .replace(
      /\s+(minimum qualifications|minimum requirements|basic qualifications|required qualifications|preferred qualifications)\s*:/gi,
      ". $1: "
    )
    .replace(/\s+-\s+(?=[A-Z0-9])/g, ". ")

  const parts = withMarkers
    .split(/\s*[;•]\s+/g)
    .flatMap((piece) => splitIntoSentences(piece))
    .map((piece) => cleanQualificationLeadIn(piece))
    .filter((piece) => piece.length >= 16 && piece.length <= 220)

  if (parts.length > 0) return parts

  return item
    .split(/\s+-\s+(?=[A-Z0-9])/g)
    .map((piece) => cleanQualificationLeadIn(piece))
    .filter((piece) => piece.length >= 16 && piece.length <= 220)
}

function sanitizeQualificationBuckets(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const nextRequirements: string[] = []
  const nextPreferred: string[] = []

  for (const item of buckets.requirements.items) {
    for (const piece of splitQualificationItem(item)) {
      if (BENEFITS_LIKE_RE.test(piece) || COMPANY_LIKE_RE.test(piece)) continue
      if (APPLICATION_LIKE_RE.test(piece) || LOCATION_META_LIKE_RE.test(piece)) continue
      if (COMPENSATION_LIKE_RE.test(piece)) continue
      if (PROMOTIONAL_LIKE_RE.test(piece)) continue

      if (PREFERRED_LIKE_RE.test(piece)) {
        nextPreferred.push(cleanQualificationLeadIn(piece))
        continue
      }

      const cleaned = cleanQualificationLeadIn(piece)
      if (!RESPONSIBILITY_LIKE_RE.test(cleaned) && looksLikeRequirementItem(cleaned)) {
        nextRequirements.push(cleaned)
      } else if (REQUIREMENT_LIKE_RE.test(cleaned) && looksLikeRequirementItem(cleaned)) {
        nextRequirements.push(cleaned)
      }
    }
  }

  for (const item of buckets.preferred_qualifications.items) {
    for (const piece of splitQualificationItem(item)) {
      if (BENEFITS_LIKE_RE.test(piece) || COMPANY_LIKE_RE.test(piece)) continue
      if (APPLICATION_LIKE_RE.test(piece) || LOCATION_META_LIKE_RE.test(piece)) continue
      if (COMPENSATION_LIKE_RE.test(piece)) continue
      if (PROMOTIONAL_LIKE_RE.test(piece)) continue

      if (!REQUIREMENT_LIKE_RE.test(piece) && RESPONSIBILITY_LIKE_RE.test(piece)) continue
      if (NON_SUBSTANTIVE_REQUIREMENT_RE.test(piece)) continue
      nextPreferred.push(cleanQualificationLeadIn(piece))
    }
  }

  const refinedRequirements = uniqCaseInsensitive(
    nextRequirements.filter(
      (item) => item.length >= 16 && looksLikeRequirementItem(item) && !NON_SUBSTANTIVE_REQUIREMENT_RE.test(item)
    ),
    12
  )
  const refinedPreferred = uniqCaseInsensitive(
    nextPreferred.filter((item) => item.length >= 16),
    10
  )

  buckets.requirements.items = refinedRequirements
  if (refinedRequirements.length > 0) {
    buckets.requirements.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "requirements.sanitized",
    })
  }

  if (refinedPreferred.length > 0) {
    buckets.preferred_qualifications.items = refinedPreferred
    buckets.preferred_qualifications.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "preferred_qualifications.sanitized",
    })
    return
  }

  buckets.preferred_qualifications.items = []
}

function sanitizeResponsibilitiesBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  const kept: string[] = []

  for (const item of buckets.responsibilities.items) {
    const candidates = item.length > 260 ? splitIntoSentences(item) : [item]
    for (const candidateRaw of candidates) {
      const candidate = candidateRaw.trim()
      if (candidate.length < 16 || candidate.length > 220) continue

      if (/^about the team\b/i.test(candidate)) {
        const trimmed = candidate.replace(/^about the team\b[:\s-]*/i, "").trim()
        if (trimmed.length >= 20) {
          addItems(
            buckets.about_role,
            [trimmed],
            0.62,
            {
              adapter,
              method: "heuristic",
              source_path: "responsibilities.sanitized",
              source_excerpt: trimmed.slice(0, 200),
            },
            8
          )
        }
        continue
      }

      if (APPLICATION_LIKE_RE.test(candidate) || LOCATION_META_LIKE_RE.test(candidate)) {
        const fragments = splitApplicationInfoFragments(candidate)
        for (const fragment of fragments.length > 0 ? fragments : [candidate]) {
          if (APPLICATION_LIKE_RE.test(fragment) || LOCATION_META_LIKE_RE.test(fragment)) {
            addItems(
              buckets.application_info,
              [fragment],
              0.58,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
            continue
          }

          if (COMPANY_LIKE_RE.test(fragment) || PROMOTIONAL_LIKE_RE.test(fragment)) {
            addItems(
              buckets.company_info,
              [fragment],
              0.56,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
            continue
          }

          if (BENEFITS_LIKE_RE.test(fragment)) {
            addItems(
              buckets.benefits,
              [fragment],
              0.56,
              {
                adapter,
                method: "heuristic",
                source_path: "responsibilities.sanitized",
                source_excerpt: fragment.slice(0, 200),
              },
              14
            )
          }
        }
        continue
      }

      const withoutLeadIn = candidate
        .replace(/^(what you(?:'|’)ll do|what you will do)\b[:\s-]*/i, "")
        .trim()

      if (withoutLeadIn.length < 16) continue

      if (PREFERRED_LIKE_RE.test(withoutLeadIn) || REQUIREMENT_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          PREFERRED_LIKE_RE.test(withoutLeadIn)
            ? buckets.preferred_qualifications
            : buckets.requirements,
          [withoutLeadIn],
          0.6,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (BENEFITS_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          buckets.benefits,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (COMPANY_LIKE_RE.test(withoutLeadIn) || PROMOTIONAL_LIKE_RE.test(withoutLeadIn)) {
        addItems(
          buckets.company_info,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      const startsWithCompanyVoice =
        (/^(we|our)\b/i.test(withoutLeadIn) ||
          /^[A-Z][A-Za-z0-9&.' -]{1,48}\s+(is|are|has|have|was|were)\b/.test(withoutLeadIn)) &&
        !/\byou\b/i.test(withoutLeadIn)

      if (startsWithCompanyVoice && COMPANY_POSITIONING_RE.test(withoutLeadIn)) {
        addItems(
          buckets.company_info,
          [withoutLeadIn],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "responsibilities.sanitized",
            source_excerpt: withoutLeadIn.slice(0, 200),
          },
          14
        )
        continue
      }

      if (RESPONSIBILITY_LIKE_RE.test(withoutLeadIn)) {
        kept.push(withoutLeadIn)
      }
    }
  }

  const refined = uniqCaseInsensitive(kept, 12)
  if (refined.length > 0) {
    buckets.responsibilities.items = refined
    buckets.responsibilities.provenance.push({
      adapter,
      method: "heuristic",
      source_path: "responsibilities.refined",
    })
    return
  }

  buckets.responsibilities.items = uniqCaseInsensitive(
    buckets.responsibilities.items.filter(
      (item) =>
        RESPONSIBILITY_LIKE_RE.test(item) &&
        !REQUIREMENT_LIKE_RE.test(item) &&
        !PREFERRED_LIKE_RE.test(item) &&
        !BENEFITS_LIKE_RE.test(item) &&
        !COMPANY_LIKE_RE.test(item) &&
        !PROMOTIONAL_LIKE_RE.test(item) &&
        !COMPANY_POSITIONING_RE.test(item) &&
        !/^(we|our)\b/i.test(item) &&
        !/^[A-Z][A-Za-z0-9&.' -]{1,48}\s+(is|are|has|have|was|were)\b/.test(item)
    ),
    8
  )
}

function sanitizeBenefitsBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.benefits.items.length === 0) return

  const kept: string[] = []

  for (const item of buckets.benefits.items) {
    const splitByApplicationMarkers = splitApplicationInfoFragments(item)
    const candidates =
      splitByApplicationMarkers.length > 0 && splitByApplicationMarkers.length !== 1
        ? splitByApplicationMarkers
        : item.length > 260
          ? splitIntoSentences(item).map((line) => line.trim())
          : [item]

    for (const candidate of candidates) {
      if (candidate.length < 14 || candidate.length > 220) continue

      const normalizedCandidate = candidate
        .replace(/^(additional\s+)?benefits?\s+for\s+this\s+role\s+may\s+include:\s*/i, "")
        .replace(/^for\s+this\s+role\s+may\s+include:\s*/i, "")
        .trim()
      if (normalizedCandidate.length < 12) continue

      if (APPLICATION_LIKE_RE.test(normalizedCandidate) || LOCATION_META_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.application_info,
          [normalizedCandidate],
          0.6,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (BENEFITS_LIKE_RE.test(normalizedCandidate)) {
        kept.push(normalizedCandidate)
        continue
      }

      if (COMPANY_LIKE_RE.test(normalizedCandidate) || PROMOTIONAL_LIKE_RE.test(normalizedCandidate)) {
        addItems(
          buckets.company_info,
          [normalizedCandidate],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "benefits.sanitized",
            source_excerpt: normalizedCandidate.slice(0, 200),
          },
          14
        )
        continue
      }

      if (!REQUIREMENT_LIKE_RE.test(normalizedCandidate) && !PREFERRED_LIKE_RE.test(normalizedCandidate)) {
        kept.push(normalizedCandidate)
      }
    }
  }

  buckets.benefits.items = uniqNearDuplicate(kept, 12)
}

function sanitizeApplicationInfoBucket(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.application_info.items.length === 0) return

  const kept: string[] = []
  for (const item of buckets.application_info.items) {
    const fragments = splitApplicationInfoFragments(item)
    for (const fragment of fragments.length > 0 ? fragments : [item]) {
      if (fragment.length < 12 || fragment.length > 220) continue

      if (COMPANY_LIKE_RE.test(fragment) || PROMOTIONAL_LIKE_RE.test(fragment)) {
        addItems(
          buckets.company_info,
          [fragment],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "application_info.sanitized",
            source_excerpt: fragment.slice(0, 200),
          },
          14
        )
        continue
      }

      if (BENEFITS_LIKE_RE.test(fragment)) {
        addItems(
          buckets.benefits,
          [fragment],
          0.56,
          {
            adapter,
            method: "heuristic",
            source_path: "application_info.sanitized",
            source_excerpt: fragment.slice(0, 200),
          },
          14
        )
        continue
      }

      if (APPLICATION_LIKE_RE.test(fragment) || LOCATION_META_LIKE_RE.test(fragment)) {
        kept.push(fragment)
      }
    }
  }

  buckets.application_info.items = uniqNearDuplicate(kept, 12)
}

function refineAboutRole(
  buckets: Record<CanonicalSectionKey, SectionBucket>,
  adapter: SourceAdapterKind
) {
  if (buckets.about_role.items.length === 0) return

  const candidates = buckets.about_role.items
    .flatMap((item) => splitIntoSentences(item))
    .map((item) => item.trim())
    .filter((item) => item.length >= 40 && item.length <= 260)
    .filter((item) => !ABOUT_BLOCKED_RE.test(item))
    .filter((item) => !RESPONSIBILITY_LIKE_RE.test(item))
    .filter((item) => !REQUIREMENT_LIKE_RE.test(item))
    .filter((item) => !PREFERRED_LIKE_RE.test(item))
    .filter((item) => !COMPANY_LIKE_RE.test(item))
    .filter((item) => !COMPANY_POSITIONING_RE.test(item))
    .filter((item) => !PROMOTIONAL_LIKE_RE.test(item))

  const refined = uniqCaseInsensitive(candidates, 3)
  if (refined.length > 0) {
    buckets.about_role.items = refined
    return
  }

  const fallback = splitIntoSentences(buckets.about_role.items[0] ?? "")
    .map((item) => item.trim())
    .filter((item) => item.length >= 40 && item.length <= 220)
    .filter((item) => !ABOUT_BLOCKED_RE.test(item))
    .filter((item) => !RESPONSIBILITY_LIKE_RE.test(item))
    .filter((item) => !REQUIREMENT_LIKE_RE.test(item))
    .filter((item) => !PREFERRED_LIKE_RE.test(item))
    .filter((item) => !COMPANY_LIKE_RE.test(item))
    .filter((item) => !COMPANY_POSITIONING_RE.test(item))
    .filter((item) => !PROMOTIONAL_LIKE_RE.test(item))
    .slice(0, 2)

  if (fallback.length > 0) {
    buckets.about_role.items = uniqCaseInsensitive(fallback, 2)
    buckets.about_role.isFallback = true
    buckets.about_role.provenance.push({
      adapter,
      method: "fallback",
      source_path: "about_role.refined",
    })
  }
}

function removeCrossSectionDuplicates(
  buckets: Record<CanonicalSectionKey, SectionBucket>
) {
  const seen = new Set<string>()
  const precedence: CanonicalSectionKey[] = [
    "requirements",
    "preferred_qualifications",
    "responsibilities",
    "about_role",
    "benefits",
    "company_info",
    "application_info",
    "other",
  ]

  for (const key of precedence) {
    const bucket = buckets[key]
    const next: string[] = []
    for (const item of bucket.items) {
      const normalized = normalizeForCompare(item)
      if (!normalized) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      next.push(item)
    }
    bucket.items = next
  }
}

function trimSectionItemCounts(buckets: Record<CanonicalSectionKey, SectionBucket>) {
  buckets.about_role.items = buckets.about_role.items.slice(0, 3)
  buckets.responsibilities.items = buckets.responsibilities.items.slice(0, 10)
  buckets.requirements.items = buckets.requirements.items.slice(0, 10)
  buckets.preferred_qualifications.items = buckets.preferred_qualifications.items.slice(0, 8)
}

export function extractCanonicalSections(input: {
  adapter: SourceAdapterKind
  description: string | null
  structuredSections?: Partial<Record<CanonicalSectionKey, string[]>>
}): Record<CanonicalSectionKey, CanonicalSection> {
  const buckets = createEmptyBuckets()

  for (const key of CANONICAL_SECTION_ORDER) {
    if (key === "header") continue
    const structuredItems = input.structuredSections?.[key] ?? []
    if (structuredItems.length === 0) continue

    addItems(
      buckets[key],
      structuredItems,
      0.95,
      {
        adapter: input.adapter,
        method: "structured",
        source_path: `structured.${key}`,
      },
      key === "other" ? 20 : 30
    )
  }

  if (input.description) {
    const explicitSegments = extractExplicitHeadingSegments(input.description)
    for (const segment of explicitSegments) {
      const classification = classifyHeading(segment.heading)
      const items = itemsFromTextBlock(segment.body)
      if (items.length === 0) continue

      addItems(
        buckets[classification.key],
        items,
        0.9,
        {
          adapter: input.adapter,
          method: "heading",
          source_path: "description",
          source_heading: segment.heading,
          source_excerpt: segment.body.slice(0, 240),
        },
        classification.key === "other" ? 18 : 30
      )
    }

    const inlineSegments = extractInlineHeadingSegments(input.description)
    for (const segment of inlineSegments) {
      const items = itemsFromTextBlock(segment.body)
      if (items.length === 0) continue

      addItems(
        buckets[segment.key],
        items,
        0.82,
        {
          adapter: input.adapter,
          method: "heading",
          source_path: "description.inline",
          source_heading: segment.heading,
          source_excerpt: segment.body.slice(0, 240),
        },
        segment.key === "other" ? 18 : 30
      )
    }

    const parsed = parseJobDescriptionSections(input.description)
    for (const section of parsed) {
      const items = flattenSectionContent(section)
      if (items.length === 0) continue

      const headingClassification = classifyHeading(section.heading)
      const textBlob = [section.heading, ...section.paragraphs, ...section.bullets]
        .filter(Boolean)
        .join(" ")
      const heuristicClassification = classifyTextByHeuristic(textBlob)

      const classification =
        headingClassification.key !== "other"
          ? headingClassification
          : heuristicClassification

      const method =
        headingClassification.key !== "other" ? "heading" : "heuristic"

      addItems(
        buckets[classification.key],
        items,
        classification.confidence,
        {
          adapter: input.adapter,
          method,
          source_path: "description",
          source_heading: section.heading,
          source_excerpt: textBlob.slice(0, 240),
        },
        classification.key === "other" ? 18 : 30
      )
    }

    fallbackFromFirstParagraphs(buckets, input.description, input.adapter)
    fallbackResponsibilities(buckets, input.adapter)
    fallbackRequirements(buckets, input.adapter)
    enrichFromMixedText(buckets, input.adapter)
    rebalanceQualificationBuckets(buckets, input.adapter)
    sanitizeResponsibilitiesBucket(buckets, input.adapter)
    sanitizeQualificationBuckets(buckets, input.adapter)
    sanitizeBenefitsBucket(buckets, input.adapter)
    sanitizeApplicationInfoBucket(buckets, input.adapter)
    refineAboutRole(buckets, input.adapter)
    removeCrossSectionDuplicates(buckets)
    trimSectionItemCounts(buckets)
  }

  const sections = {} as Record<CanonicalSectionKey, CanonicalSection>

  for (const key of CANONICAL_SECTION_ORDER) {
    const bucket = buckets[key]
    sections[key] = {
      key,
      label: sectionLabel(key),
      items: bucket.items,
      confidence: sectionConfidence(bucket),
      provenance: bucket.provenance,
      is_fallback: bucket.isFallback,
    }
  }

  return sections
}
