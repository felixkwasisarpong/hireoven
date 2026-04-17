import { NextRequest, NextResponse } from "next/server"
import type { Job } from "@/types"

export async function GET(_request: NextRequest) {
  // TODO: fetch jobs from Supabase, filter by user alerts
  const jobs: Job[] = []
  return NextResponse.json({ jobs })
}

export async function POST(request: NextRequest) {
  // TODO: insert a new job detected by the crawler
  const body = (await request.json()) as Partial<Job>
  return NextResponse.json({ success: true, job: body }, { status: 201 })
}
