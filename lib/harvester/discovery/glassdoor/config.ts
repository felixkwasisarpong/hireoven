import fs from "node:fs"
import path from "node:path"

export type GlassdoorDiscoveryConfig = {
  source: "glassdoor"
  search_url_template: string
  pages_per_job: number
  sector_keywords: string[]
  location_keywords: string[]
}

export const DEFAULT_GLASSDOOR_CONFIG_PATH = path.join(
  process.cwd(),
  "scripts",
  "config",
  "glassdoor-discovery.json"
)

export const DEFAULT_GLASSDOOR_SEARCH_TEMPLATE =
  "https://www.glassdoor.com/Explore/browse-companies.htm?locKeyword={location}&keyword={sector}&page={page}"

const DEFAULT_SECTOR_KEYWORDS = [
  "software",
  "saas",
  "artificial intelligence",
  "machine learning",
  "data platform",
  "fintech",
  "cybersecurity",
  "cloud infrastructure",
  "devops",
  "healthtech",
  "biotech",
  "pharma",
  "semiconductor",
  "robotics",
  "it consulting",
  "banking technology",
  "insurance technology",
  "cleantech",
  "energy technology",
  "electric vehicles",
  "supply chain technology",
  "edtech",
]

const DEFAULT_LOCATION_KEYWORDS = [
  "United States",
  "San Francisco, CA",
  "New York, NY",
  "Seattle, WA",
  "Austin, TX",
  "Chicago, IL",
  "Boston, MA",
]

function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const values = value.map((item) => String(item).trim()).filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : fallback
}

export function defaultGlassdoorDiscoveryConfig(): GlassdoorDiscoveryConfig {
  return {
    source: "glassdoor",
    search_url_template: DEFAULT_GLASSDOOR_SEARCH_TEMPLATE,
    pages_per_job: 1,
    sector_keywords: DEFAULT_SECTOR_KEYWORDS,
    location_keywords: DEFAULT_LOCATION_KEYWORDS,
  }
}

export function loadGlassdoorDiscoveryConfig(
  configPath = process.env.GLASSDOOR_DISCOVERY_CONFIG || DEFAULT_GLASSDOOR_CONFIG_PATH
): GlassdoorDiscoveryConfig {
  const fallback = defaultGlassdoorDiscoveryConfig()
  if (!fs.existsSync(configPath)) return fallback

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<GlassdoorDiscoveryConfig>
  return {
    source: "glassdoor",
    search_url_template:
      typeof parsed.search_url_template === "string" && parsed.search_url_template.trim()
        ? parsed.search_url_template.trim()
        : fallback.search_url_template,
    pages_per_job:
      typeof parsed.pages_per_job === "number" && parsed.pages_per_job > 0
        ? Math.min(5, Math.floor(parsed.pages_per_job))
        : fallback.pages_per_job,
    sector_keywords: asStringList(parsed.sector_keywords, fallback.sector_keywords),
    location_keywords: asStringList(parsed.location_keywords, fallback.location_keywords),
  }
}

export function buildGlassdoorSearchUrl(args: {
  template: string
  sectorKeyword: string
  locationKeyword: string
  page?: number
}): string {
  const page = String(Math.max(1, args.page ?? 1))
  return args.template
    .replaceAll("{sector}", encodeURIComponent(args.sectorKeyword))
    .replaceAll("{location}", encodeURIComponent(args.locationKeyword))
    .replaceAll("{page}", encodeURIComponent(page))
}
