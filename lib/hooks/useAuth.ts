"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
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
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    isLoading: true,
  })

  useEffect(() => {
    const supabase = createClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void fetchProfile({
          id: session.user.id,
          email: session.user.email ?? null,
          user_metadata: (session.user as { user_metadata?: { full_name?: string | null } }).user_metadata,
        })
      } else {
        setState({ user: null, profile: null, isLoading: false })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(user: SessionUserLite) {
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
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign("/")
  }

  return { ...state, signOut }
}
