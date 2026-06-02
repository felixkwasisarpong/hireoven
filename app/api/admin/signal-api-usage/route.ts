import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

type SummaryRow = {
  total_requests: number | string | null
  success_requests: number | string | null
  error_requests: number | string | null
  avg_latency_ms: number | string | null
  last_request_at: string | null
  distinct_tenants: number | string | null
  distinct_keys: number | string | null
}

type TopRouteRow = {
  route: string
  request_count: number | string | null
  error_count: number | string | null
  avg_latency_ms: number | string | null
}

type TenantRow = {
  tenant_id: string
  request_count: number | string | null
  error_count: number | string | null
  last_request_at: string | null
}

type RecentRequestRow = {
  request_id: string
  tenant_id: string
  route: string
  method: string
  status: number | string | null
  latency_ms: number | string | null
  created_at: string | null
  api_key_id: string | null
  api_key_name: string | null
  api_key_prefix: string | null
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "")
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function missingTablesResponse() {
  return NextResponse.json(
    {
      error: "Signal API request log tables are missing",
      hint: "Run scripts/migrations/add-signal-api-keys.sql",
    },
    { status: 503 }
  )
}

function handleKnownError(error: unknown): NextResponse | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null

  if (code === "42P01" || code === "42703") return missingTablesResponse()
  return null
}

async function fetchUsageData(params: {
  tenantId: string | null
  hours: number
  limit: number
}) {
  const pool = getPostgresPool()

  const [summaryRes, topRoutesRes, tenantsRes, recentRes] = await Promise.all([
    pool.query<SummaryRow>(
      `SELECT
         COUNT(*)::bigint AS total_requests,
         COUNT(*) FILTER (WHERE status BETWEEN 200 AND 299)::bigint AS success_requests,
         COUNT(*) FILTER (WHERE status >= 400)::bigint AS error_requests,
         ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency_ms,
         MAX(created_at)::text AS last_request_at,
         COUNT(DISTINCT tenant_id)::bigint AS distinct_tenants,
         COUNT(DISTINCT api_key_id)::bigint AS distinct_keys
       FROM signal_api_request_log
       WHERE ($1::text IS NULL OR tenant_id = $1::text)
         AND created_at >= NOW() - make_interval(hours => $2::int)`,
      [params.tenantId, params.hours]
    ),
    pool.query<TopRouteRow>(
      `SELECT
         route,
         COUNT(*)::bigint AS request_count,
         COUNT(*) FILTER (WHERE status >= 400)::bigint AS error_count,
         ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency_ms
       FROM signal_api_request_log
       WHERE ($1::text IS NULL OR tenant_id = $1::text)
         AND created_at >= NOW() - make_interval(hours => $2::int)
       GROUP BY route
       ORDER BY request_count DESC, route ASC
       LIMIT 8`,
      [params.tenantId, params.hours]
    ),
    pool.query<TenantRow>(
      `SELECT
         tenant_id,
         COUNT(*)::bigint AS request_count,
         COUNT(*) FILTER (WHERE status >= 400)::bigint AS error_count,
         MAX(created_at)::text AS last_request_at
       FROM signal_api_request_log
       WHERE ($1::text IS NULL OR tenant_id = $1::text)
         AND created_at >= NOW() - make_interval(hours => $2::int)
       GROUP BY tenant_id
       ORDER BY request_count DESC, tenant_id ASC
       LIMIT 10`,
      [params.tenantId, params.hours]
    ),
    pool.query<RecentRequestRow>(
      `SELECT
         log.request_id,
         log.tenant_id,
         log.route,
         log.method,
         log.status,
         log.latency_ms,
         log.created_at::text,
         log.api_key_id::text,
         key.name AS api_key_name,
         key.key_prefix AS api_key_prefix
       FROM signal_api_request_log log
       LEFT JOIN signal_api_keys key
         ON key.id = log.api_key_id
       WHERE ($1::text IS NULL OR log.tenant_id = $1::text)
         AND log.created_at >= NOW() - make_interval(hours => $2::int)
       ORDER BY log.created_at DESC
       LIMIT $3`,
      [params.tenantId, params.hours, params.limit]
    ),
  ])

  return {
    summary: summaryRes.rows[0],
    topRoutes: topRoutesRes.rows,
    tenants: tenantsRes.rows,
    recentRequests: recentRes.rows,
  }
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || null
  const hours = clampInt(request.nextUrl.searchParams.get("hours"), 168, 1, 24 * 90)
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 50, 1, 500)
  const format = request.nextUrl.searchParams.get("format")?.trim() || "json"
  const dataset = request.nextUrl.searchParams.get("dataset")?.trim() || "recentRequests"

  try {
    const { summary, topRoutes, tenants, recentRequests } = await fetchUsageData({
      tenantId,
      hours,
      limit,
    })

    if (format === "csv") {
      if (dataset === "tenants") {
        const lines = [
          ["tenant_id", "request_count", "error_count", "last_request_at"].join(","),
          ...tenants.map((row) =>
            [
              row.tenant_id,
              toNumber(row.request_count),
              toNumber(row.error_count),
              row.last_request_at ?? "",
            ].map(csvEscape).join(",")
          ),
        ]
        return new NextResponse(lines.join("\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="signal-api-tenant-usage.csv"',
          },
        })
      }

      if (dataset === "topRoutes") {
        const lines = [
          ["route", "request_count", "error_count", "avg_latency_ms"].join(","),
          ...topRoutes.map((row) =>
            [
              row.route,
              toNumber(row.request_count),
              toNumber(row.error_count),
              toNumber(row.avg_latency_ms),
            ].map(csvEscape).join(",")
          ),
        ]
        return new NextResponse(lines.join("\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="signal-api-top-routes.csv"',
          },
        })
      }

      const lines = [
        [
          "request_id",
          "tenant_id",
          "route",
          "method",
          "status",
          "latency_ms",
          "created_at",
          "api_key_id",
          "api_key_name",
          "api_key_prefix",
        ].join(","),
        ...recentRequests.map((row) =>
          [
            row.request_id,
            row.tenant_id,
            row.route,
            row.method,
            toNumber(row.status),
            toNumber(row.latency_ms),
            row.created_at ?? "",
            row.api_key_id ?? "",
            row.api_key_name ?? "",
            row.api_key_prefix ?? "",
          ].map(csvEscape).join(",")
        ),
      ]
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="signal-api-request-log.csv"',
        },
      })
    }

    return NextResponse.json({
      summary: {
        totalRequests: toNumber(summary?.total_requests),
        successRequests: toNumber(summary?.success_requests),
        errorRequests: toNumber(summary?.error_requests),
        avgLatencyMs: toNumber(summary?.avg_latency_ms),
        lastRequestAt: summary?.last_request_at ?? null,
        distinctTenants: toNumber(summary?.distinct_tenants),
        distinctKeys: toNumber(summary?.distinct_keys),
      },
      topRoutes: topRoutes.map((row) => ({
        route: row.route,
        requestCount: toNumber(row.request_count),
        errorCount: toNumber(row.error_count),
        avgLatencyMs: toNumber(row.avg_latency_ms),
      })),
      tenants: tenants.map((row) => ({
        tenantId: row.tenant_id,
        requestCount: toNumber(row.request_count),
        errorCount: toNumber(row.error_count),
        lastRequestAt: row.last_request_at,
      })),
      recentRequests: recentRequests.map((row) => ({
        requestId: row.request_id,
        tenantId: row.tenant_id,
        route: row.route,
        method: row.method,
        status: toNumber(row.status),
        latencyMs: toNumber(row.latency_ms),
        createdAt: row.created_at,
        apiKeyId: row.api_key_id,
        apiKeyName: row.api_key_name,
        apiKeyPrefix: row.api_key_prefix,
      })),
    })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
