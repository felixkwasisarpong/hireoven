import { NextResponse } from "next/server"
import { z } from "zod"
import { getSessionUser } from "@/lib/auth/session-user"
import { setPersonalShare } from "@/lib/scorecard/personal-scorecard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BodySchema = z.object({
  make_public: z.boolean(),
  display_name: z.string().max(80).optional(),
  consented: z.boolean().optional(),
})

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", code: "VALIDATION_ERROR" }, { status: 400 })
  }

  try {
    const result = await setPersonalShare(user.sub, parsed.data)
    if (!result.ok) {
      const status = result.error === "consent_required" ? 403 : 400
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error("[scorecard:personal:share]", err)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
