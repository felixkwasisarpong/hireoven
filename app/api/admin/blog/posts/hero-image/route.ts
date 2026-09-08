import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { assertAdminAccess } from "@/lib/admin/auth"
import { attachHeroImage } from "@/lib/blog/hero-image"

export const runtime = "nodejs"
export const maxDuration = 300

const schema = z.object({
  id: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  await assertAdminAccess()
  const body = schema.parse(await request.json())

  try {
    const outcome = await attachHeroImage(body.id)
    if (outcome.status === "not_configured") {
      return NextResponse.json(
        { ok: false, error: "Blog image generation is not configured." },
        { status: 409 },
      )
    }

    return NextResponse.json({ ok: true, ...outcome })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[admin/blog/posts/hero-image] failed", { postId: body.id, message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
