/**
 * LinkedIn own-profile scraper.
 *
 * Runs only when the user is viewing THEIR OWN profile page.
 * Own-profile detection: LinkedIn renders "Edit intro" and "Add profile section"
 * buttons exclusively on your own profile — we use those as the gate.
 *
 * Privacy: only reads data the user themselves posted publicly.
 * Never reads other people's profiles.
 */

export type LinkedInProfileData = {
  linkedinUrl: string
  headline: string | null
  hasAboutSection: boolean
  skillsCount: number
  recommendationsCount: number
  connectionsEstimate: number | null
  lastPostDetectedAt: string | null
  daysSinceLastActivity: number | null
  isOwnProfile: boolean
}

// ── Own-profile detection ─────────────────────────────────────────────────────

/**
 * Extract the /in/[slug] from a LinkedIn profile URL.
 * Returns lowercase slug or null if the URL is not a profile URL.
 */
export function extractLinkedInSlug(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? m[1].toLowerCase().replace(/\/$/, "") : null
}

/**
 * Primary check: does the current page URL slug match a known stored slug?
 * More reliable than DOM detection because it doesn't depend on LinkedIn's
 * ever-changing component structure.
 */
export function isOwnLinkedInProfileBySlug(storedLinkedInUrl: string | null): boolean {
  if (!storedLinkedInUrl) return false
  const storedSlug = extractLinkedInSlug(storedLinkedInUrl)
  const currentSlug = extractLinkedInSlug(window.location.href)
  return Boolean(storedSlug && currentSlug && storedSlug === currentSlug)
}

/**
 * Fallback DOM check: LinkedIn only renders "Edit intro" and "Add profile section"
 * buttons on your own profile. Used when no stored URL is available yet.
 * More fragile — LinkedIn changes their DOM regularly.
 */
export function isOwnLinkedInProfileByDom(): boolean {
  const editIntro = document.querySelector(
    'button[aria-label="Edit intro"], a[href*="/in/edit/"], [data-control-name="edit_intro"]'
  )
  if (editIntro) return true

  const addSection = document.querySelector(
    'button[aria-label*="Add profile section"]'
  )
  if (addSection) return true

  return false
}

/** Combined check — slug matching preferred, DOM fallback if no URL stored. */
export function isOwnLinkedInProfile(storedLinkedInUrl?: string | null): boolean {
  if (storedLinkedInUrl) return isOwnLinkedInProfileBySlug(storedLinkedInUrl)
  return isOwnLinkedInProfileByDom()
}

// ── Extraction helpers ────────────────────────────────────────────────────────

function extractHeadline(): string | null {
  // Multiple LinkedIn DOM versions
  const selectors = [
    '.text-body-medium.break-words',
    '.pv-text-details__left-panel .text-body-medium',
    'div[data-generated-suggestion-target]',
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    const text = el?.textContent?.trim()
    if (text && text.length > 2 && text.length < 300) return text
  }
  return null
}

function sectionByHeading(label: string): HTMLElement | null {
  const normalized = label.toLowerCase()
  for (const section of Array.from(document.querySelectorAll<HTMLElement>('section'))) {
    const heading = section.querySelector('h2, h3')?.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? ""
    const text = section.innerText?.replace(/\s+/g, " ").trim().toLowerCase() ?? ""
    if (heading === normalized || text.startsWith(`${normalized} `)) return section
  }
  return null
}

function meaningfulSectionText(section: HTMLElement): string {
  return (section.innerText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(about|show all|see more|top skills)$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractHasAbout(): boolean {
  // About section exists and has meaningful content
  const aboutSection =
    document.querySelector('#about') ??
    document.querySelector<HTMLElement>('section[data-section="summary"]') ??
    sectionByHeading("About") ??
    document.querySelector<HTMLElement>('[id*="about"]')?.closest('section')

  if (!aboutSection) return false

  // Check the sibling/child content div
  const content =
    aboutSection.closest('section')?.querySelector('.display-flex.ph5.pv3') ??
    aboutSection.parentElement?.querySelector('.pv-shared-text-with-see-more')

  const text = content?.textContent?.trim() ?? aboutSection.textContent?.trim() ?? ""
  return (text.length > 20 || meaningfulSectionText(aboutSection as HTMLElement).length > 20)
}

function extractSkillsCount(): number {
  const skillsSection =
    document.querySelector('#skills') ??
    document.querySelector('section[data-section="skills"]')

  if (!skillsSection) return 0

  // Count skill list items
  const parent = skillsSection.closest('section') ?? skillsSection.parentElement
  const items =
    parent?.querySelectorAll('.pvs-list__item--line-separated, .artdeco-list__item') ??
    []

  const count = items.length
  // LinkedIn shows "Show all X skills" link — extract number from it
  const showAllEl = parent?.querySelector('[aria-label*="skills"]')
  const showAllText = showAllEl?.getAttribute('aria-label') ?? ""
  const numMatch = showAllText.match(/(\d+)\s+skills?/i)
  if (numMatch) return parseInt(numMatch[1], 10)

  return count > 0 ? count : 0
}

function extractRecommendationsCount(): number {
  const recsSection =
    document.querySelector('#recommendations') ??
    document.querySelector('section[data-section="recommendations"]') ??
    sectionByHeading("Recommendations")

  if (!recsSection) return 0

  const parent = recsSection.closest('section') ?? recsSection.parentElement

  // Try to find "Received (X)" tab text
  const tabEl = parent?.querySelector('[aria-selected="true"], [role="tab"]')
  const tabText = tabEl?.textContent?.trim() ?? ""
  const tabMatch = tabText.match(/received\s*\((\d+)\)/i) ?? tabText.match(/(\d+)/)
  if (tabMatch) return parseInt(tabMatch[1], 10)

  // Fallback: count list items
  const items = parent?.querySelectorAll('.pvs-list__item--line-separated, .artdeco-list__item') ?? []
  return items.length
}

function extractConnectionsEstimate(): number | null {
  // "500+ connections" or "234 connections" in the profile header
  const selectors = [
    '.pv-text-details__left-panel .t-bold',
    '[href*="mynetwork"] .t-bold',
    '.pv-top-card--list .t-bold',
  ]

  for (const sel of selectors) {
    const el = document.querySelector(sel)
    const text = el?.textContent?.trim() ?? ""
    if (/connections/i.test(text) || /followers/i.test(text)) {
      const numStr = text.replace(/[^0-9]/g, "")
      if (numStr) return parseInt(numStr, 10)
    }
  }

  // Search all elements for "500+ connections" pattern
  const allText = document.body.innerText
  const match = allText.match(/(\d[\d,+]*)\s+connections?/i) ?? allText.match(/(\d[\d,+]*)\s+followers?/i)
  if (match) {
    const raw = match[1].replace(/[^0-9]/g, "")
    if (raw) return parseInt(raw, 10)
  }

  return null
}

function extractLastPostDate(): { isoDate: string | null; daysSince: number | null } {
  // Activity section — look for time elements under posts
  const activitySection =
    document.querySelector('#activity') ??
    document.querySelector('[data-section="posts"]')

  const isActivityPage = /\/(?:recent-activity|details\/recent-activity)(?:\/|$)/i.test(window.location.pathname)
  const parent = activitySection?.closest('section') ?? activitySection?.parentElement ?? (isActivityPage ? document.body : null)
  if (!parent) return { isoDate: null, daysSince: null }

  // LinkedIn posts show relative times like "2 days ago", "1 week ago", "3 months ago"
  // and often compact forms like "2d", "1w", "3mo".
  const timeEls = parent.querySelectorAll(
    'time, [datetime], [aria-label*="ago"], [aria-label*="reposted"], span.t-black--light, .update-components-actor__sub-description'
  )
  let bestDays: number | null = null

  for (const el of Array.from(timeEls)) {
    const text = [
      el.textContent?.trim(),
      el.getAttribute('aria-label'),
      el.getAttribute('datetime'),
    ].filter(Boolean).join(" ")
    const days = parseActivityDate(text)
    if (days !== null && (bestDays === null || days < bestDays)) {
      bestDays = days
    }
  }

  if (bestDays === null && isActivityPage) {
    bestDays = minRelativeTimeInText(document.body.innerText)
  }

  if (bestDays === null) return { isoDate: null, daysSince: null }

  const date = new Date(Date.now() - bestDays * 86_400_000)
  return { isoDate: date.toISOString(), daysSince: bestDays }
}

function parseActivityDate(text: string): number | null {
  const isoMatch = text.match(/\b20\d{2}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?\b/)
  if (isoMatch) {
    const time = new Date(isoMatch[0]).getTime()
    if (Number.isFinite(time)) {
      const days = Math.floor((Date.now() - time) / 86_400_000)
      if (days >= 0 && days <= 3650) return days
    }
  }
  return minRelativeTimeInText(text)
}

function minRelativeTimeInText(text: string): number | null {
  const lower = text.toLowerCase()
  const candidates: number[] = []
  if (/\b(just now|moments? ago|today)\b/i.test(lower)) candidates.push(0)
  if (/\byesterday\b/i.test(lower)) candidates.push(1)

  const re = /\b(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\s*(?:ago)?\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(lower)) !== null) {
    const n = parseInt(match[1], 10)
    if (!Number.isFinite(n)) continue
    const unit = match[2]
    if (/^(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i.test(unit)) candidates.push(0)
    else if (/^(d|day|days)$/i.test(unit)) candidates.push(n)
    else if (/^(w|wk|wks|week|weeks)$/i.test(unit)) candidates.push(n * 7)
    else if (/^(mo|mos|month|months)$/i.test(unit)) candidates.push(n * 30)
    else if (/^(y|yr|yrs|year|years)$/i.test(unit)) candidates.push(n * 365)
  }

  return candidates.length > 0 ? Math.min(...candidates) : null
}

// ── Main export ───────────────────────────────────────────────────────────────

export function extractLinkedInProfile(storedLinkedInUrl?: string | null): LinkedInProfileData {
  const url = window.location.href.split('?')[0].replace(/\/$/, '')
  const { isoDate, daysSince } = extractLastPostDate()

  return {
    linkedinUrl: url,
    headline: extractHeadline(),
    hasAboutSection: extractHasAbout(),
    skillsCount: extractSkillsCount(),
    recommendationsCount: extractRecommendationsCount(),
    connectionsEstimate: extractConnectionsEstimate(),
    lastPostDetectedAt: isoDate,
    daysSinceLastActivity: daysSince,
    isOwnProfile: isOwnLinkedInProfile(storedLinkedInUrl),
  }
}
