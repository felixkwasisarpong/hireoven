"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { fetchSessionUser } from "@/lib/supabase/client"
import type { Profile } from "@/types"

type SessionUserLite = {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null }
}

interface AuthState {
  user: SessionUserLite | null
  profile: Profile | null
  isLoading: boolean
  signOut: () => Promise<void>
  refetchProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "signOut" | "refetchProfile">>({
    user: null,
    profile: null,
    isLoading: true,
  })

  // Track the last known user id so visibility re-checks only re-fetch the profile
  // when the session identity actually changes (avoids redundant profile fetches).
  const lastUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback(async (user: SessionUserLite) => {
    try {
      const res = await fetch("/api/profile", { credentials: "include", cache: "no-store" })
      if (res.ok) {
        const { profile } = (await res.json()) as { profile: Profile | null }
        if (profile) {
          setState({ user, profile, isLoading: false })
          return
        }
      }

      const upsertRes = await fetch("/api/profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email ?? null,
          full_name: user.user_metadata?.full_name ?? null,
          avatar_url: (user.user_metadata as { avatar_url?: string | null } | undefined)?.avatar_url ?? null,
        }),
      })
      if (upsertRes.ok) {
        const { profile: fresh } = (await upsertRes.json()) as { profile: Profile | null }
        setState({ user, profile: fresh ?? null, isLoading: false })
      } else {
        setState({ user, profile: null, isLoading: false })
      }
    } catch {
      setState({ user, profile: null, isLoading: false })
    }
  }, [])

  // Check the session and update state. Called on mount and on tab focus return.
  const checkSession = useCallback(async () => {
    try {
      const sessionUser = await fetchSessionUser()
      if (sessionUser) {
        const userId = sessionUser.id
        // Only refetch profile when the user identity changes.
        if (userId !== lastUserIdRef.current) {
          lastUserIdRef.current = userId
          await fetchProfile({
            id: userId,
            email: sessionUser.email ?? null,
          })
        } else {
          // Same user still active — just make sure isLoading is cleared.
          setState((prev) => prev.isLoading ? { ...prev, isLoading: false } : prev)
        }
      } else {
        lastUserIdRef.current = null
        setState({ user: null, profile: null, isLoading: false })
      }
    } catch {
      lastUserIdRef.current = null
      setState({ user: null, profile: null, isLoading: false })
    }
  }, [fetchProfile])

  // Initial session check on mount.
  useEffect(() => {
    void checkSession()
  }, [checkSession])

  // Re-check session whenever the user returns to the tab (visibility change)
  // or the window regains focus. This ensures a user who logged in on another
  // tab — or whose cookie was refreshed — sees the correct auth state immediately.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void checkSession()
    }
    function onFocus() {
      void checkSession()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocus)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onFocus)
    }
  }, [checkSession])

  // Slide the session: ask the server to renew the cookie if it's within 7 days
  // of expiry. Called once per mount — the server only issues a new cookie when
  // renewal is actually needed, so this is a cheap no-op most of the time.
  useEffect(() => {
    void fetch("/api/auth/refresh", { method: "POST", credentials: "include" }).catch(() => {})
  }, [])

  const refetchProfile = useCallback(async () => {
    const sessionUser = await fetchSessionUser()
    if (!sessionUser) return
    await fetchProfile({
      id: sessionUser.id,
      email: sessionUser.email ?? null,
    })
  }, [fetchProfile])

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    lastUserIdRef.current = null
    window.location.assign("/")
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut, refetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
