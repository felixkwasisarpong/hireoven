import { extractSkillsFromText as extractCanonicalSkillsFromText } from "@/lib/skills/taxonomy"

const SENIORITY_PREFIXES = [
  "senior",
  "sr",
  "staff",
  "principal",
  "lead",
  "junior",
  "jr",
  "intern",
  "director",
  "vp",
  "head",
]

const TITLE_NOISE_PATTERNS = [
  /\bapplication deadline\s*:.*$/i,
  /\bsave for later\b.*$/i,
  /\breq(?:uisition)?(?:\s+id)?\s*[:#]?\s*[a-z0-9-]+.*$/i,
  /\bjob(?:\s+id)?\s*[:#]?\s*[a-z0-9-]+.*$/i,
  // Trailing literal "null" fields (iCIMS / SmartRecruiters cards)
  /\s*\|\s*null\b.*$/i,
]

// Leading date prefix patterns — generic scrapers sometimes capture the full
// card which starts with "April 24, 2026" or "[2026]" before the actual title.
const LEADING_DATE_RE =
  /^(?:\[\d{4}\]\s*|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\s+)/i

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
}

function collapseDuplicateTail(value: string): string {
  const repeatedLocation = value.match(
    /^(.*?)(\s*-\s*[A-Za-z .'-]+,\s?[A-Z]{2})(?:\s+\2)+$/i
  )
  if (repeatedLocation) {
    return `${repeatedLocation[1]}${repeatedLocation[2]}`.trim()
  }

  const repeatedRemote = value.match(/^(.*?)(\s*-\s*remote)(?:\s+\2)+$/i)
  if (repeatedRemote) {
    return `${repeatedRemote[1]}${repeatedRemote[2]}`.trim()
  }

  return value
}

export function cleanJobTitle(title: string): string {
  let cleaned = decodeHtmlEntities(title)
    .replace(/\s+/g, " ")
    .trim()

  // Reject CSS / code strings up front — styled-components serializes class
  // names as link text on JS-rendered pages the crawler can't execute.
  if (/^\s*\.css-[a-z0-9]+\{/i.test(cleaned) || cleaned.includes("{-webkit-")) {
    return ""
  }

  // Strip leading date prefix — generic card text often starts with the post date.
  cleaned = cleaned.replace(LEADING_DATE_RE, "").trim()

  for (const pattern of TITLE_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim()
  }

  // Strip everything after the first " | " — these are metadata fields
  // (location, employment type, literal "null") appended by SmartRecruiters /
  // iCIMS Jibe / Lever card layouts.
  const pipeIdx = cleaned.indexOf(" | ")
  if (pipeIdx > 3) cleaned = cleaned.slice(0, pipeIdx).trim()

  // Strip card bleed: if the title has accumulated description text, trim at
  // the first sentence boundary after the likely title portion (≤ 120 chars).
  if (cleaned.length > 120) {
    // Try cutting at the first ". " that leaves a reasonable title
    const sentenceBreak = cleaned.search(/\.\s+[A-Z]/)
    if (sentenceBreak > 20 && sentenceBreak < 120) {
      cleaned = cleaned.slice(0, sentenceBreak).trim()
    } else {
      // Fallback: hard-truncate at word boundary near 120 chars
      const truncated = cleaned.slice(0, 120)
      const lastSpace = truncated.lastIndexOf(" ")
      cleaned = (lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated).trim()
    }
  }

  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-|/]\s*$/, "")
    .trim()

  cleaned = collapseDuplicateTail(cleaned)

  return cleaned || title.trim()
}

export function normalizeJobTitle(title: string): string {
  const cleaned = cleanJobTitle(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return title

  const words = cleaned.split(" ")
  const filtered = words.filter((word, idx) => {
    if (idx === 0) return true
    return !SENIORITY_PREFIXES.includes(word.toLowerCase().replace(/[.,]/g, ""))
  })

  const result = filtered.join(" ").trim()
  return result || cleaned
}

export function extractSkillsFromText(...parts: Array<string | null | undefined>): string[] {
  return extractCanonicalSkillsFromText(...parts)
}
