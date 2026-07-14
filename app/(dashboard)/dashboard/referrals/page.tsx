import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session-user"
import ReferralsPageClient from "./ReferralsPageClient"

export const dynamic = "force-dynamic"
export const metadata = { title: "Refer a Friend — Hireoven" }

export default async function ReferralsPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/dashboard/referrals")
  return <ReferralsPageClient />
}
