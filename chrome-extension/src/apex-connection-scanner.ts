/**
 * Apex Shadow Network — LinkedIn Connection Scanner
 *
 * Runs as a content script on LinkedIn people-search pages.
 * Scrapes visible connection results and returns them to the background.
 *
 * Target URL pattern:
 *   https://www.linkedin.com/search/results/people/?keywords=COMPANY&network=["F","S"]
 *
 * Privacy: only reads data visible to the logged-in user on their own
 * LinkedIn session — exactly what they'd see manually.
 */

export type ScannedConnection = {
  id: string          // profile URL slug used as stable id
  name: string
  title: string
  company: string
  degree: 1 | 2 | 3
  recentlyActive: boolean
  mutualCount: number
  tenureMonths: number  // 0 = unknown
  profileUrl: string
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function parseDegree(badge: string): 1 | 2 | 3 {
  if (/1st|1°/i.test(badge)) return 1
  if (/2nd|2°/i.test(badge)) return 2
  return 3
}

function parseMutualCount(str: string): number {
  const m = str.match(/(\d+)\s+mutual/i)
  return m ? parseInt(m[1], 10) : 0
}

function extractSlug(href: string): string {
  const m = href.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? m[1].toLowerCase() : href
}

// ── Main scraper ──────────────────────────────────────────────────────────────
//
// LinkedIn's search-result class names are hashed and change constantly, so we
// DON'T match on them. Instead we anchor on the one stable thing: profile links
// (`a[href*="/in/"]`). For each unique profile, we walk up to its result card
// and read the surrounding text to extract name, title, degree, mutuals.

function findResultCard(anchor: HTMLElement): HTMLElement {
  // Walk up to the nearest <li>, or a container that looks like a result card
  let el: HTMLElement | null = anchor
  for (let i = 0; i < 8 && el; i++) {
    if (el.tagName === "LI") return el
    // A card usually has a fair amount of text and isn't the whole list
    if (el.parentElement?.tagName === "LI") return el.parentElement
    el = el.parentElement
  }
  return anchor.closest("li") ?? anchor.parentElement ?? anchor
}

export function scrapeConnectionResults(): ScannedConnection[] {
  const results: ScannedConnection[] = []
  const seen = new Set<string>()

  // Stable anchor: every person result links to /in/<slug>
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']")
  )

  for (const anchor of anchors) {
    try {
      const href = anchor.href
      if (!href.includes("/in/")) continue
      const slug = extractSlug(href)
      if (!slug || seen.has(slug)) continue

      // Name — the visible text of the profile link. LinkedIn sometimes nests
      // it in <span aria-hidden="true">, sometimes shows "View X's profile" in
      // an accessible span, so prefer the aria-hidden span's text.
      const ariaHidden = anchor.querySelector("span[aria-hidden='true']")?.textContent?.trim()
      let name = ariaHidden || anchor.textContent?.trim() || ""
      // Strip "View <name>'s profile" / "• 2nd" noise
      name = name.replace(/\s*•\s*\d(?:st|nd|rd|th).*$/i, "").replace(/^view\s+/i, "").replace(/['']s profile$/i, "").trim()
      if (!name || name.length < 2 || /^linkedin member$/i.test(name)) continue
      // Skip non-person links (company pages share /company/ not /in/, but guard anyway)
      if (/connections?$|followers?$/i.test(name)) continue

      const card = findResultCard(anchor)
      const cardText = card.textContent?.replace(/\s+/g, " ").trim() ?? ""

      // Degree — text like "• 1st" / "2nd" near the name
      const degree = parseDegree(cardText.slice(0, 200))

      // Title / company — the subtitle lines in the card. Heuristic: take the
      // first line after the name that isn't a degree/mutual string.
      const lines = (card.innerText ?? cardText)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
      const nameIdx = lines.findIndex((l) => l.includes(name.split(" ")[0]))
      const after = nameIdx >= 0 ? lines.slice(nameIdx + 1) : lines
      const title = after.find((l) =>
        l.length > 3 &&
        !/^\d(?:st|nd|rd|th)$/i.test(l) &&
        !/mutual connection/i.test(l) &&
        !/^•/.test(l) &&
        !/connect|message|follow/i.test(l)
      ) ?? ""

      const mutualCount = parseMutualCount(cardText)
      const recentlyActive = /active (today|yesterday|\d+ day)/i.test(cardText)

      seen.add(slug)
      results.push({
        id: slug,
        name,
        title,
        company: "",  // company rarely shown reliably on people search; left blank
        degree,
        recentlyActive,
        mutualCount,
        tenureMonths: 0,
        profileUrl: href.split("?")[0],
      })
    } catch {
      // Skip malformed cards
    }
  }

  return results
}

/** Build the LinkedIn people search URL for a company + 1st/2nd degree filter */
export function buildLinkedInSearchUrl(companyName: string): string {
  const params = new URLSearchParams({
    keywords:  companyName,
    network:   JSON.stringify(["F", "S"]),
    origin:    "FACETED_SEARCH",
  })
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}
