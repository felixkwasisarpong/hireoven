import { NextRequest, NextResponse } from "next/server"
import type { JobAlert, JobAlertInsert } from "@/types"

export async function GET(_request: NextRequest) {
  // TODO: fetch alerts for the authenticated user from Supabase
  const alerts: JobAlert[] = []
  return NextResponse.json({ alerts })
}

export async function POST(request: NextRequest) {
  // TODO: create a new alert for the authenticated user
  const body = (await request.json()) as Partial<JobAlertInsert>
  return NextResponse.json({ success: true, alert: body }, { status: 201 })
}
