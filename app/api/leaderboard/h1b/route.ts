import { NextResponse } from "next/server"
import { z } from "zod"
import { getH1bLeaderboard } from "@/lib/h1b/leaderboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const QuerySchema = z.object({
  sort: z.enum(["volume", "cert_rate"]).optional(),
  period: z.enum(["1y", "3y", "5y"]).optional(),
  industry: z.string().max(80).optional(),
  state: z.string().length(2).optional(),
  size: z.string().max(40).optional(),
  staffing_only: z.enum(["true", "false"]).optional(),
  exclude_staffing: z.enum(["true", "false"]).optional(),
  min_filings: z.coerce.number().int().min(1).max(100000).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const result = await getH1bLeaderboard({
      ...parsed.data,
      staffing_only: parsed.data.staffing_only === "true",
      exclude_staffing: parsed.data.exclude_staffing === "true",
    })
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    })
  } catch (err) {
    console.error("[leaderboard:h1b]", err)
    return NextResponse.json({ error: "internal_error", code: "INTERNAL" }, { status: 500 })
  }
}
