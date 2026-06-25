/**
 * Domain-candidate resolution for companies whose `domain` was synthesized from
 * their legal name (the H-1B / LCA reconciliation path). Those synthetic domains
 * are frequently wrong:
 *
 *   - Mangled by a historical boundary-less strip: "Company" → "mpany",
 *     "Corporation" → "oration", "Coupang" → "upang" (the "co"/"corp" substring
 *     was deleted), producing dead hosts like `theprudentialinsurancempanyof.com`.
 *   - Plausible-but-wrong `.com` for universities/hospitals whose real mark lives
 *     on `.edu` / `.org` (e.g. `auburnuniversity.com` → should be `auburn.edu`).
 *
 * This module produces *candidate* domains only — it never touches the network.
 * The backfill script (`scripts/fix-h1b-leaderboard-domains.ts`) HTTP-probes each
 * candidate and adopts the first that actually resolves, so a wrong curated guess
 * is harmless (it just fails the probe and the next candidate is tried).
 */

const TRAILING_LEGAL_RE =
  /\s+(inc|incorporated|llc|llp|ltd|limited|lp|corp|corporation|co|company|companies|plc|na|gmbh)$/

/** Normalize a company name to a stable lookup key for the curated map. */
export function normInstitutionName(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .trim()
    .replace(/\s+/g, " ")
  // Strip trailing legal-entity suffixes iteratively ("nomura holding america
  // inc" → "nomura holding america") so curated keys match regardless of the
  // exact suffix the LCA filing used.
  let prev = ""
  while (s !== prev) {
    prev = s
    s = s.replace(TRAILING_LEGAL_RE, "").trim()
  }
  return s
}

/**
 * Curated, high-confidence brand domains for the institutions and large
 * employers that dominate the public H-1B leaderboard. Keys are
 * `normInstitutionName(...)` outputs. Values are still probe-verified before
 * adoption, so an occasional wrong entry self-heals.
 */
export const INSTITUTION_DOMAIN_BY_NAME: Record<string, string> = {
  // ── Universities & colleges (real mark is .edu) ──────────────────────────
  "carnegie mellon university": "cmu.edu",
  "johns hopkins university": "jhu.edu",
  "university of iowa": "uiowa.edu",
  "trustees of princeton university": "princeton.edu",
  "curators of university of missouri": "missouri.edu",
  "university of texas at austin": "utexas.edu",
  "university of texas at dallas": "utdallas.edu",
  "university of texas at el paso": "utep.edu",
  "university of texas health science center at houston": "uth.edu",
  "university of texas m d anderson cancer center": "mdanderson.org",
  "indiana university indianapolis": "iu.edu",
  "indiana university": "iu.edu",
  "university of virginia": "virginia.edu",
  "arizona state university": "asu.edu",
  "pennsylvania state university": "psu.edu",
  "university of colorado": "colorado.edu",
  "texas tech university": "ttu.edu",
  "university of arizona": "arizona.edu",
  "brown university": "brown.edu",
  "georgetown university": "georgetown.edu",
  "clemson university": "clemson.edu",
  "w m rice university": "rice.edu",
  "oregon state university": "oregonstate.edu",
  "oregon health and science university": "ohsu.edu",
  "auburn university": "auburn.edu",
  "louisiana state university and a and m college": "lsu.edu",
  "oklahoma state university": "okstate.edu",
  "university of kansas": "ku.edu",
  "utah state university": "usu.edu",
  "southern methodist university": "smu.edu",
  "new mexico state university": "nmsu.edu",
  "thomas jefferson university": "jefferson.edu",
  "ohio university": "ohio.edu",
  "james madison university": "jmu.edu",
  "university of memphis": "memphis.edu",
  "marquette university": "marquette.edu",
  "marshall university": "marshall.edu",
  "loyola university chicago": "luc.edu",
  "university of new hampshire": "unh.edu",
  "university of oregon": "uoregon.edu",
  "san diego state university": "sdsu.edu",
  "saint louis university": "slu.edu",
  "baylor university": "baylor.edu",
  "baylor college of medicine": "bcm.edu",
  "university of maine": "umaine.edu",
  "university of massachusetts lowell": "uml.edu",
  "university of rhode island": "uri.edu",
  "south dakota state university": "sdstate.edu",
  "montana state university": "montana.edu",
  "drexel university": "drexel.edu",
  "george washington university": "gwu.edu",
  "washington state university": "wsu.edu",
  "tufts university": "tufts.edu",
  "weill cornell medical college": "weill.cornell.edu",
  "nyu grossman school of medicine": "nyu.edu",

  // ── Hospitals / research orgs (real mark is .org / .edu) ──────────────────
  "university of mississippi medical center": "umc.edu",
  "ut southwestern medical center": "utsouthwestern.edu",
  "university hospitals cleveland medical center": "uhhospitals.org",
  "brookhaven national laboratory": "bnl.gov",
  "dallas independent school district": "dallasisd.org",
  "mount sinai hospital": "mountsinai.org",
  "massachusetts general physicians organization": "massgeneral.org",
  "maimonides medical center": "maimonidesmedical.org",
  "howard hughes medical institute hhmi": "hhmi.org",
  "research foundation for state university of new york": "rfsuny.org",

  // ── Large employers with a mangled / wrong synthetic .com ─────────────────
  "prudential insurance company of america": "prudential.com",
  "nomura holding america": "nomura.com",
  "mufg bank": "mufgamericas.com",
  "huntington national bank": "huntington.com",
  "sap labs": "sap.com",
  "massachusetts mutual life insurance": "massmutual.com",
  "cybersource": "cybersource.com",
  "coupang global": "coupang.com",
  "covidien": "medtronic.com",
  "zurich american insurance": "zurichna.com",
  "indotronix international": "indotronix.com",
  "options clearing": "theocc.com",
  "cra international": "crai.com",
  "ppd development l p": "ppd.com",
  "goken america": "goken-america.com",
}

const EDU_RE = /\b(universit(y|ies)|college|school of|institute of technology|polytechnic)\b/i
const MED_RE =
  /\b(hospital|medical center|health (system|science|care)|clinic|cancer center|foundation|institute|physicians)\b/i

export function isEducationalInstitution(name: string): boolean {
  return EDU_RE.test(name)
}

export function isMedicalOrResearchOrg(name: string): boolean {
  return MED_RE.test(name)
}

// Words that are organizational scaffolding, not part of the brand stem.
const STOPWORDS = new Set([
  "the", "of", "and", "a", "an", "for", "at", "in", "to",
  "university", "universities", "college", "colleges", "school", "schools",
  "system", "systems", "trustees", "curators", "regents", "board",
  "inc", "llc", "llp", "ltd", "limited", "corp", "corporation", "company",
  "companies", "co", "plc", "holdings", "group", "lp", "incorporated",
  "us", "usa", "america", "americas", "national", "international", "global",
])

function brandWords(name: string): string[] {
  return normInstitutionName(name)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
}

/** `.edu` candidates derived from the brand stem (probe-verified by the caller). */
export function eduCandidates(name: string): string[] {
  const words = brandWords(name)
  if (!words.length) return []
  const out: string[] = []
  const stem = words.join("")
  if (stem.length >= 3 && stem.length <= 24) out.push(`${stem}.edu`)
  const twoWord = words.slice(0, 2).join("")
  if (twoWord !== stem && twoWord.length >= 4) out.push(`${twoWord}.edu`)
  if (words[0] && words[0].length >= 3 && words[0] !== stem) out.push(`${words[0]}.edu`)
  return out
}

/** `.org` candidates for hospitals / research orgs. */
export function orgCandidates(name: string): string[] {
  const words = brandWords(name)
  if (!words.length) return []
  const out: string[] = []
  const stem = words.join("")
  if (stem.length >= 3 && stem.length <= 24) out.push(`${stem}.org`)
  if (words[0] && words[0].length >= 4 && words[0] !== stem) out.push(`${words[0]}.org`)
  return out
}

/**
 * Boundary-correct `.com` candidates from the brand stem. This is the FIXED
 * replacement for the historical mangling guesser — words are dropped whole
 * (via the STOPWORDS set + `normInstitutionName`'s tokenization), never sliced
 * mid-word, so "Company"/"Coupang"/"Corporation" survive intact.
 */
export function generalCandidates(name: string): string[] {
  const words = brandWords(name)
  if (!words.length) return []
  const out: string[] = []
  const stem = words.join("")
  const twoWord = words.slice(0, 2).join("")
  const hyphen = words.join("-")
  if (stem.length >= 3 && stem.length <= 24) out.push(`${stem}.com`)
  if (twoWord !== stem && twoWord.length >= 4) out.push(`${twoWord}.com`)
  if (hyphen !== stem && hyphen.length <= 30) out.push(`${hyphen}.com`)
  if (words[0] && words[0].length >= 3 && words[0] !== stem) out.push(`${words[0]}.com`)
  return out
}

const PLACEHOLDER_DOMAIN_RE =
  /\.(uscis-employer|lca-employer|[a-z]+-discovered|placeholder|ats-placeholder)$/i
const ATS_DOMAIN_RE =
  /\.(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|workday\.com|icims\.com|jobvite\.com|taleo\.net|bamboohr\.com|workable\.com)$/i

function bareDomain(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!
}

/**
 * Heuristic: was this domain synthesized from the company name (rather than a
 * real, short brand domain)? Used to decide which leaderboard companies to
 * re-resolve. Conservative by design — every adoption downstream is still
 * probe-gated, so a false positive merely re-probes a possibly-correct company.
 */
export function isSyntheticDomain(name: string, domain: string | null | undefined): boolean {
  if (!domain) return false
  const d = bareDomain(domain)
  if (PLACEHOLDER_DOMAIN_RE.test(d) || ATS_DOMAIN_RE.test(d)) return true

  const tld = d.split(".").pop() ?? ""
  const prefix = d.slice(0, Math.max(0, d.length - tld.length - 1)).replace(/[^a-z0-9]/g, "")
  if (!prefix) return false
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "")

  // Domain prefix is (almost) the whole name slug → derived from the name.
  if (
    prefix.length >= 10 &&
    (slug.startsWith(prefix.slice(0, 12)) || prefix.startsWith(slug.slice(0, 12)))
  ) {
    return true
  }
  if (prefix.length > 18) return true // implausibly long for a real brand host
  if (tld === "com" && /\b(universit|college)\b/i.test(name)) return true // .edu institution on a .com
  // Mangle signatures: "corporation"→"oration", "college"→"llege", "company"→"mpany".
  if (
    (/oration/.test(prefix) && /corporation/i.test(name)) ||
    (/llege/.test(prefix) && /college/i.test(name)) ||
    (/mpany/.test(prefix) && /company/i.test(name))
  ) {
    return true
  }
  // A curated brand domain exists and disagrees with what's stored.
  const curated = INSTITUTION_DOMAIN_BY_NAME[normInstitutionName(name)]
  if (curated && curated !== d) return true
  return false
}

/**
 * Ordered, de-duplicated list of domain candidates for a company name, most
 * trustworthy first: curated brand → institution-specific TLDs → generic .com.
 */
export function domainCandidates(name: string): string[] {
  const out: string[] = []
  const push = (d: string) => {
    const t = d.trim().toLowerCase()
    if (t && !out.includes(t)) out.push(t)
  }

  const curated = INSTITUTION_DOMAIN_BY_NAME[normInstitutionName(name)]
  if (curated) push(curated)
  if (isEducationalInstitution(name)) eduCandidates(name).forEach(push)
  if (isMedicalOrResearchOrg(name)) orgCandidates(name).forEach(push)
  generalCandidates(name).forEach(push)
  return out
}
