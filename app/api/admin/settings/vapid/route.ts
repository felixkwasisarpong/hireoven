import { NextResponse } from "next/server"
import webpush from "web-push"
import { assertAdminAccess } from "@/lib/admin/auth"

export async function POST() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const keys = webpush.generateVAPIDKeys()
  return NextResponse.json(keys)
}
