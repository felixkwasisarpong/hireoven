/**
 * Geographic scope filter shared between the crawler persist layer and one-off
 * DB cleanup scripts. Keeps a job iff its location/workMode mentions Remote,
 * the United States, or Canada (by full name, abbreviation, or recognized
 * state/province name).
 *
 * Empty/missing location strings pass through. Many legacy rows have no
 * location captured and we don't want to nuke them on that ambiguity alone.
 */

const REMOTE_RE = /\bremote\b/i
const US_NAME_RE =
  /\b(united states(?:\s+of\s+america)?|u\.?\s*s\.?\s*a?\.?|usa)\b/i
const CANADA_NAME_RE = /\bcanada\b/i
// Many ATS feeds provide city-only locations (e.g. "San Francisco")
// without country/state metadata. Accept a conservative set of major US/CA
// tech hubs so we don't drop clearly in-scope jobs.
const MAJOR_US_CA_CITY_RE =
  /\b(san francisco(?!\s+de\b)(?:\s+bay\s+area)?|new york(?:\s+city)?|los angeles|san diego|san jose|santa clara|mountain view|palo alto|menlo park|redwood city|sunnyvale|seattle|bellevue|redmond|austin|boston|cambridge(?:,\s*ma)?|chicago|atlanta|dallas|houston|denver|raleigh|durham|phoenix|tempe|irvine|santa monica|sacramento|portland|miami|tampa|orlando|philadelphia|pittsburgh|minneapolis|madison|ann arbor|toronto|vancouver|montreal|waterloo|ottawa|calgary|edmonton|mississauga|kitchener)\b/i

const US_STATES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
  "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
  "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi",
  "missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico",
  "new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania",
  "rhode island","south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming","district of columbia",
])
const US_STATE_ABBR = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
])
const CA_PROVINCES = new Set([
  "alberta","british columbia","manitoba","new brunswick","newfoundland and labrador",
  "northwest territories","nova scotia","nunavut","ontario","prince edward island",
  "quebec","saskatchewan","yukon",
])
const CA_PROVINCE_ABBR = new Set([
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
])

// Definitive non-US / non-Canada signals. Used by the cleanup script to
// deactivate only jobs we're CONFIDENT are outside scope. Ambiguous strings
// (e.g. "South San Francisco" with no state) are left active rather than
// risk killing real US listings.
const FOREIGN_COUNTRY_RE = new RegExp(
  "\\b(" +
    [
      // Anglo
      "united kingdom", "u\\.?k\\.?", "britain", "england", "scotland",
      "wales", "northern ireland", "republic of ireland", "ireland",
      // Europe
      "germany", "france", "spain", "italy", "netherlands", "holland",
      "belgium", "luxembourg", "switzerland", "austria", "portugal",
      "sweden", "norway", "denmark", "finland", "iceland", "poland",
      "czech republic", "czechia", "slovakia", "hungary", "romania",
      "bulgaria", "greece", "croatia", "slovenia", "estonia", "latvia",
      "lithuania", "ukraine", "russia",
      // Asia / Oceania
      "india", "china", "japan", "south korea", "korea", "taiwan",
      "hong kong", "singapore", "malaysia", "thailand", "indonesia",
      "philippines", "vietnam", "pakistan", "bangladesh", "sri lanka",
      "australia", "new zealand", "nepal",
      // Middle East / Africa
      "israel", "turkey", "egypt", "morocco", "south africa", "nigeria",
      "kenya", "u\\.?a\\.?e\\.?", "united arab emirates", "saudi arabia",
      "qatar", "bahrain", "oman", "lebanon", "jordan",
      // Latin America
      "brazil", "mexico", "argentina", "chile", "colombia", "peru",
      "uruguay", "venezuela", "ecuador", "costa rica", "panama",
    ].join("|") +
    ")\\b",
  "i"
)

// Cities unambiguously outside US/Canada. Excludes any name that collides with
// a US/Canadian place (no Berlin if there's a Berlin NH, etc.) — the few we
// keep have no significant US/Canada equivalent.
const FOREIGN_CITY_RE = new RegExp(
  "\\b(" +
    [
      // India
      "bangalore", "bengaluru", "mumbai", "new delhi", "chennai", "hyderabad",
      "kolkata", "ahmedabad", "gurgaon", "gurugram", "noida",
      // China
      "beijing", "shanghai", "shenzhen", "guangzhou", "chongqing",
      // Japan
      "tokyo", "osaka", "kyoto", "yokohama", "nagoya", "fukuoka",
      // Europe (only unambiguous ones)
      "krakow", "gdansk", "wroclaw", "stockholm", "copenhagen", "helsinki",
      "brussels", "munich", "frankfurt", "barcelona", "milan", "prague",
      "bucharest", "budapest", "sofia", "reykjavik", "zurich", "amsterdam",
      // Asia / Oceania
      "kuala lumpur", "bangkok", "jakarta", "manila", "hanoi",
      "ho chi minh", "seoul", "taipei",
      // Latin America
      "sao paulo", "rio de janeiro", "buenos aires", "guadalajara",
      "mexico city",
      // Middle East / Africa
      "tel aviv", "dubai", "abu dhabi", "riyadh", "lagos", "nairobi",
      "cape town", "johannesburg",
    ].join("|") +
    ")\\b",
  "i"
)

/**
 * Returns true when the location string contains a definitive non-US /
 * non-Canada signal (foreign country name or unambiguous foreign city).
 * Conservative: ambiguous strings return false — caller should leave the row
 * untouched rather than mis-deactivate a real US listing.
 */
export function isExplicitlyForeign(input: {
  location?: string | null
  workMode?: string | null
}): boolean {
  const haystack = buildHaystack(input)
  if (!haystack) return false
  if (FOREIGN_COUNTRY_RE.test(haystack)) return true
  if (FOREIGN_CITY_RE.test(haystack)) return true
  return false
}

/**
 * True only when the worksite is UNAMBIGUOUSLY outside the US — an explicit
 * foreign country, or a Canadian province/name — with no offsetting US signal.
 *
 * Used to gate US-only UI such as H-1B badges. Deliberately conservative: a
 * strong US signal always wins, and ambiguous or bare-"Remote" locations return
 * false, so we never hide H-1B intel on a real US role (only clear non-US ones).
 */
export function isNonUsWorksite(input: {
  location?: string | null
  workMode?: string | null
}): boolean {
  const haystack = buildHaystack(input)
  if (!haystack) return false
  const lower = haystack.toLowerCase()
  const tokens = extractRegionCodeTokens(haystack)

  // A strong US signal is decisive — never suppress.
  if (US_NAME_RE.test(haystack)) return false
  for (const name of US_STATES) if (lower.includes(name)) return false
  for (const t of tokens) if (US_STATE_ABBR.has(t)) return false

  // Otherwise: an explicit foreign country/city, or a Canadian signal, marks it
  // non-US. (US_STATE_ABBR and CA_PROVINCE_ABBR do not overlap.)
  if (isExplicitlyForeign(input)) return true
  if (CANADA_NAME_RE.test(haystack)) return true
  for (const name of CA_PROVINCES) if (lower.includes(name)) return true
  for (const t of tokens) if (CA_PROVINCE_ABBR.has(t)) return true

  return false
}

export function isAllowedLocation(input: {
  location?: string | null
  workMode?: string | null
}): boolean {
  const haystack = buildHaystack(input)

  if (!haystack) return true
  const lower = haystack.toLowerCase()

  // Strong US/CA signals: an explicit country name, a full state/province
  // name, or a recognized major US/CA city. These are unambiguous — they
  // cannot be confused with foreign ISO-2 codes (which is the main leak
  // path, e.g. "IN" reading as Indiana when the string also says "India").
  let hasStrongUsCaSignal = false
  if (US_NAME_RE.test(haystack) || CANADA_NAME_RE.test(haystack)) {
    hasStrongUsCaSignal = true
  }
  if (!hasStrongUsCaSignal) {
    for (const name of US_STATES) {
      if (lower.includes(name)) {
        hasStrongUsCaSignal = true
        break
      }
    }
  }
  if (!hasStrongUsCaSignal) {
    for (const name of CA_PROVINCES) {
      if (lower.includes(name)) {
        hasStrongUsCaSignal = true
        break
      }
    }
  }
  if (!hasStrongUsCaSignal && MAJOR_US_CA_CITY_RE.test(haystack)) {
    hasStrongUsCaSignal = true
  }

  // If an explicit foreign signal is present, only a *strong* US/CA signal
  // can rescue it. A bare 2-letter code like "IN" / "SC" / "PA" is not
  // enough because those collide with foreign ISO-2 codes
  // (IN → India, SC → Santa Catarina/Brazil, etc.).
  if (isExplicitlyForeign(input) && !hasStrongUsCaSignal) {
    return false
  }

  // Weaker signal: 2-letter region codes. Only consulted when no explicit
  // foreign signal contests them.
  let hasUsCaSignal = hasStrongUsCaSignal
  if (!hasUsCaSignal) {
    const tokens = extractRegionCodeTokens(haystack)
    for (const token of tokens) {
      if (US_STATE_ABBR.has(token) || CA_PROVINCE_ABBR.has(token)) {
        hasUsCaSignal = true
        break
      }
    }
  }

  // Remote is allowed, including generic remote listings with no region hint.
  if (REMOTE_RE.test(haystack)) return true

  return hasUsCaSignal
}

function buildHaystack(input: {
  location?: string | null
  workMode?: string | null
}): string {
  return [input.location, input.workMode]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" | ")
}

function extractRegionCodeTokens(raw: string): string[] {
  const tokens = new Set<string>()

  // 1) Keep existing all-caps detection (safe; low false-positive risk).
  for (const match of raw.match(/\b[A-Z]{2}\b/g) ?? []) {
    tokens.add(match)
  }

  // 2) Accept mixed/lowercase 2-letter region codes when they appear as
  // delimited segments, e.g. "San Francisco, ca" or "Toronto / on".
  for (const segment of raw.split(/[|,/;()\u2013\u2014-]+/)) {
    const cleaned = segment.trim().replace(/\./g, "")
    if (/^[A-Za-z]{2}$/.test(cleaned)) {
      tokens.add(cleaned.toUpperCase())
    }
  }

  return [...tokens]
}
