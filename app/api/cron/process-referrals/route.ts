/**
 * GET /api/cron/process-referrals
 *
 * Finds pending referrals where:
 *  - the referee's trial has already been granted (signed up via referral link)
 *  - the referral is at least 7 days old (anti-throwaway)
 *
 * Then grants the referrer their 14-day Pro reward (capped at 3 per referrer).
 * Run daily on the harvester box.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { processPendingReferrals } from "@/lib/referral/rewards"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const processed = await processPendingReferrals(pool)

  return NextResponse.json({ ok: true, processed })
}
