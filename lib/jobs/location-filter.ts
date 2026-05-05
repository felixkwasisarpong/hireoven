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
  const haystack = [input.location, input.workMode]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" | ")
  if (!haystack) return false
  if (FOREIGN_COUNTRY_RE.test(haystack)) return true
  if (FOREIGN_CITY_RE.test(haystack)) return true
  return false
}

export function isAllowedLocation(input: {
  location?: string | null
  workMode?: string | null
}): boolean {
  const haystack = [input.location, input.workMode]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" | ")

  if (!haystack) return true

  if (REMOTE_RE.test(haystack)) return true
  if (US_NAME_RE.test(haystack)) return true
  if (CANADA_NAME_RE.test(haystack)) return true

  const lower = haystack.toLowerCase()
  for (const name of US_STATES) {
    if (lower.includes(name)) return true
  }
  for (const name of CA_PROVINCES) {
    if (lower.includes(name)) return true
  }

  const tokens = haystack.match(/\b[A-Z]{2}\b/g) ?? []
  for (const token of tokens) {
    if (US_STATE_ABBR.has(token) || CA_PROVINCE_ABBR.has(token)) return true
  }

  return false
}
