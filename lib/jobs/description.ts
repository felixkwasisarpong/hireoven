const DEFAULT_TIMEOUT_MS = 12_000
const MIN_DESCRIPTION_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 12_000

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function collapseWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function stripBlockedSections(html: string): string {
  let output = html
  const blockedTags = [
    "script",
    "style",
    "noscript",
    "svg",
    "form",
    "header",
    "footer",
    "nav",
    "aside",
  ]

  for (const tag of blockedTags) {
    output = output.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      " "
    )
  }

  return output
}

function htmlToText(html: string): string {
  const withBreaks = stripBlockedSections(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")

  return collapseWhitespace(decodeHtmlEntities(withBreaks))
}

function isPlausibleDescription(text: string): boolean {
  if (text.length < MIN_DESCRIPTION_LENGTH) return false
  const letterCount = (text.match(/[a-z]/gi) ?? []).length
  if (letterCount < 80) return false
  if (!/[.!?]/.test(text)) return false
  return true
}

function trimDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text
  const trimmed = text.slice(0, MAX_DESCRIPTION_LENGTH)
  const breakAt = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf(". "))
  if (breakAt < MIN_DESCRIPTION_LENGTH) return trimmed.trim()
  return trimmed.slice(0, breakAt + 1).trim()
}

function walkJson(value: unknown, cb: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, cb)
    return
  }
  if (!value || typeof value !== "object") return
  const obj = value as Record<string, unknown>
  cb(obj)
  for (const child of Object.values(obj)) {
    walkJson(child, cb)
  }
}

function jsonLdTypeIncludes(node: Record<string, unknown>, expected: string): boolean {
  const typeRaw = node["@type"]
  const values = Array.isArray(typeRaw) ? typeRaw : [typeRaw]
  return values
    .map((value) => String(value ?? "").toLowerCase())
    .includes(expected.toLowerCase())
}

function extractDescriptionFromJsonLd(html: string): string | null {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  for (const match of html.matchAll(scriptRegex)) {
    const raw = (match[1] ?? "").trim()
    if (!raw) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    let best: string | null = null

    walkJson(parsed, (node) => {
      if (!jsonLdTypeIncludes(node, "JobPosting")) return
      const candidate = cleanJobDescription(
        String(node.description ?? node.responsibilities ?? "").trim()
      )
      if (!candidate) return
      if (!best || candidate.length > best.length) {
        best = candidate
      }
    })

    if (best) return best
  }

  return null
}

function extractBodyHtml(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
  return body ?? html
}

function extractSectionCandidates(html: string): string[] {
  const out: string[] = []
  const body = extractBodyHtml(html)
  out.push(body)

  const mainSection = body.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]
  if (mainSection) out.push(mainSection)

  const keywordSectionRegex =
    /<(main|section|article|div)\b[^>]*(?:id|class)=["'][^"']*(job[-_ ]?description|description|posting|position|details|content|role)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi
  for (const match of body.matchAll(keywordSectionRegex)) {
    const section = match[3]?.trim()
    if (section) out.push(section)
  }

  return out
}

export function cleanJobDescription(input: string | null | undefined): string | null {
  if (!input) return null

  const text = collapseWhitespace(
    decodeHtmlEntities(input)
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim()
  )

  if (!text) return null
  const trimmed = trimDescription(text)
  if (!isPlausibleDescription(trimmed)) return null
  return trimmed
}

export function extractJobDescriptionFromHtml(html: string): string | null {
  const fromJsonLd = extractDescriptionFromJsonLd(html)
  if (fromJsonLd) return fromJsonLd

  let best: string | null = null
  let bestScore = -1

  for (const section of extractSectionCandidates(html)) {
    const asText = cleanJobDescription(htmlToText(section))
    if (!asText) continue

    const keywordBonus =
      /\b(responsibilities|requirements|qualifications|about the role|what you'll do|what you will do)\b/i.test(
        asText
      )
        ? 250
        : 0
    const score = asText.length + keywordBonus
    if (score > bestScore) {
      best = asText
      bestScore = score
    }
  }

  return best
}

export async function fetchJobDescription(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HireovenDescriptionBot/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return null

    const html = await response.text()
    return extractJobDescriptionFromHtml(html)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
