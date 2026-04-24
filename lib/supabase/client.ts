"use client"

export type BrowserSessionUser = { id: string; email: string | null }

export async function fetchSessionUser(): Promise<BrowserSessionUser | null> {
  const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
  if (!res.ok) return null
  const body = (await res.json()) as { user: BrowserSessionUser | null }
  return body.user ?? null
}

/**
 * Minimal client used by legacy call sites. Auth is cookie + `/api/auth/*` (no Supabase).
 */
export function createClient() {
  return {
    auth: {
      getUser: async () => {
        const user = await fetchSessionUser()
        return {
          data: {
            user: user
              ? {
                  id: user.id,
                  email: user.email ?? undefined,
                  app_metadata: {},
                  user_metadata: {},
                  aud: "authenticated",
                }
              : null,
          },
        }
      },
      getSession: async () => {
        const user = await fetchSessionUser()
        return {
          data: {
            session: user
              ? { user: { id: user.id, email: user.email, aud: "authenticated" }, access_token: "" }
              : null,
          },
        }
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          return {
            data: { user: null, session: null },
            error: { message: body.error ?? "Login failed" },
          }
        }
        const user = await fetchSessionUser()
        return { data: { user, session: user ? {} : null }, error: null }
      },
      signUp: async ({
        email,
        password,
        options,
      }: {
        email: string
        password: string
        options?: { data?: { full_name?: string } }
      }) => {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email,
            password,
            full_name: options?.data?.full_name,
          }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          return {
            data: { user: null, session: null },
            error: { message: body.error ?? "Signup failed" },
          }
        }
        const user = await fetchSessionUser()
        return { data: { user, session: user ? {} : null }, error: null }
      },
      signInWithOAuth: async () => ({
        error: { message: "Use Google redirect via /api/auth/google" },
      }),
      signOut: async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
        return { error: null }
      },
      onAuthStateChange: (
        cb: (event: string, session: { user: { id: string; email?: string | null } } | null) => void
      ) => {
        void fetchSessionUser().then((u) =>
          cb(
            "INITIAL_SESSION",
            u ? { user: { id: u.id, email: u.email } } : null
          )
        )
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      resetPasswordForEmail: async (email: string, _options?: { redirectTo?: string }) => {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        })
        return { error: res.ok ? null : { message: "Request failed" } }
      },
      updateUser: async (_args: { password?: string }) => ({
        error: { message: "Use /api/auth/reset-password with a token from email" },
      }),
    },
  } as const
}
