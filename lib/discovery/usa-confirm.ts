/**
 * US/Canada job-location confirmation helpers.
 *
 * Used at discovery time to decide whether a newly-found career source has
 * any US- or Canada-based openings before it is enrolled in the companies table.
 *
 * Design principles:
 *  - Prefer false negatives over false positives: when in doubt, return false
 *    rather than admitting non-US/Canada sources.
 *  - "Remote" without a country qualifier is treated as compatible because
 *    the majority of North American companies post remote jobs without country
 *    language and HireOven's user base is focused on the US and Canada.
 *  - Each ATS has its own location field shape — callers normalize before
 *    passing to the generic helpers here.
 */

// ─── US state abbreviations ───────────────────────────────────────────────────

const US_STATE_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","GU","VI","AS","MP",
])

const CANADA_PROVINCE_ABBRS = new Set([
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
])

// US cities that are common enough to appear without state context in job posts.
const KNOWN_US_CITIES = new Set([
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia",
  "san antonio", "san diego", "dallas", "san jose", "austin", "jacksonville",
  "fort worth", "columbus", "charlotte", "indianapolis", "san francisco",
  "seattle", "denver", "nashville", "oklahoma city", "el paso", "washington",
  "boston", "portland", "las vegas", "memphis", "louisville", "baltimore",
  "milwaukee", "albuquerque", "tucson", "fresno", "sacramento", "mesa",
  "kansas city", "atlanta", "omaha", "colorado springs", "raleigh", "miami",
  "minneapolis", "tulsa", "cleveland", "wichita", "arlington", "new orleans",
  "bakersfield", "tampa", "aurora", "anaheim", "santa ana", "corpus christi",
  "riverside", "st. louis", "lexington", "pittsburgh", "anchorage", "stockton",
  "cincinnati", "st. paul", "greensboro", "toledo", "newark", "plano",
  "henderson", "lincoln", "orlando", "jersey city", "chandler", "st. petersburg",
  "laredo", "norfolk", "madison", "durham", "lubbock", "winston-salem",
  "garland", "glendale", "hialeah", "reno", "baton rouge", "irvine",
  "chesapeake", "scottsdale", "north las vegas", "fremont", "gilbert",
  "san bernardino", "boise", "birmingham", "rochester", "richmond",
  "spokane", "des moines", "montgomery", "modesto", "tacoma", "fontana",
  "fayetteville", "glendale", "moreno valley", "akron", "yonkers", "aurora",
  "oxnard", "colombus", "little rock", "grand rapids", "salt lake city",
  "huntington beach", "tallahassee", "worcester", "knoxville", "newport news",
  "brownsville", "santa clarita", "providence", "garden grove", "oceanside",
  "chattanooga", "fort lauderdale", "rancho cucamonga", "santa rosa",
  "huntsville", "tempe", "aurora", "cape coral", "ontario", "sioux falls",
  "peoria", "springfield", "elk grove", "pembroke pines", "eugene",
  "corona", "cary", "fort collins", "hayward", "lancaster", "salinas",
  "palmdale", "sunnyvale", "pomona", "escondido", "torrance", "pasadena",
  "rockford", "savannah", "bridgeport", "paterson", "jackson", "alexandria",
  "clarksville", "killeen", "hollywood", "macon", "kansas city",
  "sunnyvale", "santa clara", "menlo park", "palo alto", "mountain view",
  "redwood city", "bellevue", "kirkland", "bothell", "redmond",
])

const KNOWN_CANADIAN_CITIES = new Set([
  "toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton",
  "mississauga", "winnipeg", "quebec city", "hamilton", "kitchener",
  "waterloo", "halifax", "victoria", "burnaby", "surrey", "markham",
  "richmond", "brampton", "saskatoon", "regina", "moncton",
  "st. john's", "st johns",
])

// Country names / strings that clearly indicate non-US/Canada.
// We match these as substrings (lowercased) against the raw location string.
const NON_US_CA_COUNTRY_FRAGMENTS = [
  "united kingdom", " uk", "england", "scotland", "wales", "london",
  "australia", " sydney", " melbourne", " brisbane", " perth",
  "germany", " berlin", " munich", " hamburg", " frankfurt",
  "france", " paris", " lyon",
  "netherlands", " amsterdam",
  "india", " bangalore", " bengaluru", " hyderabad", " mumbai", " pune", " chennai", " delhi",
  "singapore",
  "japan", " tokyo",
  "china", " beijing", " shanghai",
  "brazil", " são paulo", " sao paulo",
  "mexico", " ciudad de mexico",
  "ireland", " dublin",
  "spain", " madrid", " barcelona",
  "italy", " rome", " milan",
  "poland", " warsaw",
  "sweden", " stockholm",
  "denmark", " copenhagen",
  "norway", " oslo",
  "finland", " helsinki",
  "switzerland", " zurich",
  "israel", " tel aviv",
  "new zealand", " auckland",
  "south korea", " seoul",
  "taiwan", " taipei",
  "hong kong",
  "philippines", " manila",
  "indonesia", " jakarta",
  "malaysia", " kuala lumpur",
  "pakistan", " karachi",
  "nigeria", " lagos",
  "south africa", " johannesburg", " cape town",
  "kenya", " nairobi",
  "egypt", " cairo",
  "argentina", " buenos aires",
  "colombia", " bogota",
  "chile", " santiago",
  "peru", " lima",
  "ukraine", " kyiv",
  "russia", " moscow",
  "turkey", " istanbul",
  "saudi arabia", " riyadh",
  "uae", "dubai", "abu dhabi",
  "vietnam", " ho chi minh",
  "thailand", " bangkok",
]

/**
 * Returns true if the raw location string appears to be a US or Canada location.
 * This is intentionally inclusive for ambiguous strings like "Remote" —
 * those are treated as US/Canada-compatible.
 */
export function isUsaLocation(location: string | null | undefined): boolean {
  if (!location) return false
  const raw = location.trim()
  if (!raw) return false

  const lower = raw.toLowerCase()

  // Explicit "United States" variants.
  if (/\bunited states\b/.test(lower)) return true
  if (/\bu\.s\.a\.?\b/.test(lower)) return true
  if (/\b\(?usa?\)?\b/.test(lower)) return true
  if (/\bcanada\b/.test(lower)) return true
  if (/\bcanadian\b/.test(lower)) return true

  // Remote without a non-US/Canada country modifier.
  if (/\bremote\b/.test(lower)) {
    // "Remote - UK", "Remote (India)" etc. should fail.
    if (NON_US_CA_COUNTRY_FRAGMENTS.some(f => lower.includes(f))) return false
    return true
  }

  // ", STATE" or "(STATE)" patterns — e.g. "San Francisco, CA" or "Austin (TX)".
  const stateMatch = raw.match(/[,\s(]+([A-Z]{2})[)\s]*$/)
  if (stateMatch && US_STATE_ABBRS.has(stateMatch[1])) return true
  if (stateMatch && CANADA_PROVINCE_ABBRS.has(stateMatch[1])) return true

  // "City, State" where city is a known US city.
  for (const city of KNOWN_US_CITIES) {
    if (lower.startsWith(city)) return true
  }
  for (const city of KNOWN_CANADIAN_CITIES) {
    if (lower.startsWith(city)) return true
  }

  // Anything that contains a clearly non-US/Canada country is out.
  if (NON_US_CA_COUNTRY_FRAGMENTS.some(f => lower.includes(f))) return false

  // Ambiguous — don't claim it's in the US or Canada.
  return false
}

/**
 * Returns true if the country code/name is explicitly the US or Canada.
 * Use this when the ATS gives you a structured country field (SmartRecruiters,
 * Workday, etc.) rather than a raw location string.
 */
export function isUsaCountryCode(country: string | null | undefined): boolean {
  if (!country) return false
  const c = country.trim().toLowerCase()
  return (
    c === "us" ||
    c === "usa" ||
    c === "united states" ||
    c === "united states of america" ||
    c === "ca" ||
    c === "can" ||
    c === "canada"
  )
}

export type JobLocationLike = {
  location?: string | null
  country?: string | null
  countryCode?: string | null
  remoteCountries?: string[] | null
}

/**
 * Checks a batch of job records to confirm at least one US/Canada-based role.
 * Returns the count alongside the boolean result. The usa* names are kept for
 * compatibility with existing discovery columns and callers.
 */
export function confirmsUsaJobs(jobs: JobLocationLike[]): { confirmed: boolean; usaCount: number } {
  let usaCount = 0
  for (const job of jobs) {
    const byCode =
      isUsaCountryCode(job.country) ||
      isUsaCountryCode(job.countryCode)
    const byLocation = isUsaLocation(job.location)
    const byRemote =
      Array.isArray(job.remoteCountries) &&
      job.remoteCountries.some(c => isUsaCountryCode(c))

    if (byCode || byLocation || byRemote) usaCount++
  }
  return { confirmed: usaCount > 0, usaCount }
}
