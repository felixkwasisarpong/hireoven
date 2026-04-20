import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getSupportFromEmail } from "@/lib/email/identity"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  return NextResponse.json({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    resendFromName: process.env.RESEND_FROM_NAME ?? "Hireoven",
    resendFromEmail: getSupportFromEmail(),
    adminEmail: access.profile.email ?? "",
  })
}
