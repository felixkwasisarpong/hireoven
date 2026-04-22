const DEFAULT_TIMEOUT_MS = 12_000
const MIN_DESCRIPTION_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 12_000
const WORKDAY_DESCRIPTION_PAGE_SIZE = 20
const WORKDAY_DESCRIPTION_MAX_OFFSETS = 15
const SECTION_HEADING_PATTERNS = [
  /^about (the )?role$/i,
  /^about (the )?team$/i,
  /^about (you|us)$/i,
  /^job description$/i,
  /^responsibilities$/i,
  /^what you'll do$/i,
  /^what you will do$/i,
  /^what we're looking for$/i,
  /^what we are looking for$/i,
  /^minimum qualifications$/i,
  /^basic qualifications$/i,
  /^preferred qualifications$/i,
  /^requirements$/i,
  /^nice to have$/i,
  /^benefits$/i,
]
const INLINE_SECTION_HEADINGS = [
  "How You Will Make A Difference",
  "Who You Are",
  "Responsibilities",
  "Requirements",
  "Qualifications",
  "Basic Qualifications",
  "Preferred Qualifications",
  "Minimum Qualifications",
  "Nice to Have",
  "What You'll Do",
  "What You Will Do",
  "About the Role",
  "About You",
  "About Us",
  "Benefits",
]

function isGoogleCareersJobUrl(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "www.google.com" &&
    (url.pathname.includes("/about/careers/applications/jobs/results/") ||
      url.pathname.includes("/about/careers/applications/jobs/jobs/results/"))
  )
}

function isWorkdayJobUrl(url: URL): boolean {
  return (
    url.hostname.toLowerCase().includes("myworkdayjobs.com") &&
    /\/job\//i.test(url.pathname)
  )
}

export function normalizeJobApplyUrl(input: string): string {
  try {
    const url = new URL(input)

    if (isGoogleCareersJobUrl(url)) {
      url.pathname = url.pathname.replace(
        "/about/careers/applications/jobs/jobs/results/",
        "/about/careers/applications/jobs/results/"
      )
      url.searchParams.delete("page")
    }

    if (isWorkdayJobUrl(url)) {
      url.pathname = url.pathname.replace(/\/apply\/?$/i, "")
    }

    return url.toString()
  } catch {
    return input
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "–")
    .replace(/&bull;/gi, "•")
}

function collapseWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value) || /&lt;[a-z][\s\S]*&gt;/i.test(value)
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

function stripDescriptionArtifacts(value: string): string {
  return value
    .replace(/\b(data-[a-z-]+|class|style|font-family|font-size|margin|padding|color)\s*:\s*[^;]+;?/gi, " ")
    .replace(/\b(MSFontService|Verdana_EmbeddedFont|MsoNormal|msonormal|charstyle|Properties)\b/gi, " ")
    .replace(/\[[0-9.,'" ]+\]/g, " ")
    .replace(/\{[0-9a-f-]{8,}\}/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeSerializedJsonString(raw: string): string | null {
  try {
    return JSON.parse(`"${raw.replace(/\r?\n/g, "\\n")}"`) as string
  } catch {
    return null
  }
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

function extractDescriptionFromMetaTags(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  ]

  for (const pattern of patterns) {
    const raw = html.match(pattern)?.[1]?.trim()
    if (!raw) continue
    const cleaned = cleanJobDescription(raw)
    if (cleaned) return cleaned
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

  const decoded = decodeHtmlEntities(input)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim()

  const normalizedInput = looksLikeHtml(decoded) ? htmlToText(decoded) : decoded
  const text = collapseWhitespace(stripDescriptionArtifacts(normalizedInput))

  if (!text) return null
  const trimmed = trimDescription(text)
  if (!isPlausibleDescription(trimmed)) return null
  return trimmed
}

function isSectionHeading(line: string): boolean {
  const normalized = line.replace(/:$/, "").trim()
  if (!normalized || normalized.length > 80) return false
  if (SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  if (/^[A-Z0-9 /&(),+-]+$/.test(normalized) && /[A-Z]/.test(normalized)) return true
  if (/^[A-Z][A-Za-z0-9 /&(),'+-]+:$/.test(line)) return true
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeDescriptionForSections(input: string): string {
  let output = input.replace(/\u2022/g, "•")

  for (const heading of INLINE_SECTION_HEADINGS) {
    const pattern = new RegExp(`\\s(${escapeRegExp(heading)}:)\\s*`, "gi")
    output = output.replace(pattern, "\n\n$1\n")
  }

  output = output
    .replace(/:\s*-\s+/g, ":\n- ")
    .replace(/\s*•\s+/g, "\n• ")
    .replace(
      /\s([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9 /&(),'+-]{2,80}:)\s+/g,
      "\n\n$1\n"
    )

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

function splitLongParagraph(line: string): string[] {
  if (line.length <= 360) return [line]

  const sentences = line
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9])/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (sentences.length <= 2) return [line]

  const chunks: string[] = []
  let current = ""

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > 320 && current) {
      chunks.push(current)
      current = sentence
      continue
    }
    current = candidate
  }

  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [line]
}

export type JobDescriptionSection = {
  heading: string | null
  paragraphs: string[]
  bullets: string[]
}

export function parseJobDescriptionSections(
  description: string | null | undefined
): JobDescriptionSection[] {
  const cleaned = cleanJobDescription(description)
  if (!cleaned) return []

  const normalized = normalizeDescriptionForSections(cleaned)

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const sections: JobDescriptionSection[] = []
  let current: JobDescriptionSection = { heading: null, paragraphs: [], bullets: [] }

  const pushCurrent = () => {
    if (!current.heading && current.paragraphs.length === 0 && current.bullets.length === 0) return
    sections.push(current)
    current = { heading: null, paragraphs: [], bullets: [] }
  }

  for (const line of lines) {
    if (isSectionHeading(line)) {
      pushCurrent()
      current.heading = line.replace(/:$/, "").trim()
      continue
    }

    if (/^[-*•]\s+/.test(line)) {
      const rawBullet = line.replace(/^[-*•]\s+/, "").trim()
      const splitBullets = rawBullet
        .split(/\s+-\s+(?=[A-Z0-9])/g)
        .map((item) => item.trim())
        .filter(Boolean)
      current.bullets.push(...splitBullets)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      current.bullets.push(line.replace(/^\d+\.\s+/, "").trim())
      continue
    }

    current.paragraphs.push(...splitLongParagraph(line))
  }

  pushCurrent()
  return sections.length > 0
    ? sections
    : [{ heading: null, paragraphs: [normalized], bullets: [] }]
}

function extractGoogleDescriptionFromHtml(html: string): string | null {
  const markers = [
    "<h3>Minimum qualifications:",
    "<h3>Preferred qualifications:",
    "<h3>About the job</h3>",
    "<h3>Responsibilities</h3>",
  ]

  const start = markers
    .map((marker) => html.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  if (start == null) return null

  const endMarkers = [
    "Information collected and processed as part of your Google Careers profile",
    "Applicant and Candidate Privacy Policy",
  ]

  const end = endMarkers
    .map((marker) => html.indexOf(marker, start))
    .filter((index) => index > start)
    .sort((left, right) => left - right)[0]

  return cleanJobDescription(html.slice(start, end && end > start ? end : start + 40_000))
}

function extractShopifyDescriptionFromHtml(html: string): string | null {
  const tokenSets = [
    {
      startToken: '\\"descriptionHtml\\",\\"',
      markers: [
        '\\",\\"descriptionSocial\\"',
        '\\",\\"descriptionParts\\"',
        '\\",\\"departmentName\\"',
      ],
    },
    {
      startToken: '"descriptionHtml","',
      markers: ['","descriptionSocial"', '","descriptionParts"', '","departmentName"'],
    },
  ]

  let raw: string | null = null
  for (const tokenSet of tokenSets) {
    const start = html.indexOf(tokenSet.startToken)
    if (start < 0) continue

    const rawStart = start + tokenSet.startToken.length
    const end = tokenSet.markers
      .map((marker) => html.indexOf(marker, rawStart))
      .filter((index) => index > rawStart)
      .sort((left, right) => left - right)[0]

    raw = html.slice(rawStart, end > rawStart ? end : rawStart + 30_000)
    if (raw) break
  }

  if (!raw) return null

  const decoded = decodeSerializedJsonString(raw)
  if (!decoded) return null
  return cleanJobDescription(decoded)
}

function parseWorkdayDetailContext(url: URL):
  | { tenantHost: string; tenant: string; site: string; normalizedPath: string }
  | null {
  const host = url.hostname.toLowerCase()
  if (!host.includes("myworkdayjobs.com")) return null

  const tenant = host.split(".")[0]
  if (!tenant) return null

  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part).trim())
    .filter(Boolean)

  const locale = parts[0] && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0]) ? parts[0] : null
  const site = locale ? parts[1] : parts[0]
  if (!site) return null

  return {
    tenantHost: host,
    tenant,
    site,
    normalizedPath: url.pathname.replace(/^\/+/, ""),
  }
}

async function fetchWorkdayDescriptionFromUrl(url: URL): Promise<string | null> {
  const context = parseWorkdayDetailContext(url)
  if (!context) return null

  const jobsApi = `https://${context.tenantHost}/wday/cxs/${encodeURIComponent(
    context.tenant
  )}/${encodeURIComponent(context.site)}/jobs`

  for (
    let offset = 0;
    offset < WORKDAY_DESCRIPTION_PAGE_SIZE * WORKDAY_DESCRIPTION_MAX_OFFSETS;
    offset += WORKDAY_DESCRIPTION_PAGE_SIZE
  ) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
      const response = await fetch(jobsApi, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; HireovenDescriptionBot/1.0; +https://hireoven.com)",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: WORKDAY_DESCRIPTION_PAGE_SIZE,
          offset,
          searchText: "",
        }),
      })

      if (!response.ok) break

      const payload = (await response.json()) as {
        jobPostings?: Array<{ externalPath?: string; bulletFields?: string[] }>
      }

      const postings = payload.jobPostings ?? []
      if (postings.length === 0) break

      for (const posting of postings) {
        if (!posting.externalPath) continue

        const postingUrl = new URL(
          `${context.site}${posting.externalPath}`.replace(/([^:]\/)\/+/g, "$1"),
          `https://${context.tenantHost}/`
        )

        if (postingUrl.pathname.replace(/^\/+/, "") !== context.normalizedPath) continue

        const cleaned = cleanJobDescription(posting.bulletFields?.join("\n") ?? null)
        if (cleaned) return cleaned
      }

      if (postings.length < WORKDAY_DESCRIPTION_PAGE_SIZE) break
    } catch {
      break
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
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

  if (best) return best

  const fromMeta = extractDescriptionFromMetaTags(html)
  if (fromMeta) return fromMeta

  return null
}

export async function fetchJobDescription(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const normalizedUrl = normalizeJobApplyUrl(url)
  const parsedUrl = (() => {
    try {
      return new URL(normalizedUrl)
    } catch {
      return null
    }
  })()

  if (parsedUrl && isWorkdayJobUrl(parsedUrl)) {
    const workdayDescription = await fetchWorkdayDescriptionFromUrl(parsedUrl)
    if (workdayDescription) return workdayDescription
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HireovenDescriptionBot/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return null

    const html = await response.text()
    if (parsedUrl && isGoogleCareersJobUrl(parsedUrl)) {
      const googleDescription = extractGoogleDescriptionFromHtml(html)
      if (googleDescription) return googleDescription
    }
    if (parsedUrl?.hostname.toLowerCase().endsWith("shopify.com")) {
      const shopifyDescription = extractShopifyDescriptionFromHtml(html)
      if (shopifyDescription) return shopifyDescription
    }
    return extractJobDescriptionFromHtml(html)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
