import { NextRequest, NextResponse } from "next/server"
import {
  ApplicationXRayLoadError,
  getApplicationXRayForUser,
  type ApplicationXRayResponsePayload,
} from "@/lib/application-xray/server"
import { getSessionUserFromRequest, type SessionUser } from "@/lib/auth/session-user"

type RouteContext = {
  params: Promise<{ id: string }>
}

export type ApplicationXRayRouteDeps = {
  getSessionUser?: (request: NextRequest) => Promise<SessionUser | null>
  getApplicationXRayForUser?: (input: {
    userId: string
    jobId: string
    resumeId?: string | null
    now: string
  }) => Promise<ApplicationXRayResponsePayload>
  now?: () => string
}

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const

export async function handleApplicationXRayRoute(
  request: NextRequest,
  context: RouteContext,
  deps: ApplicationXRayRouteDeps = {},
) {
  const session = await (deps.getSessionUser ?? getSessionUserFromRequest)(request)
  if (!session) {
    return json({ error: "Unauthorized" }, 401)
  }

  const { id } = await context.params
  const rawResumeId = request.nextUrl.searchParams.get("resumeId")
  const resumeId = rawResumeId?.trim() || null
  const computedAt = deps.now?.() ?? new Date().toISOString()

  try {
    const payload = await (deps.getApplicationXRayForUser ?? getApplicationXRayForUser)({
      userId: session.sub,
      jobId: id,
      resumeId,
      now: computedAt,
    })
    return json(payload, 200)
  } catch (error) {
    if (error instanceof ApplicationXRayLoadError) {
      return json({ error: error.code }, error.status)
    }
    console.error("[api/jobs/[id]/xray] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return json({ error: "APPLICATION_XRAY_FAILED" }, 500)
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}
