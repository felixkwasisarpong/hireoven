import Anthropic from '@anthropic-ai/sdk'
import { logApiUsage } from '@/lib/admin/usage'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
  },
}

export interface VisaAnalysis {
  sponsors_h1b: boolean | null
  requires_authorization: boolean
  visa_language_detected: string | null
  sponsorship_score: number
}

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
]

const SKILL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "javascript", pattern: /\bjavascript\b/i },
  { label: "typescript", pattern: /\btypescript\b/i },
  { label: "node", pattern: /\bnode(?:\.js)?\b/i },
  { label: "react", pattern: /\breact(?:\.js)?\b/i },
  { label: "next.js", pattern: /\bnext(?:\.js)?\b/i },
  { label: "python", pattern: /\bpython\b/i },
  { label: "java", pattern: /\bjava\b/i },
  { label: "go", pattern: /\bgo(?:lang)?\b/i },
  { label: "rust", pattern: /\brust\b/i },
  { label: "sql", pattern: /\bsql\b/i },
  { label: "postgres", pattern: /\bpostgres(?:ql)?\b/i },
  { label: "mysql", pattern: /\bmysql\b/i },
  { label: "mongodb", pattern: /\bmongodb\b/i },
  { label: "redis", pattern: /\bredis\b/i },
  { label: "aws", pattern: /\baws\b/i },
  { label: "gcp", pattern: /\bgcp\b|google cloud/i },
  { label: "azure", pattern: /\bazure\b/i },
  { label: "docker", pattern: /\bdocker\b/i },
  { label: "kubernetes", pattern: /\bkubernetes\b|\bk8s\b/i },
  { label: "terraform", pattern: /\bterraform\b/i },
  { label: "graphql", pattern: /\bgraphql\b/i },
  { label: "rest", pattern: /\brest(?:ful)?\b/i },
  { label: "spark", pattern: /\bspark\b/i },
  { label: "airflow", pattern: /\bairflow\b/i },
  { label: "pandas", pattern: /\bpandas\b/i },
  { label: "machine learning", pattern: /\bmachine learning\b/i },
  { label: "deep learning", pattern: /\bdeep learning\b/i },
]

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

  for (const pattern of TITLE_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim()
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
  const blob = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!blob) return []

  const found = new Set<string>()
  for (const skill of SKILL_PATTERNS) {
    if (skill.pattern.test(blob)) {
      found.add(skill.label)
    }
  }

  return [...found]
}

export async function detectVisaLanguage(description: string): Promise<VisaAnalysis> {
  const truncated = description.slice(0, 3000)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Analyze this job description for visa/work authorization language.
Return ONLY a JSON object:
- sponsors_h1b: true if job explicitly says they sponsor H1B/visas, false if explicitly says no sponsorship, null if not mentioned
- requires_authorization: true if job says must be authorized to work without sponsorship now or in the future
- visa_language_detected: the exact sentence or phrase about work authorization if found, null if none
- sponsorship_score: 0-100 score where:
  100 = explicitly sponsors H1B
  80 = says open to sponsorship
  60 = no mention either way (neutral)
  20 = implies no sponsorship
  0 = explicitly states no sponsorship

Job description:
${truncated}

Return ONLY valid JSON.`,
      },
    ],
  })

  const pricing = MODEL_PRICING['claude-haiku-4-5-20251001']
  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const estimatedCost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion

  await logApiUsage({
    service: 'claude',
    operation: 'detect_visa',
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(estimatedCost.toFixed(6)),
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}'

  try {
    const parsed = JSON.parse(text)
    return {
      sponsors_h1b: parsed.sponsors_h1b ?? null,
      requires_authorization: Boolean(parsed.requires_authorization),
      visa_language_detected: parsed.visa_language_detected ?? null,
      sponsorship_score: typeof parsed.sponsorship_score === 'number'
        ? Math.min(100, Math.max(0, parsed.sponsorship_score))
        : 60,
    }
  } catch {
    return { sponsors_h1b: null, requires_authorization: false, visa_language_detected: null, sponsorship_score: 60 }
  }
}
