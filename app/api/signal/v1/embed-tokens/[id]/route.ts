import { NextResponse } from "next/server"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import { revokeEmbedToken } from "@/lib/embed/tokens"

export const runtime = "nodejs"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, { requiredScopes: ["embed.write"] })
  if (auth instanceof NextResponse) return auth
  const finish = (r: Response) => logAndReturnSignalApiResponse(request, auth, startedAtMs, r)

  const { id } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(auth.apiKeyId)) {
    return finish(signalApiError(400, "Invalid token id", "BAD_REQUEST", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }

  try {
    const revoked = await revokeEmbedToken(id, auth.apiKeyId)
    if (!revoked) {
      return finish(signalApiError(404, "Token not found", "NOT_FOUND", auth.requestId, auth.rateLimit, undefined, auth.quota))
    }
    return finish(signalApiJson(auth, { revoked: true, id }))
  } catch (e) {
    console.error("[signal/v1/embed-tokens] revoke error", e)
    return finish(signalApiError(500, "Unable to revoke embed token", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}
