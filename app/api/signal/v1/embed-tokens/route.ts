import { NextResponse } from "next/server"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import { createEmbedToken, listEmbedTokens, type EmbedTier } from "@/lib/embed/tokens"

export const runtime = "nodejs"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIERS: EmbedTier[] = ["free", "pro", "whitelabel"]

// Partner-managed embed tokens. A token unlocks attribution-removal / origin
// allowlisting for the widgets. Bound to the calling Signal API key (DB-backed
// only — env keys have no FK-able id).
export async function GET(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, { requiredScopes: ["embed.read"] })
  if (auth instanceof NextResponse) return auth
  const finish = (r: Response) => logAndReturnSignalApiResponse(request, auth, startedAtMs, r)

  if (!UUID_RE.test(auth.apiKeyId)) {
    return finish(signalApiError(400, "Embed tokens require a database-issued API key", "BAD_REQUEST", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
  try {
    const tokens = await listEmbedTokens(auth.apiKeyId)
    return finish(signalApiJson(auth, { tokens }))
  } catch (e) {
    console.error("[signal/v1/embed-tokens] list error", e)
    return finish(signalApiError(500, "Unable to list embed tokens", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}

export async function POST(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, { requiredScopes: ["embed.write"] })
  if (auth instanceof NextResponse) return auth
  const finish = (r: Response) => logAndReturnSignalApiResponse(request, auth, startedAtMs, r)

  if (!UUID_RE.test(auth.apiKeyId)) {
    return finish(signalApiError(400, "Embed tokens require a database-issued API key", "BAD_REQUEST", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const tier = TIERS.includes(body.tier as EmbedTier) ? (body.tier as EmbedTier) : "free"
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : null
  const showAttribution = body.show_attribution === false ? false : true
  const allowedOrigins = Array.isArray(body.allowed_origins)
    ? body.allowed_origins.filter((o): o is string => typeof o === "string").map((o) => o.trim().toLowerCase()).filter(Boolean).slice(0, 50)
    : null

  try {
    const { token, record } = await createEmbedToken({
      signalKeyId: auth.apiKeyId,
      tier,
      label,
      showAttribution,
      allowedOrigins,
    })
    return finish(signalApiJson(auth, { token, id: record.id, tier: record.tier, show_attribution: record.showAttribution }, { status: 201 }))
  } catch (e) {
    console.error("[signal/v1/embed-tokens] create error", e)
    return finish(signalApiError(500, "Unable to create embed token", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}
