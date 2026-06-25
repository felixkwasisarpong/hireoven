import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getUserEmailPreferences } from "@/lib/email/preferences"
import { getPostgresPool } from "@/lib/postgres/server"
import { EmailPreferencesClient } from "@/components/email/EmailPreferencesClient"
import { SubscribeDigestBanner } from "@/components/email/SubscribeDigestBanner"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Email preferences — Hireoven",
}

export default async function EmailPreferencesPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/dashboard/email-preferences")

  const prefs = await getUserEmailPreferences(user.sub)
  const { rows: watched } = await getPostgresPool().query<{ company_id: string; name: string }>(
    `SELECT w.company_id::text, c.name FROM watchlist w JOIN companies c ON c.id = w.company_id
     WHERE w.user_id = $1 ORDER BY c.name LIMIT 200`,
    [user.sub]
  )

  return (
    <div className="min-h-full bg-[#f4f6f9]">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Email preferences</h1>
        <p className="mt-1 text-sm text-slate-500">Changes save automatically.</p>
        <SubscribeDigestBanner className="mt-5" />
        <EmailPreferencesClient initialPrefs={prefs} watched={watched} />
      </main>
    </div>
  )
}
