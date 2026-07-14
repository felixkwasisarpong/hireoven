import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { generateTodaysBlogPost } from "@/lib/blog/generate-worker"

export const runtime = "nodejs"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await generateTodaysBlogPost()

    if (!result) {
      return NextResponse.json({ ok: true, skipped: true, message: "No blog post scheduled today (weekend)" })
    }

    return NextResponse.json({
      ok: true,
      postId: result.postId,
      category: result.categorySlug,
      title: result.title,
      imageGenerated: result.imageGenerated,
      durationMs: result.durationMs,
      message: `Draft created: "${result.title}" in ${result.categorySlug} (${result.durationMs}ms)`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
