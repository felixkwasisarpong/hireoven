import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [companiesResult, jobsResult, crawlResult] = await Promise.all([
      supabase.from("companies").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("jobs").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase
        .from("crawl_logs")
        .select("crawled_at")
        .order("crawled_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (companiesResult.error || jobsResult.error) {
      return NextResponse.json(
        {
          status: "error",
          timestamp: new Date().toISOString(),
          database: "error",
          error: companiesResult.error?.message ?? jobsResult.error?.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      lastCrawl: crawlResult.data?.crawled_at ?? null,
      activeJobs: jobsResult.count ?? 0,
      activeCompanies: companiesResult.count ?? 0,
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
