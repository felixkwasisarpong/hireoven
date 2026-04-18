"use client"

import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import type { Profile } from "@/types"

interface AuthState {
  user: User | null
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

    // Listen for auth changes (INITIAL_SESSION fires immediately without lock contention)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchProfile(session.user)
      } else {
        setState({ user: null, profile: null, isLoading: false })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(user: User) {
    const supabase = createClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()

    if (profile) {
      setState({ user, profile, isLoading: false })
      return
    }

    const fallbackProfile = {
      id: user.id,
      email: user.email ?? null,
      full_name: user.user_metadata?.full_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    }

    await ((supabase.from("profiles") as any).upsert(fallbackProfile))

    const { data: freshProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()

    setState({ user, profile: freshProfile ?? null, isLoading: false })
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: "local" })
    window.location.assign("/")
  }

  return { ...state, signOut }
}
