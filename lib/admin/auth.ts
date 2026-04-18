import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/types"

type AdminProfile = Pick<
  Profile,
  "id" | "email" | "full_name" | "avatar_url" | "is_admin"
>

export async function getAdminProfile(): Promise<AdminProfile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await ((supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, is_admin")
    .eq("id", user.id)
    .single()) as any)

  return (profile as AdminProfile | null) ?? null
}

export async function requireAdminProfile(options?: { redirectTo?: string }) {
  const profile = await getAdminProfile()

  if (!profile?.is_admin) {
    redirect(options?.redirectTo ?? "/dashboard?toast=access-denied")
  }

  return profile
}

export async function assertAdminAccess() {
  const profile = await getAdminProfile()

  if (!profile) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized",
    }
  }

  if (!profile.is_admin) {
    return {
      ok: false as const,
      status: 403,
      error: "Forbidden",
    }
  }

  return {
    ok: true as const,
    profile,
  }
}
