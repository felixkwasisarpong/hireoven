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

const GO_LANGUAGE_SIGNAL_RE =
  /\b(?:go\s+language|go\s+(?:developer|engineer|backend|services?|microservices?|sdk|runtime)|written in go|using go|experience\s+(?:with|in)\s+go|proficien(?:cy|t)\s+(?:with|in)\s+go|knowledge of go|expertise in go|fluency in go|(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php)\s*(?:,|\/|\band\b)\s*go|go\s*(?:,|\/|\band\b)\s*(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php))\b/i

function hasGoLanguageSignal(blob: string): boolean {
  if (!/\bgo(?:lang)?\b/i.test(blob)) return false
  if (/\bgolang\b/i.test(blob)) return true
  return GO_LANGUAGE_SIGNAL_RE.test(blob)
}

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
  if (hasGoLanguageSignal(blob)) {
    found.add("go")
  }

  return [...found]
}
