import { NextRequest } from "next/server"
import { handleApplicationXRayRoute } from "./handler"

export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApplicationXRayRoute(request, context)
}
