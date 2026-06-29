import { normalizeAtsUrl, type NormalizedAtsProvider } from "@/lib/companies/ats-url-normalization"

const RESOLVER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export type RenderHtml = (url: string) => Promise<string | null>

async function fetchPlainHtml(url: string, timeoutMs = 12_000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": RESOLVER_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    if (!res.ok) {
      try { await res.body?.cancel() } catch {}
      return null
    }
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const COMPANY_STOPWORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "llc",
  "limited", "lp", "llp", "plc", "the", "and", "of", "group", "holdings",
  "holding", "international", "global", "us", "usa", "america",
])

export function generateCompanySlugs(companyName: string): string[] {
  const out = new Set<string>()
  const cleaned = companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const words = cleaned.split(/\s+/).filter((w) => w && !COMPANY_STOPWORDS.has(w))
  if (words.length === 0) return []

  // dashed
  out.add(words.join("-"))
  // compact
  out.add(words.join(""))
  // first word only
  out.add(words[0])
  // first two words combined and dashed
  if (words.length >= 2) {
    out.add(words.slice(0, 2).join(""))
    out.add(words.slice(0, 2).join("-"))
  }
  // first three words
  if (words.length >= 3) {
    out.add(words.slice(0, 3).join(""))
    out.add(words.slice(0, 3).join("-"))
  }
  return [...out].filter((s) => s.length >= 3 && s.length <= 60).slice(0, 8)
}

async function probeJsonOk(url: string, timeoutMs = 6_000): Promise<{ ok: boolean; body?: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": RESOLVER_USER_AGENT,
        accept: "application/json",
      },
    })
    if (!res.ok) {
      try { await res.body?.cancel() } catch {}
      return { ok: false }
    }
    const body = await res.json().catch(() => null)
    return { ok: true, body }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

async function probeHeadOk(url: string, timeoutMs = 6_000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": RESOLVER_USER_AGENT },
    })
    try { await res.body?.cancel() } catch {}
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function probeJobviteSlug(slug: string): Promise<boolean> {
  const html = await fetchPlainHtml(`https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs/all`, 6_000)
  return Boolean(html && new RegExp(`jobs\\.jobvite\\.com/${slug}/job/|/${slug}/job/`, "i").test(html))
}

/**
 * Probe public ATS APIs with company-name-derived slugs.
 * Returns a hit when an API confirms the slug exists (200 + non-empty data).
 */
export async function probeKnownAtsSlugs(
  companyName: string,
  hint?: string | null
): Promise<ResolvedAtsUrl | null> {
  const slugs = generateCompanySlugs(companyName)
  if (slugs.length === 0) return null
  const provider = (hint ?? "").toLowerCase()
  const order: Array<"greenhouse" | "lever" | "ashby" | "smartrecruiters" | "jobvite"> =
    provider === "greenhouse" ? ["greenhouse", "lever", "ashby", "smartrecruiters"] :
    provider === "lever" ? ["lever", "greenhouse", "ashby", "smartrecruiters"] :
    provider === "ashby" ? ["ashby", "greenhouse", "lever", "smartrecruiters"] :
    provider === "smartrecruiters" ? ["smartrecruiters", "greenhouse", "lever", "ashby"] :
    provider === "jobvite" ? ["jobvite", "greenhouse", "lever", "ashby", "smartrecruiters"] :
    ["greenhouse", "lever", "ashby", "smartrecruiters"]

  for (const slug of slugs) {
    for (const target of order) {
      if (target === "greenhouse") {
        const r = await probeJsonOk(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`)
        if (r.ok) {
          const jobs = (r.body as { jobs?: unknown[] } | null)?.jobs
          if (Array.isArray(jobs) && jobs.length >= 1) {
            return { provider: "greenhouse", directUrl: `https://boards.greenhouse.io/${slug}`, identifier: slug, source: "slug_probe" }
          }
        }
      } else if (target === "lever") {
        const r = await probeJsonOk(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`)
        if (r.ok && Array.isArray(r.body) && r.body.length >= 1) {
          return { provider: "lever", directUrl: `https://jobs.lever.co/${slug}`, identifier: slug, source: "slug_probe" }
        }
      } else if (target === "ashby") {
        const r = await probeJsonOk(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`)
        if (r.ok) {
          const jobs = (r.body as { jobs?: unknown[] } | null)?.jobs
          if (Array.isArray(jobs) && jobs.length >= 1) {
            return { provider: "ashby", directUrl: `https://jobs.ashbyhq.com/${slug}`, identifier: slug, source: "slug_probe" }
          }
        }
      } else if (target === "smartrecruiters") {
        const r = await probeJsonOk(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`)
        if (r.ok) {
          const total = (r.body as { totalFound?: number } | null)?.totalFound
          if (typeof total === "number" && total >= 1) {
            return { provider: "smartrecruiters", directUrl: `https://jobs.smartrecruiters.com/${slug}`, identifier: slug, source: "slug_probe" }
          }
        }
      } else if (target === "jobvite") {
        if (await probeJobviteSlug(slug)) {
          return { provider: "jobvite", directUrl: `https://jobs.jobvite.com/${slug}/jobs`, identifier: slug, source: "slug_probe" }
        }
      }
    }
  }
  return null
}

export type ResolverProvider = NormalizedAtsProvider | "successfactors" | "taleo" | "icims"

export type ResolvedAtsUrl = {
  provider: ResolverProvider
  directUrl: string
  identifier: string | null
  source: "already_direct" | "embedded_link" | "iframe_src" | "form_action" | "redirect" | "slug_probe"
}

const GREENHOUSE_PATTERNS: RegExp[] = [
  /https?:\/\/boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9][a-z0-9._-]*)/gi,
  /https?:\/\/job-boards\.greenhouse\.io\/([a-z0-9][a-z0-9._-]*)/gi,
  /boards\.greenhouse\.io\/embed\/job_board\?for=([a-z0-9][a-z0-9._-]*)/gi,
]

const LEVER_PATTERNS: RegExp[] = [/https?:\/\/jobs\.lever\.co\/([a-z0-9][a-z0-9._-]*)/gi]

const ASHBY_PATTERNS: RegExp[] = [
  /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9._-]*)/gi,
]

const SMARTRECRUITERS_PATTERNS: RegExp[] = [
  /https?:\/\/jobs\.smartrecruiters\.com\/([a-z0-9][a-z0-9._-]*)/gi,
  /https?:\/\/careers\.smartrecruiters\.com\/([a-z0-9][a-z0-9._-]*)/gi,
]

const JOBVITE_PATTERNS: RegExp[] = [
  /https?:\/\/jobs\.jobvite\.com\/([a-z0-9][a-z0-9_-]*)/gi,
  /jobs\.jobvite\.com\/([a-z0-9][a-z0-9_-]*)/gi,
]

const WORKDAY_PATTERNS: RegExp[] = [
  /https?:\/\/([a-z0-9-]+)\.(wd[1-9])\.myworkdayjobs\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([a-z0-9_-]+)/gi,
]

function firstMatch(html: string, patterns: RegExp[]): { full: string; id: string } | null {
  for (const re of patterns) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m && m[1]) {
      return { full: m[0], id: m[1] }
    }
  }
  return null
}

function firstWorkdayMatch(html: string): { tenant: string; shard: string; site: string } | null {
  for (const re of WORKDAY_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m && m[1] && m[2] && m[3]) {
      return { tenant: m[1], shard: m[2], site: m[3] }
    }
  }
  return null
}

/**
 * Resolve a careers landing page (wrapper) to its direct ATS endpoint by
 * scanning its HTML for embedded ATS links/iframes/form actions. Returns null
 * when no embedded ATS can be detected.
 *
 * Exported for reuse by the apply-URL backsolver
 * ([[resolve-apply-url-to-tenant]]); also used internally by resolveDirectAtsUrl.
 */
export function detectAtsInHtml(html: string): ResolvedAtsUrl | null {
  const gh = firstMatch(html, GREENHOUSE_PATTERNS)
  if (gh && gh.id !== "embed") {
    return {
      provider: "greenhouse",
      directUrl: `https://boards.greenhouse.io/${gh.id}`,
      identifier: gh.id,
      source: "embedded_link",
    }
  }
  const lever = firstMatch(html, LEVER_PATTERNS)
  if (lever) {
    return {
      provider: "lever",
      directUrl: `https://jobs.lever.co/${lever.id}`,
      identifier: lever.id,
      source: "embedded_link",
    }
  }
  const ashby = firstMatch(html, ASHBY_PATTERNS)
  if (ashby) {
    return {
      provider: "ashby",
      directUrl: `https://jobs.ashbyhq.com/${ashby.id}`,
      identifier: ashby.id,
      source: "embedded_link",
    }
  }
  const sr = firstMatch(html, SMARTRECRUITERS_PATTERNS)
  if (sr) {
    return {
      provider: "smartrecruiters",
      directUrl: `https://jobs.smartrecruiters.com/${sr.id}`,
      identifier: sr.id,
      source: "embedded_link",
    }
  }
  const jobvite = firstMatch(html, JOBVITE_PATTERNS)
  if (jobvite) {
    return {
      provider: "jobvite",
      directUrl: `https://jobs.jobvite.com/${jobvite.id}/jobs`,
      identifier: jobvite.id,
      source: "embedded_link",
    }
  }
  const wd = firstWorkdayMatch(html)
  if (wd) {
    return {
      provider: "workday",
      directUrl: `https://${wd.tenant}.${wd.shard}.myworkdayjobs.com/${wd.site}`,
      identifier: `${wd.tenant}/${wd.site}`,
      source: "embedded_link",
    }
  }
  const sf = /career[0-9]?\.successfactors\.com\/career\?[^"' ]*company=([a-z0-9]+)/i.exec(html)
  if (sf && sf[1]) {
    return {
      provider: "successfactors",
      directUrl: `https://career4.successfactors.com/career?company=${sf[1]}`,
      identifier: sf[1],
      source: "form_action",
    }
  }
  const taleo = /https?:\/\/([a-z0-9-]+)\.taleo\.net\/careersection\/([a-z0-9_]+)/i.exec(html)
  if (taleo && taleo[1] && taleo[2]) {
    return {
      provider: "taleo",
      directUrl: `https://${taleo[1]}.taleo.net/careersection/${taleo[2]}`,
      identifier: `${taleo[1]}/${taleo[2]}`,
      source: "embedded_link",
    }
  }
  const icims = /https?:\/\/(careers-[a-z0-9-]+|[a-z0-9-]+)\.icims\.com\/jobs/i.exec(html)
  if (icims && icims[1]) {
    return {
      provider: "icims",
      directUrl: `https://${icims[1]}.icims.com/jobs/search`,
      identifier: icims[1],
      source: "embedded_link",
    }
  }
  return null
}

export async function resolveDirectAtsUrl(
  careersUrl: string,
  context?: {
    atsType?: string | null
    companyName?: string | null
    renderHtml?: RenderHtml | null
  }
): Promise<ResolvedAtsUrl | null> {
  const normalized = normalizeAtsUrl(careersUrl, { atsType: context?.atsType })

  // If already a direct ATS URL, just return it.
  if (
    normalized.provider !== "custom" &&
    normalized.shouldPersist
  ) {
    return {
      provider: normalized.provider,
      directUrl: normalized.normalizedUrl,
      identifier: normalized.atsIdentifier,
      source: "already_direct",
    }
  }

  // Step 1: try plain static fetch (free + fast).
  const html = await fetchPlainHtml(careersUrl)
  const fromStatic = html ? detectAtsInHtml(html) : null
  if (fromStatic) return fromStatic

  // Step 2: probe known ATS APIs with company-name-derived slugs (~1s avg).
  if (context?.companyName) {
    const fromProbe = await probeKnownAtsSlugs(context.companyName, context?.atsType)
    if (fromProbe) return fromProbe
  }

  // Step 3: last-resort JS rendering (~4s, only when above failed).
  if (context?.renderHtml) {
    try {
      const rendered = await context.renderHtml(careersUrl)
      if (rendered) {
        const fromRendered = detectAtsInHtml(rendered)
        if (fromRendered) return fromRendered
      }
    } catch {
      // ignore
    }
  }

  return null
}
