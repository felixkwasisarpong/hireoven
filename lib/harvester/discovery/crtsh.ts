/**
 * Certificate Transparency discovery via crt.sh.
 *
 * crt.sh exposes a JSON endpoint over the publicly-logged TLS certs.
 *   https://crt.sh/?q=%25.workable.com&output=json
 *
 * `name_value` carries the cert's Common Name + every SAN, newline-separated.
 * We extract unique customer-style subdomains of the target domain (e.g.
 * `loomly.workable.com`) and drop vendor-reserved labels like `www`, `api`, etc.
 *
 * The endpoint is single-host and slow under load — always retry conservatively
 * and serialize requests across domains.
 */

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_ATTEMPTS = 3

type CrtShEntry = {
  name_value?: string
  common_name?: string
}

export type DiscoveredHost = {
  /** Full hostname, e.g. "loomly.workable.com". */
  host: string
  /** Customer-style label, e.g. "loomly". */
  slug: string
}

const VENDOR_RESERVED: Record<string, ReadonlySet<string>> = {
  "greenhouse.io": new Set([
    "www",
    "boards",
    "job-boards",
    "boards-api",
    "harvest",
    "app",
    "api",
    "blog",
    "developers",
    "events",
    "support",
    "status",
    "go",
    "info",
    "marketing",
    "partners",
    "sandbox",
    "staging",
    "test",
    "dev",
  ]),
  "lever.co": new Set([
    "www",
    "jobs",
    "api",
    "hire",
    "blog",
    "app",
    "status",
    "support",
    "marketing",
    "events",
    "developers",
    "go",
    "info",
    "sandbox",
    "staging",
    "test",
  ]),
  "ashbyhq.com": new Set([
    "www",
    "jobs",
    "app",
    "api",
    "blog",
    "developers",
    "status",
    "support",
    "marketing",
    "sandbox",
    "staging",
    "test",
  ]),
  "smartrecruiters.com": new Set([
    "www",
    "jobs",
    "careers",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "developers",
    "marketing",
    "events",
    "go",
    "info",
    "sandbox",
    "staging",
    "test",
    "company",
  ]),
  "workable.com": new Set([
    "www",
    "apply",
    "jobs",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "accounts",
    "auth",
    "login",
    "help",
    "developers",
    "marketing",
    "go",
    "info",
    "sandbox",
    "staging",
    "test",
  ]),
  "myworkdayjobs.com": new Set([
    // Workday root subdomains are wd1..wdN; tenants sit one level deeper
    // (e.g. "nvidia.wd5.myworkdayjobs.com"). Top-level vendor labels are rare.
    "www",
  ]),
  "recruitee.com": new Set([
    "www",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "login",
    "auth",
    "accounts",
    "help",
    "marketing",
    "sandbox",
    "staging",
    "test",
  ]),
  "teamtailor.com": new Set([
    "www",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "login",
    "auth",
    "accounts",
    "help",
    "marketing",
    "developers",
    "sandbox",
    "staging",
    "test",
  ]),
  "bamboohr.com": new Set([
    "www",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "login",
    "auth",
    "accounts",
    "help",
    "marketing",
    "developers",
    "sandbox",
    "staging",
    "test",
  ]),
  "applytojob.com": new Set([
    "www",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "login",
    "auth",
    "accounts",
    "help",
    "marketing",
    "sandbox",
    "staging",
    "test",
  ]),
  "personio.com": new Set([
    "www",
    "app",
    "api",
    "blog",
    "status",
    "support",
    "login",
    "auth",
    "accounts",
    "help",
    "developers",
    "marketing",
    "sandbox",
    "staging",
    "test",
    // `jobs.personio.com` is the vendor host customers nest under; tenants
    // appear as `{slug}.jobs.personio.com`. Filter the apex-level `jobs` label.
    "jobs",
  ]),
}

function isSlugLabel(label: string): boolean {
  if (label.length < 2 || label.length > 60) return false
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(label)
}

/**
 * Extract the customer label from a host given a target apex domain.
 *  - `loomly.workable.com` + `workable.com` → "loomly"
 *  - `nvidia.wd5.myworkdayjobs.com` + `myworkdayjobs.com` → "nvidia"
 *  - `www.workable.com` + `workable.com` → null (vendor reserved)
 *  - `workable.com` + `workable.com` → null (apex)
 */
export function extractCustomerSlug(host: string, apex: string): string | null {
  const lowered = host.toLowerCase()
  if (lowered === apex) return null
  if (!lowered.endsWith(`.${apex}`)) return null

  const labels = lowered.slice(0, lowered.length - apex.length - 1).split(".")
  if (labels.length === 0) return null

  // Take the first (left-most) label — that's the customer identifier even
  // for nested vendor infrastructure like `{tenant}.wd5.myworkdayjobs.com`.
  const candidate = labels[0]
  if (!isSlugLabel(candidate)) return null

  // Workday tenants must sit one level under a `wdN` cluster host. crt.sh
  // floods this apex with vendor infra (`wd117.…`, `dr-wd501.…`, `impl-wd108.…`)
  // that has no customer prefix — reject anything that isn't the
  // `{tenant}.wdN.myworkdayjobs.com` shape.
  if (apex === "myworkdayjobs.com") {
    const second = labels[1]
    if (!second || !/^wd\d{1,3}$/.test(second)) return null
  }

  // BambooHR's free trial creates a public subdomain for every signup, so
  // crt.sh surfaces thousands of trial/demo accounts that aren't real
  // employers (`csgdemo`, `falconheatinganairtrial`, `pss1919`, random
  // gibberish like `chgjhkjlkj`). Filter the most obvious patterns at
  // discovery time; the harvester's tier_dead promotion handles the rest.
  if (apex === "bamboohr.com" && isBogusBambooSlug(candidate)) return null

  const reserved = VENDOR_RESERVED[apex]
  if (reserved?.has(candidate)) return null

  return candidate
}

const BAMBOO_TRIAL_SUFFIX_RE = /(demo|trial|test|staging|sandbox|playground|training)\d*$/i
const BAMBOO_RANDOM_RE = /^[bcdfghjklmnpqrstvwxyz]{5,}\d*$/i
const BAMBOO_SHORT_NUMBERED_RE = /^[a-z]{1,3}\d+$/i

function isBogusBambooSlug(slug: string): boolean {
  if (BAMBOO_TRIAL_SUFFIX_RE.test(slug)) return true
  if (BAMBOO_RANDOM_RE.test(slug)) return true
  if (BAMBOO_SHORT_NUMBERED_RE.test(slug)) return true
  return false
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type CrtShFetchOptions = {
  timeoutMs?: number
  maxAttempts?: number
  fetchImpl?: typeof fetch
  userAgent?: string
}

/**
 * Raw crt.sh query — returns the parsed JSON array (or throws).
 * Caller is responsible for rate-limiting across multiple queries.
 */
export async function fetchCrtShEntries(
  apex: string,
  options: CrtShFetchOptions = {}
): Promise<CrtShEntry[]> {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(apex)}&output=json`
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)

  let attempt = 0
  let lastError: unknown = null
  while (attempt < maxAttempts) {
    attempt += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: {
          "user-agent": options.userAgent ?? "hireoven-harvester/1.0 (+bot@hireoven.com)",
          accept: "application/json",
        },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!response.ok) {
        if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < maxAttempts) {
          await sleep(500 * attempt)
          continue
        }
        throw new Error(`crt.sh returned ${response.status} for ${apex}`)
      }
      const data = (await response.json()) as CrtShEntry[]
      if (!Array.isArray(data)) {
        throw new Error(`crt.sh returned non-array for ${apex}`)
      }
      return data
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt < maxAttempts) {
        await sleep(500 * attempt)
        continue
      }
    }
  }
  throw lastError ?? new Error(`crt.sh fetch exhausted retries for ${apex}`)
}

/**
 * High-level: query crt.sh for `*.{apex}`, return unique customer-style subdomains.
 * Filters vendor reserved labels (www, api, blog, etc.) and apex itself.
 */
export async function discoverHostsForApex(
  apex: string,
  options: CrtShFetchOptions = {}
): Promise<DiscoveredHost[]> {
  const entries = await fetchCrtShEntries(apex, options)
  const seenHosts = new Set<string>()
  const out: DiscoveredHost[] = []

  for (const entry of entries) {
    const allNames = [
      entry.common_name,
      ...(entry.name_value?.split("\n") ?? []),
    ].filter((value): value is string => Boolean(value))

    for (const name of allNames) {
      const host = name.trim().toLowerCase().replace(/^\*\./, "")
      if (!host || seenHosts.has(host)) continue
      seenHosts.add(host)

      const slug = extractCustomerSlug(host, apex)
      if (!slug) continue
      out.push({ host, slug })
    }
  }

  return out
}
