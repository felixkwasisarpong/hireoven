/**
 * Resolve a real public domain for a company we only know by name — the
 * placeholder-domain rows (`<slug>.placeholder`, `<slug>.builtin-discovery`)
 * that aggregator ingest and name-only discovery leave behind with no ATS.
 *
 * The output feeds `companies.raw_ats_config.guessed_domain`, which the
 * `discover-from-domains` cron already consumes to find a careers page → ATS
 * and promote the company in place. We deliberately do NOT overwrite the
 * canonical `companies.domain`: a guessed domain stays a guess until a
 * downstream careers/ATS probe confirms it.
 *
 * Precision-first — a wrong domain is worse than no domain, because it sends
 * the careers crawler chasing an unrelated site. Three gates:
 *   1. Candidate generation — name-heuristic slugs + Clearbit autocomplete.
 *   2. Liveness — the candidate must answer < 500 and not be an ATS, job
 *      board, social network, or obvious parking page.
 *   3. Ownership — the homepage must mention the company's distinctive name
 *      tokens. This rejects squatters and Clearbit's wrong-entity matches
 *      (e.g. "Raytheon" → a German subsidiary).
 */

import { guessPublicDomain } from "@/lib/companies/placeholder-from-employer"

export type DomainMethod = "heuristic" | "clearbit"

export type ResolvedDomain = {
  domain: string
  method: DomainMethod
  confidence: "high" | "medium"
}

export type ResolveOptions = {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Per-request timeout for probes/homepage fetches. */
  timeoutMs?: number
  /** Skip the Clearbit autocomplete lookup (heuristic-only). */
  disableClearbit?: boolean
}

const DEFAULT_TIMEOUT_MS = 6_000
const USER_AGENT = "Mozilla/5.0 (compatible; HireovenDomainResolver/1.0; +https://hireoven.com)"

// Hosts that are never a company's own site — ATS boards, job aggregators,
// social, and link shorteners. A candidate (or its redirect target) landing
// here is rejected.
const REJECT_HOST_RE =
  /(^|\.)(myworkdayjobs|workdayjobs|greenhouse|lever|ashbyhq|smartrecruiters|icims|jobvite|taleo|bamboohr|workable|recruitee|successfactors|paylocity|paycomonline|ukg|adp)\.|(^|\.)(linkedin|indeed|glassdoor|dice|ziprecruiter|monster|careerbuilder|simplyhired|google|facebook|twitter|x|instagram|youtube|wikipedia|crunchbase|bloomberg|godaddy|sedo|bit|goo)\.(com|net|org|io|co|ly)$/i

// Domain-parking / for-sale marketplaces — a candidate redirecting here means
// the domain isn't a live company site, even though the parking page often
// echoes the searched name ("globalelitetexas.com is for sale").
const PARKING_HOST_RE =
  /(^|\.)(hugedomains|dan|sedo|afternic|bodis|parkingcrew|sav|domainmarket|undeveloped|name|squadhelp|brandbucket|aftermarket|uniregistry|above|fabulous)\.(com|net|org)$/i
const FOR_SALE_RE =
  /\b(this domain (is|may be) for sale|buy this domain|domain (is )?for sale|the domain .{0,40} is for sale|inquire about this domain|parked (free|by)|is for sale|make an offer)\b/i

// Generic words that are not distinctive enough to confirm ownership on their
// own (so a homepage mentioning only "solutions" doesn't count as a match).
const GENERIC_TOKENS = new Set([
  "the", "and", "of", "for", "inc", "llc", "ltd", "corp", "co", "company",
  "group", "holdings", "partners", "associates", "technologies", "technology",
  "solutions", "services", "systems", "consulting", "staffing", "international",
  "global", "national", "us", "usa", "america", "north", "south", "east",
  "west", "central", "industries", "enterprises",
])

/** Distinctive lowercase tokens from a company name (drops generic filler). */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t))
}

/** True if `host` (or a redirect target) is never a company's own website. */
export function isRejectableDomain(host: string): boolean {
  const h = host.toLowerCase()
  return REJECT_HOST_RE.test(h) || PARKING_HOST_RE.test(h)
}

/** The host minus its TLD label, e.g. "fordphilanthropy.org" → "fordphilanthropy". */
function hostSlug(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".")
  return (labels.length > 1 ? labels.slice(0, -1) : labels).join("")
}

/** True if the domain's own name (minus TLD) contains a distinctive name token. */
export function domainMatchesName(host: string, tokens: string[]): boolean {
  const slug = hostSlug(host)
  return tokens.some((t) => slug.includes(t))
}

/**
 * Ordered domain candidates for a company name. The first entry is the
 * canonical heuristic slug (`guessPublicDomain`) — when it probes live AND the
 * homepage matches, that's our highest-confidence signal. Extra slug variants
 * follow. Clearbit suggestions are appended by the resolver, not here.
 */
export function generateDomainCandidates(name: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (domain: string | null | undefined) => {
    if (!domain) return
    const d = domain.trim().toLowerCase()
    const [pre] = d.split(".")
    if (!pre || pre.length < 3) return
    if (!seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }

  // Canonical compressed slug ("Acme Health, Inc." → "acmehealth.com").
  push(guessPublicDomain(name))

  const tokens = nameTokens(name)
  if (tokens.length) {
    push(`${tokens.join("")}.com`)
    if (tokens.length > 1) push(`${tokens.join("-")}.com`)
    // Note: we deliberately do NOT emit a first-token-only candidate
    // (e.g. "Fisher Investments" → fisher.com). Common single words match
    // unrelated companies (fisher.com → Emerson, guard.com, pinnacle.com),
    // and a wrong guess can mis-enroll a company downstream.
  }

  return out
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/** Clearbit's free, keyless autocomplete: name → [{ name, domain }]. */
export async function fetchClearbitDomains(
  name: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string[]> {
  const { signal, clear } = withTimeout(timeoutMs)
  try {
    const res = await fetchImpl(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
      { signal, headers: { Accept: "application/json", "User-Agent": USER_AGENT } }
    )
    if (!res.ok) return []
    const data = (await res.json()) as Array<{ domain?: string }>
    if (!Array.isArray(data)) return []
    return data
      .map((d) => d.domain?.trim().toLowerCase())
      .filter((d): d is string => Boolean(d) && !isRejectableDomain(d!))
      .slice(0, 3)
  } catch {
    return []
  } finally {
    clear()
  }
}

/** True if the homepage HTML mentions at least one distinctive name token. */
export function homepageMentionsCompany(html: string, tokens: string[]): boolean {
  if (!tokens.length) return false
  // Title + visible-ish text, tags stripped, collapsed to letters/digits.
  const haystack = html
    .slice(0, 200_000)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
  return tokens.some((t) => haystack.includes(t))
}

/**
 * Probe a candidate domain: must be live, not an ATS/board, and its homepage
 * must mention the company. Returns the validated host (post-redirect) or null.
 */
async function validateCandidate(
  domain: string,
  tokens: string[],
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | null> {
  for (const url of [`https://${domain}`, `https://www.${domain}`]) {
    const { signal, clear } = withTimeout(timeoutMs)
    try {
      const res = await fetchImpl(url, {
        redirect: "follow",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        },
      })
      if (res.status >= 500) {
        await res.body?.cancel().catch(() => {})
        continue
      }
      const finalHost = (() => {
        try {
          return new URL(res.url || url).hostname.toLowerCase()
        } catch {
          return ""
        }
      })()
      if (!finalHost || isRejectableDomain(finalHost)) {
        await res.body?.cancel().catch(() => {})
        return null
      }
      const contentType = res.headers.get("content-type") ?? ""
      if (!/text\/html|xml/i.test(contentType)) {
        await res.body?.cancel().catch(() => {})
        continue
      }
      const html = (await res.text()).slice(0, 200_000)
      if (FOR_SALE_RE.test(html)) return null
      if (homepageMentionsCompany(html, tokens)) return finalHost.replace(/^www\./, "")
      // Live but unconfirmed — don't accept, but no point trying the www
      // variant of the same site, so stop here.
      return null
    } catch {
      // DNS/timeout — try the next URL form.
    } finally {
      clear()
    }
  }
  return null
}

/**
 * Resolve a real domain for a company name, or null if none can be confirmed.
 * Heuristic candidates are tried first (a confirmed canonical slug is "high"
 * confidence); Clearbit suggestions are the "medium" fallback.
 */
export async function resolveCompanyDomainFromName(
  name: string,
  options: ResolveOptions = {}
): Promise<ResolvedDomain | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const tokens = nameTokens(name)
  if (!tokens.length) return null

  const heuristics = generateDomainCandidates(name)
  const tried = new Set<string>()

  for (const domain of heuristics) {
    tried.add(domain)
    const confirmed = await validateCandidate(domain, tokens, fetchImpl, timeoutMs)
    if (confirmed) return { domain: confirmed, method: "heuristic", confidence: "high" }
  }

  if (options.disableClearbit) return null

  const clearbit = await fetchClearbitDomains(name, fetchImpl, timeoutMs)
  for (const domain of clearbit) {
    if (tried.has(domain)) continue
    tried.add(domain)
    // Clearbit can return a wrong-entity domain whose own name shares nothing
    // with the company (e.g. "Google" → chromeenterprise.google). Require the
    // domain itself to carry a name token before trusting it.
    if (!domainMatchesName(domain, tokens)) continue
    const confirmed = await validateCandidate(domain, tokens, fetchImpl, timeoutMs)
    if (confirmed) return { domain: confirmed, method: "clearbit", confidence: "medium" }
  }

  return null
}
