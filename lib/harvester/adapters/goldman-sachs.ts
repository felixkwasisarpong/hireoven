/**
 * Goldman Sachs careers adapter.
 *
 * GS runs a custom Next.js/Apollo portal at higher.gs.com backed by a private
 * GraphQL gateway: api-higher.gs.com/gateway/api/v1/graphql
 *
 * The `roleSearch` query requires at least one `experiences` value — we pass
 * all four valid enum values so every role type is returned.
 *
 * Page size is 50 to keep response bodies manageable; GS has ~1500 open roles.
 *
 * Apply URL pattern: https://higher.gs.com/content/en/careers/directory/role.html?id={roleId}
 *
 * ats_identifier: anything (ignored — endpoint is fixed); convention: "goldman-sachs"
 */

import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

const GQL_ENDPOINT = "https://api-higher.gs.com/gateway/api/v1/graphql"
const PORTAL_BASE = "https://higher.gs.com"
const ROLE_URL_PREFIX = `${PORTAL_BASE}/roles/`

const ALL_EXPERIENCES = ["PROFESSIONAL", "EARLY_CAREER", "CAMPUS", "INTERNAL_MOBILITY"]
const PAGE_SIZE = 50

function intEnv(name: string, dflt: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

const MAX_PAGES = intEnv("HARVESTER_GOLDMAN_SACHS_MAX_PAGES", 60)

type GsLocation = {
  city?: string | null
  state?: string | null
  country?: string | null
}

type GsRole = {
  roleId?: string | null
  jobTitle?: string | null
  jobFunction?: string | null
  division?: string | null
  shortDescription?: string | null
  descriptionHtml?: string | null
  lastPostedDate?: string | null
  locations?: GsLocation[] | null
}

type GsRoleSearchResult = {
  totalCount?: number | null
  items?: GsRole[] | null
}

type GsGraphQlResponse = {
  data?: { roleSearch?: GsRoleSearchResult | null } | null
  errors?: unknown[] | null
}

const GET_ROLES_QUERY = `
query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items {
      roleId
      jobTitle
      jobFunction
      division
      shortDescription
      descriptionHtml
      lastPostedDate
      locations { city state country }
    }
  }
}
`.trim()

function stripHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || undefined
}

function flattenLocation(locs: GsLocation[] | null | undefined): string | undefined {
  if (!locs || locs.length === 0) return undefined
  const parts = locs.map((l) => [l.city, l.state, l.country].filter(Boolean).join(", "))
  return parts.filter(Boolean).join(" | ") || undefined
}

function mapRole(role: GsRole): HarvestedJob | null {
  const roleId = role.roleId?.trim()
  const title = role.jobTitle?.trim()
  if (!roleId || !title) return null

  // roleId format: "174342_GS_MID_CAREER" — numeric prefix is the portal ID
  const numericId = roleId.match(/^(\d+)/)?.[1] ?? roleId
  const applyUrl = `${ROLE_URL_PREFIX}${numericId}`
  const description = stripHtml(role.descriptionHtml) ?? role.shortDescription?.trim() ?? undefined
  const location = flattenLocation(role.locations)
  const postedAt = role.lastPostedDate ? new Date(role.lastPostedDate).toISOString() : undefined

  return {
    externalId: `gs:${roleId}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    contentHash: hashContent([title, applyUrl, location, description?.slice(0, 2_000), postedAt]),
  }
}

async function fetchPage(
  pageNumber: number,
  ctx: HarvestCtx
): Promise<{ roles: GsRole[]; totalCount: number; latencyMs: number } | null> {
  const body = JSON.stringify({
    operationName: "GetRoles",
    variables: {
      searchQueryInput: {
        page: { pageNumber, pageSize: PAGE_SIZE },
        experiences: ALL_EXPERIENCES,
      },
    },
    query: GET_ROLES_QUERY,
  })

  const result = await conditionalFetchJson<GsGraphQlResponse>(GQL_ENDPOINT, ctx, {
    method: "POST",
    body,
    maxAttempts: 3,
  })

  if (result.kind !== "ok") return null
  const search = result.data?.data?.roleSearch
  if (!search) return null

  return {
    roles: search.items ?? [],
    totalCount: search.totalCount ?? 0,
    latencyMs: result.upstreamLatencyMs,
  }
}

export const goldmanSachsAdapter: AtsAdapter = {
  name: "goldman-sachs",
  concurrency: envConcurrency("goldman-sachs", 1),

  detectFromUrl(url: string): { slug: string } | null {
    if (/higher\.gs\.com/i.test(url) || /api-higher\.gs\.com/i.test(url)) {
      return { slug: "goldman-sachs" }
    }
    return null
  },

  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()

    const seen = new Map<string, HarvestedJob>()
    let totalLatencyMs = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageCtx: HarvestCtx = { ...ctx, etag: null, lastModified: null }
      const result = await fetchPage(page, pageCtx)

      if (!result) {
        if (page === 1) {
          const err = new Error("goldman-sachs: page 1 fetch failed")
          ;(err as Error & { status?: number | null }).status = null
          throw err
        }
        break
      }

      totalLatencyMs += result.latencyMs

      for (const role of result.roles) {
        const job = mapRole(role)
        if (job && !seen.has(job.externalId)) seen.set(job.externalId, job)
      }

      const fetched = (page - 1) * PAGE_SIZE + result.roles.length
      if (fetched >= result.totalCount || result.roles.length < PAGE_SIZE) break
    }

    return {
      jobs: Array.from(seen.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "goldman-sachs",
      sourceAtsSlug: "goldman-sachs",
      fetchedAt,
      upstreamLatencyMs: Math.max(totalLatencyMs, Date.now() - startedAt),
    }
  },
}
