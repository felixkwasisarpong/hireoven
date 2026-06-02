import { getPostgresPool } from "@/lib/postgres/server"
import type { SignalApiAuthContext } from "./types"

type LogSignalApiRequestParams = {
  request: Request
  auth: SignalApiAuthContext
  status: number
  startedAtMs: number
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toLatencyMs(startedAtMs: number): number {
  const delta = Date.now() - startedAtMs
  if (!Number.isFinite(delta) || delta < 0) return 0
  return Math.min(Math.floor(delta), 2_147_483_647)
}

function shouldIgnoreLogError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null

  return code === "42P01" || code === "42703" || code === "22P02"
}

export async function logSignalApiRequest({
  request,
  auth,
  status,
  startedAtMs,
}: LogSignalApiRequestParams): Promise<void> {
  const pool = getPostgresPool()
  const route = new URL(request.url).pathname
  const latencyMs = toLatencyMs(startedAtMs)
  const apiKeyId = UUID_RE.test(auth.apiKeyId) ? auth.apiKeyId : null

  try {
    await pool.query(
      `INSERT INTO signal_api_request_log (
         api_key_id,
         tenant_id,
         route,
         method,
         status,
         request_id,
         latency_ms
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      [apiKeyId, auth.tenantId, route, request.method, status, auth.requestId, latencyMs]
    )
  } catch (error) {
    if (shouldIgnoreLogError(error)) return
    console.error("[signal-api] request log insert failed", error)
  }
}

export async function logAndReturnSignalApiResponse(
  request: Request,
  auth: SignalApiAuthContext,
  startedAtMs: number,
  response: Response
): Promise<Response> {
  await logSignalApiRequest({
    request,
    auth,
    status: response.status,
    startedAtMs,
  })
  return response
}
