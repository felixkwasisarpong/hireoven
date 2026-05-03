const DEFAULT_TIMEOUT_MS = 12_000
const MIN_DESCRIPTION_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 12_000
const WORKDAY_DESCRIPTION_PAGE_SIZE = 20
const WORKDAY_DESCRIPTION_MAX_OFFSETS = 15

/**
 * All-caps strings that look like UI chrome and must never be treated as
 * section headings, even though they satisfy the ALL-CAPS heuristic.
 */
const BLOCKED_HEADING_PHRASES = new Set([
  "SIGN IN",
  "SIGN UP",
  "LOG IN",
  "LOGIN",
  "APPLY",
  "APPLY NOW",
  "APPLY FOR THIS JOB",
  "APPLY FOR THIS POSITION",
  "SKIP TO CONTENT",
  "SKIP TO MAIN CONTENT",
  "RELATED JOBS",
  "SIMILAR JOBS",
  "MORE JOBS",
  "YOU MAY ALSO LIKE",
  "RECOMMENDED",
  "RECOMMENDED JOBS",
  "SEARCH JOBS",
  "FIND JOBS",
  "JOB SEARCH",
  "BACK TO RESULTS",
  "BACK TO SEARCH",
  "SAVE JOB",
  "SAVE THIS JOB",
  "SAVED",
  "REPORT JOB",
  "SHARE",
  "SHARE JOB",
  "SHARE THIS JOB",
  "CREATE ALERT",
  "CREATE JOB ALERT",
  "JOB ALERT",
  "SIGN IN TO SAVE",
  "GET NOTIFIED",
  "NOTIFICATIONS",
  "HOME",
  "MENU",
  "CLOSE",
  "SEARCH",
  "FILTER",
  "SORT BY",
  "VIEW ALL",
  "LOAD MORE",
  "READ MORE",
  "SEE MORE",
  "LEARN MORE",
  "CLICK HERE",
  "POSTED",
  "EXPIRED",
  "NO LONGER ACCEPTING",
  "POSITION FILLED",
  "COOKIES",
  "COOKIE POLICY",
  "PRIVACY POLICY",
  "TERMS OF SERVICE",
  "TERMS & CONDITIONS",
  "ACCESSIBILITY",
  "LOADING",
])

/**
 * Known ATS-provider-specific HTML anchors. For each provider, these regex
 * patterns find the start of the element containing the real job description.
 * We extract a generous slice starting from that position and score it against
 * the generic candidates — the provider slice gets a large bonus to win.
 */
const PROVIDER_CONTENT_ANCHORS: Record<string, RegExp[]> = {
  greenhouse: [
    /<div[^>]+\bid=["']content["'][^>]*>/i,
    /<div[^>]+\bclass=["'][^"']*\bcontent\b[^"']*["'][^>]*>/i,
  ],
  lever: [
    /<div[^>]+\bclass=["'][^"']*\bmain-section\b[^"']*["'][^>]*>/i,
    /<section[^>]+\bclass=["'][^"']*\bcontent\b[^"']*["'][^>]*>/i,
  ],
  ashby: [
    /<[a-z][a-z0-9]*[^>]+\bdata-testid=["']job-description["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\bjob-description\b[^"']*["'][^>]*>/i,
  ],
  workday: [
    /<[a-z][a-z0-9]*[^>]+\bdata-automation-id=["']jobPostingDescription["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bdata-automation-id=["']jobDescription["'][^>]*>/i,
  ],
  icims: [
    /<[a-z][a-z0-9]*[^>]+\bid=["']jobDescription["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\biCIMS_JobDescription\b[^"']*["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\bjob-description\b[^"']*["'][^>]*>/i,
  ],
  smartrecruiters: [
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\bjob-description\b[^"']*["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bitemprop=["']description["'][^>]*>/i,
  ],
  bamboohr: [
    /<[a-z][a-z0-9]*[^>]+\bid=["']BambooHR-ATS-JobDescription["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\bBH-JobDescription\b[^"']*["'][^>]*>/i,
  ],
  jobvite: [
    /<[a-z][a-z0-9]*[^>]+\bclass=["'][^"']*\bjob-description\b[^"']*["'][^>]*>/i,
    /<[a-z][a-z0-9]*[^>]+\bid=["']jv-job-detail-description["'][^>]*>/i,
  ],
}

/**
 * Post-conversion text noise: lines that are boilerplate UI/chrome surviving
 * after HTML-to-text conversion. Matched line-by-line (case-insensitive,
 * trimmed). An exact match removes the line entirely.
 */
const NOISE_LINE_PATTERNS = [
  /^skip to (main )?content$/i,
  /^sign (in|up)$/i,
  /^log (in|out)$/i,
  /^login$/i,
  /^sign in to (save|create|get|set up)/i,
  /^create (a |an )?job alert/i,
  /^(save|report|share) (this )?job$/i,
  /^apply (now|for this (job|position|role))?$/i,
  /^back to (search|results|jobs)$/i,
  /^similar jobs?$/i,
  /^related jobs?$/i,
  /^you may also like$/i,
  /^recommended (jobs?)?$/i,
  /^(view|see|load) (all |more )?jobs?$/i,
  /^job alerts?$/i,
  /^get notified$/i,
  /^(this )?position (is |has been )?(no longer|not) (accepting|available)/i,
  /^cookies? (policy|settings?|notice|preferences?)$/i,
  /^privacy (policy|notice)$/i,
  /^terms( of (use|service))?$/i,
  /^accessibility$/i,
  /^\d+\s+(applicants?|applied)$/i,
  /^be an early applicant$/i,
  /^easy apply$/i,
  /^promoted$/i,
  /^menu$/i,
  /^home$/i,
  /^search jobs?$/i,
  /^find jobs?$/i,
  /^view all (jobs?|openings?)$/i,
  /^read more$/i,
  /^see more$/i,
  /^learn more$/i,
]

/**
 * Returns true when at least 40% of non-empty lines are chrome (ui-only),
 * indicating the input is a navigation page rather than a real job description.
 */
function chromeDominated(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 4) return false
  const chromeCount = lines.filter((line) =>
    NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))
  ).length
  return chromeCount / lines.length >= 0.4
}

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
  /^skills$/i,
  /^technical skills$/i,
  /^key skills$/i,
  /^benefits$/i,
  /^compensation$/i,
  /^equal opportunity$/i,
  /^eeo$/i,
]
const INLINE_SECTION_HEADINGS = [
  "How You Will Make A Difference",
  "Who You Are",
  "Responsibilities",
  "Requirements",
  "Preferred Qualifications",
  "Minimum Qualifications",
  "Basic Qualifications",
  "Nice to Have",
  "Skills",
  "Technical Skills",
  "Key Skills",
  "Technologies",
  "What You'll Do",
  "What You Will Do",
  "About the Role",
  "About You",
  "About Us",
  "Benefits",
  "Compensation",
  "Equal Opportunity",
  "EEO",
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
    "button",
    "dialog",
    "template",
    "picture",
  ]

  for (const tag of blockedTags) {
    output = output.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      " "
    )
  }

  // Strip ARIA landmark roles that are definitively non-content
  output = output.replace(
    /<[a-z][a-z0-9]*\b[^>]*\brole=["'](navigation|banner|search|dialog|alertdialog|complementary|contentinfo)["'][^>]*>[\s\S]*?<\/[a-z][a-z0-9]*>/gi,
    " "
  )

  // Strip elements whose id or class clearly marks them as noise
  const noiseAttrPattern =
    /\b(sign-?in|sign-?up|log-?in|job-?alert|cookie-?(banner|notice|consent|bar)|related-?jobs?|similar-?jobs?|recommendation|modal-?(overlay|backdrop|wrapper)|auth-?prompt|save-?job|share-?job|report-?job|back-?to-?top|sticky-?(header|bar|footer)|site-?(header|footer|nav)|page-?header|page-?footer|global-?(header|footer|nav))\b/i
  output = output.replace(
    new RegExp(
      `<(div|section|aside|ul|ol)([^>]*)(?:id|class)=["'][^"']*${noiseAttrPattern.source}[^"']*["'][^>]*>[\\s\\S]{0,8000}?<\\/\\1>`,
      "gi"
    ),
    " "
  )

  return output
}

/**
 * Removes known boilerplate/UI-chrome lines from plain text after HTML→text
 * conversion. Works line-by-line so real content is not affected.
 */
function stripTextNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      return !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
    })
    .join("\n")
}

function htmlToText(html: string): string {
  const withBreaks = stripBlockedSections(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")

  return collapseWhitespace(stripTextNoise(decodeHtmlEntities(withBreaks)))
}

function stripDescriptionArtifacts(value: string): string {
  // Preserve newlines so line-level chrome filtering can run after this step.
  return value
    .replace(/\b(data-[a-z-]+|class|style|font-family|font-size|margin|padding|color)\s*:\s*[^;]+;?/gi, " ")
    .replace(/\b(MSFontService|Verdana_EmbeddedFont|MsoNormal|msonormal|charstyle|Properties)\b/gi, " ")
    .replace(/\[[0-9.,'" ]+\]/g, " ")
    .replace(/\{[0-9a-f-]{8,}\}/gi, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
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
      // Meta (and others) use &nbsp; as a bullet separator within fields —
      // convert to newline before cleaning so bullets aren't run together.
      const normalize = (v: unknown) =>
        v ? String(v).replace(/&nbsp;/gi, "\n").trim() : ""
      const parts = [
        normalize(node.description),
        normalize(node.responsibilities),
        normalize(node.qualifications),
      ].filter(Boolean)
      const combined = parts.join("\n\n")
      const candidate = cleanJobDescription(combined || "")
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

/**
 * Finds the character offset of the first match of any anchor pattern for the
 * given provider, or -1 if not found. We extract a slice from that point
 * rather than trying to match balanced HTML with regex.
 */
function findProviderContentOffset(html: string, providerHint: string): number {
  const anchors = PROVIDER_CONTENT_ANCHORS[providerHint.toLowerCase()] ?? []
  for (const pattern of anchors) {
    const match = html.match(pattern)
    if (match?.index != null) return match.index
  }
  return -1
}

function extractSectionCandidates(html: string, providerHint?: string): string[] {
  const out: string[] = []
  const body = extractBodyHtml(html)

  // Provider-specific anchor: extract from the detected element start. The
  // slice is generous (up to 80 000 chars) so nested content is captured.
  // This candidate gets scored first so ties break in its favour below.
  if (providerHint) {
    const offset = findProviderContentOffset(body, providerHint)
    if (offset >= 0) {
      const providerSlice = body.slice(offset, offset + 80_000)
      out.push(providerSlice)
    }
  }

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

  // For non-HTML inputs the noise stripper that normally runs inside
  // htmlToText is skipped \u2014 apply it explicitly so chrome lines
  // ("Skip to main content", "Sign in to create job alert", \u2026) never reach
  // the section bucketing stage.
  const normalizedInput = looksLikeHtml(decoded)
    ? htmlToText(decoded)
    : stripTextNoise(decoded)

  const stripped = stripDescriptionArtifacts(normalizedInput)
  if (chromeDominated(stripped)) return null

  const text = collapseWhitespace(stripped)
  if (!text) return null
  const trimmed = trimDescription(text)
  if (!isPlausibleDescription(trimmed)) return null
  return trimmed
}

function isSectionHeading(line: string): boolean {
  const normalized = line.replace(/:$/, "").trim()
  if (!normalized || normalized.length > 80) return false

  if (SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(normalized))) return true

  // ALL-CAPS heuristic: only treat as a heading when the phrase is not known
  // UI chrome and contains at least one meaningful job-section-related word.
  if (/^[A-Z0-9 /&(),+-]+$/.test(normalized) && /[A-Z]/.test(normalized)) {
    const upper = normalized.toUpperCase()
    if (BLOCKED_HEADING_PHRASES.has(upper)) return false
    // Require at least 5 characters and a job-section keyword to prevent
    // treating generic uppercase navigation labels as headings.
    if (
      normalized.length >= 5 &&
      /\b(ABOUT|ROLE|TEAM|RESPONSIBILITIES|REQUIREMENTS|QUALIFICATIONS|SKILLS|BENEFITS|COMPENSATION|EXPERIENCE|PREFERRED|SUMMARY|OVERVIEW|POSITION|DESCRIPTION|DUTIES)\b/.test(
        upper
      )
    ) {
      return true
    }
    return false
  }

  if (/^[A-Z][A-Za-z0-9 /&(),'+-]+:$/.test(line)) return true
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeDescriptionForSections(input: string): string {
  let output = input.replace(/\u2022/g, "•")

  for (const heading of [...INLINE_SECTION_HEADINGS].sort((left, right) => right.length - left.length)) {
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

export function extractJobDescriptionFromHtml(
  html: string,
  providerHint?: string
): string | null {
  const fromJsonLd = extractDescriptionFromJsonLd(html)
  if (fromJsonLd) return fromJsonLd

  let best: string | null = null
  let bestScore = -1

  const candidates = extractSectionCandidates(html, providerHint)

  for (let i = 0; i < candidates.length; i += 1) {
    const section = candidates[i]!
    const asText = cleanJobDescription(htmlToText(section))
    if (!asText) continue

    const keywordBonus =
      /\b(responsibilities|requirements|qualifications|about the role|what you'll do|what you will do)\b/i.test(
        asText
      )
        ? 250
        : 0

    // The first candidate is the provider-specific slice (when providerHint is
    // set and a match was found). Give it a significant bonus so it wins over a
    // longer but noisy body/sidebar candidate.
    const providerBonus = providerHint && i === 0 ? 2_000 : 0

    const score = asText.length + keywordBonus + providerBonus
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

/**
 * Infer a provider hint from the apply URL so that `extractJobDescriptionFromHtml`
 * can use ATS-specific content anchors. Returns undefined for unknown providers.
 */
function detectProviderFromUrl(url: URL): string | undefined {
  const host = url.hostname.toLowerCase()
  if (host.includes("greenhouse.io") || host.includes("boards.greenhouse")) return "greenhouse"
  if (host.includes("lever.co")) return "lever"
  if (host.includes("ashbyhq.com")) return "ashby"
  if (host.includes("myworkdayjobs.com")) return "workday"
  if (host.includes("icims.com") || host.includes("jibe.com")) return "icims"
  if (host.includes("smartrecruiters.com")) return "smartrecruiters"
  if (host.includes("bamboohr.com")) return "bamboohr"
  if (host.includes("jobvite.com")) return "jobvite"
  return undefined
}

export async function fetchJobDescription(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  providerHint?: string
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

  const resolvedProvider = providerHint ?? (parsedUrl ? detectProviderFromUrl(parsedUrl) : undefined)

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
    return extractJobDescriptionFromHtml(html, resolvedProvider)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
