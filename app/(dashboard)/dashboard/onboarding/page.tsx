import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import OnboardingPageClient from "./OnboardingPageClient"

export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  // Skip onboarding for users who've already set their preferences — otherwise
  // routing returning users here (e.g. Google sign-in) would trap them in the
  // wizard on every login. New users (no desired_roles) still see it.
  let alreadyOnboarded = false
  if (hasPostgresEnv()) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      try {
        const { rows } = await getPostgresPool().query<{ n: number }>(
          `SELECT COALESCE(array_length(desired_roles, 1), 0) AS n FROM profiles WHERE id = $1`,
          [user.id],
        )
        alreadyOnboarded = (rows[0]?.n ?? 0) > 0
      } catch {
        // If the check fails, fall through and show onboarding.
      }
    }
  }
  // redirect() throws NEXT_REDIRECT — must be outside the try/catch above.
  if (alreadyOnboarded) redirect("/dashboard")

  return <OnboardingPageClient />
}
