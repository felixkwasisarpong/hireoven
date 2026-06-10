export type OpportunityRerankTarget = {
  label: string
  query?: string
}

const OPPORTUNITY_RERANK_RE =
  /\b(?:re-?rank|rank|prioriti[sz]e|triage)\b[\s\S]{0,120}\b(?:opportunit(?:y|ies)|jobs?|roles?)\b|\bdeserves attention today\b/i

const ROLE_TARGETS: Array<{ re: RegExp; label: string; query: string }> = [
  { re: /\b(back[-\s]?end|server[-\s]?side|api)\b/i, label: "Backend Engineering", query: "backend" },
  { re: /\b(front[-\s]?end|ui engineer|client[-\s]?side)\b/i, label: "Frontend Engineering", query: "frontend" },
  { re: /\b(full[-\s]?stack)\b/i, label: "Full-stack Engineering", query: "full stack" },
  { re: /\b(data engineering|data engineer)\b/i, label: "Data Engineering", query: "data engineer" },
  { re: /\b(machine learning|ml engineer|ai engineer|artificial intelligence)\b/i, label: "Machine Learning", query: "machine learning" },
  { re: /\b(devops|sre|site reliability|platform engineering)\b/i, label: "DevOps / Platform", query: "devops" },
  { re: /\b(security engineering|security engineer|appsec)\b/i, label: "Security Engineering", query: "security" },
]

export function isOpportunityRerankMessage(message: string): boolean {
  return OPPORTUNITY_RERANK_RE.test(message.trim())
}

export function extractOpportunityRerankTarget(message: string): OpportunityRerankTarget | null {
  if (!isOpportunityRerankMessage(message)) return null

  const targetText = extractAroundTarget(message)
  const mapped = findRoleTarget(targetText ?? message)
  if (mapped) return mapped

  const fallback = buildFallbackTarget(targetText)
  if (fallback) return fallback

  return { label: "your strongest matches" }
}

function extractAroundTarget(message: string): string | null {
  const around = message.match(/\baround\s+(.+)$/i)
  if (!around?.[1]) return null

  const raw = around[1]
    .replace(/\s+(?:and|then|so|to)\b[\s\S]*$/i, "")
    .replace(/^[\s"'`]+|[\s"'`.!?]+$/g, "")
    .trim()

  return raw.length > 0 ? raw : null
}

function findRoleTarget(text: string): OpportunityRerankTarget | null {
  for (const target of ROLE_TARGETS) {
    if (target.re.test(text)) {
      return { label: target.label, query: target.query }
    }
  }
  return null
}

function buildFallbackTarget(raw: string | null): OpportunityRerankTarget | null {
  if (!raw) return null

  const query = raw
    .replace(/\b(opportunities?|roles?|jobs?|positions?|today|please)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()

  if (query.length < 2 || query.length > 60) return null

  return {
    label: toTitleCase(query),
    query: query.toLowerCase(),
  }
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word)
    .join(" ")
}
