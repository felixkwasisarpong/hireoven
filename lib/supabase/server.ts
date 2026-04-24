import { getSessionUser } from "@/lib/auth/session-user"

type ShimUser = {
  id: string
  email?: string | null
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  aud?: string
}

/**
 * Legacy shape used across API routes: `const supabase = await createClient(); await supabase.auth.getUser()`.
 * Backed by Postgres session cookie (no Supabase).
 */
export async function createClient() {
  const session = await getSessionUser()
  const user: ShimUser | null = session
    ? {
        id: session.sub,
        email: session.email ?? undefined,
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
      }
    : null

  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      getSession: async () => ({
        data: { session: user ? { user, access_token: "", expires_at: 0 } : null },
      }),
    },
  }
}
