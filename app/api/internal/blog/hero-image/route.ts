import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { ensureHeroImageForPost } from "@/lib/blog/hero-image"

/**
 * Generate and store a blog post's hero image.
 *
 * Deliberately NOT under `/api/cron` — middleware answers that prefix with a 409
 * on the web runtime, and this endpoint exists precisely so work can happen on
 * the web app. Scheduled generation runs on the app-worker, which has no route
 * to MinIO; it calls here so the storing happens in the one process that does.
 * Bearer-authenticated with CRON_SECRET, the same shared secret the worker
 * already holds.
 */
export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let postId: string
  try {
    const body = (await request.json()) as { postId?: unknown }
    if (typeof body.postId !== "string" || !body.postId.trim()) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 })
    }
    postId = body.postId.trim()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const outcome = await ensureHeroImageForPost(postId)
    return NextResponse.json({ ok: true, ...outcome })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[internal/blog/hero-image] failed", { postId, message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
