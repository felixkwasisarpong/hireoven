/**
 * Crunchbase organization → domain feeder.
 *
 * Crunchbase's Search API returns funded organizations with their homepage /
 * website fields. That gives us a list of company domains we can probe for
 * careers pages and enroll just like the BuiltWith feeder. This module is the
 * thin IO layer: call the Search API and normalize each org's site to a bare
 * domain. The driving script (scripts/discover-crunchbase.ts) wires the domain
 * list to careers-page probing + enrollFromApplyUrl().
 *
 * ============================== VERIFY LIVE ===============================
 * The exact Crunchbase v4 endpoint, auth header, request body shape, and
 * response envelope are NOT verifiable in this environment. The defaults below
 * follow the documented v4 Search API (POST searches/organizations with an
 * X-cb-user-key header) but BOTH the base URL (CRUNCHBASE_API_BASE) and the
 * parsing are written defensively: the response is read across several common
 * key shapes (entities / results / data) and several site-field names
 * (homepage_url / website_url / website / domain). Before relying on real
 * output, confirm the live envelope and adjust the parser if needed.
 * =========================================================================
 */

const DEFAULT_API_BASE = "https://api.crunchbase.com/api/v4"

/** Strip scheme/www/path from a host or URL; return a bare domain or null. */
export function normalizeDomain(input: string): string | null {
  const trimmed = (input ?? "").trim().toLowerCase()
  if (!trimmed || trimmed.startsWith("#")) return null
  const host = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/\.$/, "")
    .trim()
  if (!host.includes(".") || /\s/.test(host)) return null
  // Reject obvious junk (no usable label, or a leading dot).
  if (host.startsWith(".") || host.split(".").some((p) => p.length === 0)) return null
  return host
}

/** Common Crunchbase org-record shapes we read the site field out of. */
type CrunchbaseOrgFields = {
  homepage_url?: string | null
  website_url?: string | null
  website?: string | null
  domain?: string | null
}

type CrunchbaseOrgEntity = {
  properties?: CrunchbaseOrgFields
} & CrunchbaseOrgFields

type CrunchbaseSearchResponse = {
  entities?: CrunchbaseOrgEntity[]
  results?: CrunchbaseOrgEntity[]
  data?: { items?: CrunchbaseOrgEntity[]; entities?: CrunchbaseOrgEntity[] }
}

/** Read every org record out of whichever envelope key the API used. */
function extractEntities(data: CrunchbaseSearchResponse): CrunchbaseOrgEntity[] {
  if (Array.isArray(data.entities)) return data.entities
  if (Array.isArray(data.results)) return data.results
  if (Array.isArray(data.data?.items)) return data.data!.items!
  if (Array.isArray(data.data?.entities)) return data.data!.entities!
  return []
}

/** Pull the site field out of an org record (flat or under `properties`). */
function siteFieldOf(entity: CrunchbaseOrgEntity): string | null {
  const fields: CrunchbaseOrgFields = entity.properties ?? entity
  return (
    fields.homepage_url ??
    fields.website_url ??
    fields.website ??
    fields.domain ??
    null
  )
}

/**
 * Fetch funded-organization domains from the Crunchbase Search API.
 *
 * VERIFY LIVE — see the file header. Endpoint base is overridable via
 * CRUNCHBASE_API_BASE; the request is a documented v4 POST search; parsing is
 * defensive across envelope + field shapes.
 */
export async function fetchCrunchbaseDomains(input: {
  apiKey: string
  query?: string
  limit?: number
  fetchImpl?: typeof fetch
}): Promise<{ domains: string[] }> {
  const doFetch = input.fetchImpl ?? fetch
  const base = (process.env.CRUNCHBASE_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "")
  const limit = Math.max(1, Math.min(input.limit ?? 100, 1000))

  // Documented v4 Search API body. Defensive: if a deployment needs a GET with
  // ?user_key=, override CRUNCHBASE_API_BASE to that endpoint shape — the
  // response parsing below is endpoint-agnostic.
  const body: Record<string, unknown> = {
    field_ids: ["identifier", "website_url", "homepage_url"],
    limit,
  }
  if (input.query) {
    body.query = [
      {
        type: "predicate",
        field_id: "facet_ids",
        operator_id: "includes",
        values: ["company"],
      },
      {
        type: "predicate",
        field_id: "short_description",
        operator_id: "contains",
        values: [input.query],
      },
    ]
  }

  let data: CrunchbaseSearchResponse
  try {
    const res = await doFetch(`${base}/searches/organizations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "X-cb-user-key": input.apiKey,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { domains: [] }
    data = (await res.json()) as CrunchbaseSearchResponse
  } catch {
    return { domains: [] }
  }

  const domains = new Set<string>()
  for (const entity of extractEntities(data)) {
    const site = siteFieldOf(entity)
    if (!site) continue
    const d = normalizeDomain(site)
    if (d) domains.add(d)
  }

  return { domains: [...domains] }
}
