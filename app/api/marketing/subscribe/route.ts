import { NextResponse } from "next/server"
import { z } from "zod"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"

const bodySchema = z.object({
  email: z.string().email(),
  fullName: z.string().max(160).optional().nullable(),
  source: z.string().max(80).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  try {
    const result = await upsertMarketingSubscriber({
      email: parsed.data.email,
      fullName: parsed.data.fullName ?? null,
      source: parsed.data.source ?? "website",
      metadata: parsed.data.metadata,
    })
    return NextResponse.json({ success: true, email: result.email })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
