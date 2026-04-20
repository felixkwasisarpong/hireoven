import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { Resend } from "resend"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getUserSubscriptions } from "@/lib/alerts/push-subscriptions"
import { getSupportFromEmail } from "@/lib/email/identity"
import { env } from "@/lib/env"

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json()) as { type: "email" | "push" }
  const profile = access.profile

  try {
    if (body.type === "email") {
      const resend = new Resend(process.env.RESEND_API_KEY)
      if (!profile.email) {
        return NextResponse.json({ error: "Admin email not found" }, { status: 400 })
      }

      const { error } = await resend.emails.send({
        from: getSupportFromEmail(),
        to: [profile.email],
        subject: "Hireoven admin test email",
        html: "<p>This is a test email from Hireoven admin.</p>",
      })

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY
    const email = env.VAPID_EMAIL
    if (!publicKey || !privateKey || !email) {
      return NextResponse.json({ error: "Missing VAPID configuration" }, { status: 400 })
    }

    webpush.setVapidDetails(email, publicKey, privateKey)
    const subscriptions = await getUserSubscriptions(profile.id)
    if (!subscriptions.length) {
      return NextResponse.json(
        { error: "No push subscriptions found for this admin user" },
        { status: 400 }
      )
    }

    await Promise.all(
      subscriptions.map((subscription) =>
        webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: "Hireoven admin test",
            body: "Push notifications are configured correctly.",
            icon: "/icon-192.png",
            badge: "/badge-72.png",
            data: { jobId: "admin-test", applyUrl: "/admin/settings" },
            actions: [{ action: "dismiss", title: "Dismiss" }],
          })
        )
      )
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
