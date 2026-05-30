/**
 * Company-name → official domain resolution.
 *
 * This is the weak link in signal-driven discovery: aggregators (Indeed,
 * LinkedIn, Snagajob, …) give you an employer *name* but a dead-end apply URL,
 * so to reach the company's real ATS we first have to recover its domain.
 *
 * Strategy, cheapest-first (each stage short-circuits a strong hit):
 *   1. domainHint — if the feed already exposed a website, validate and use it.
 *   2. existing companies row — fuzzy name match against domains we already
 *      hold (zero network). Supplied by the caller via `knownDomainForName`.
 *   3. guessed domains — slugify the name, try .com/.io/.ai/.co, validate each
 *      with one redirect-following HEAD/GET. First that resolves wins.
 *
 * Returns the FINAL hostname after redirects (apex→www, brand→brand.com), so
 * the careers probe downstream gets the canonical host.
 */

export type DomainConfidence = "high" | "medium" | "low" | "none"

export type ResolvedDomain = {
  domain: string | null
  confidence: DomainConfidence
  source: "hint" | "known_company" | "guess" | "none"
  reason: string
}

const TIMEOUT_MS = 6_000

// Order matters: .com first (highest prior), then the tech-startup TLDs that
// dominate the boards we resolve from. Kept short on purpose — every extra TLD
// is another HTTP request per unresolved name.
const GUESS_TLDS = ["com", "io", "ai", "co"]

// Legal/marketing tokens stripped before slugifying — same set the lever/
// greenhouse slug probes use, so name→domain and name→slug stay consistent.
const NAME_NOISE_RE =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|the|usa|us|america|americas)\b/gi

function slugify(name: string): string {
  return name
    .replace(NAME_NOISE_RE, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

/**
 * Pure, network-free candidate domain list for a company name. Exported so
 * tests can assert generation without hitting the network.
 */
export function domainCandidates(name: string): string[] {
  const slug = slugify(name)
  if (slug.length < 2 || slug.length > 40) return []
  return GUESS_TLDS.map((tld) => `${slug}.${tld}`)
}

function normalizeHint(hint: string): string | null {
  try {
    const url = new URL(hint.startsWith("http") ? hint : `https://${hint}`)
    return url.hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/**
 * One validation request. Follows redirects and returns the final hostname,
 * which is what we actually want to keep (e.g. acme.io → www.acme.com). HEAD
 * first; some hosts 405 it, so fall back to a ranged GET. Never throws.
 */
async function resolveLiveHost(
  domain: string,
  signal?: AbortSignal
): Promise<string | null> {
  const url = `https://${domain}/`
  const sig = signal ?? AbortSignal.timeout(TIMEOUT_MS)
  const init: RequestInit = {
    redirect: "follow",
    signal: sig,
    headers: {
      "user-agent": "hireoven-discovery/1.0 (+https://hireoven.com; bot@hireoven.com)",
    },
  }
  try {
    let res = await fetch(url, { ...init, method: "HEAD" })
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { ...init, method: "GET", headers: { ...init.headers, range: "bytes=0-0" } })
    }
    if (res.status < 200 || res.status >= 400) return null
    try {
      return new URL(res.url || url).hostname.toLowerCase().replace(/^www\./, "")
    } catch {
      return domain
    }
  } catch {
    return null
  }
}

export type ResolveDomainInput = {
  companyName: string
  domainHint?: string | null
  /** Optional zero-network lookup against domains we already store. Caller
   *  wires this to a `companies` query (kept out of here so the resolver stays
   *  pure/poolless and unit-testable). */
  knownDomainForName?: (name: string) => Promise<string | null>
  signal?: AbortSignal
}

export async function resolveDomain(input: ResolveDomainInput): Promise<ResolvedDomain> {
  // 1. Feed-provided hint — validate, but trust it even if validation is
  //    flaky (some corp sites block bots): a hint is a strong prior.
  if (input.domainHint) {
    const hint = normalizeHint(input.domainHint)
    if (hint) {
      const live = await resolveLiveHost(hint, input.signal)
      return live
        ? { domain: live, confidence: "high", source: "hint", reason: "hint_validated" }
        : { domain: hint, confidence: "medium", source: "hint", reason: "hint_unvalidated" }
    }
  }

  // 2. Already-known company domain (no network).
  if (input.knownDomainForName) {
    const known = await input.knownDomainForName(input.companyName)
    if (known) {
      return { domain: known.toLowerCase().replace(/^www\./, ""), confidence: "high", source: "known_company", reason: "name_matched_existing" }
    }
  }

  // 3. Guess + validate.
  for (const candidate of domainCandidates(input.companyName)) {
    if (input.signal?.aborted) break
    const live = await resolveLiveHost(candidate, input.signal)
    if (live) {
      return { domain: live, confidence: "medium", source: "guess", reason: `guess_resolved_${candidate}` }
    }
  }

  return { domain: null, confidence: "none", source: "none", reason: "unresolved" }
}
