import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { generateTodaysBlogPost } from "@/lib/blog/generate-worker"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST() {
  await assertAdminAccess()

  const result = await generateTodaysBlogPost()

  if (!result) {
    return NextResponse.json({ ok: true, skipped: true, message: "No post scheduled today (weekend)" })
  }

  if (result.skippedExisting) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "existing_post",
      postId: result.postId,
      title: result.title,
      imageGenerated: result.imageGenerated,
      imageError: result.imageError,
      message: `Blog post already exists for today: "${result.title}" in ${result.categorySlug}`,
    })
  }

  return NextResponse.json({
    ok: true,
    postId: result.postId,
    title: result.title,
    imageGenerated: result.imageGenerated,
    imageError: result.imageError,
    message: `Draft created: "${result.title}" in ${result.categorySlug}`,
  })
}
