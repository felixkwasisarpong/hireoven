"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LayoutDashboard, LogIn, UserPlus } from "lucide-react"
import { fetchSessionUser } from "@/lib/supabase/client"

/**
 * Auth-dependent slice of the Navbar. Fetches the session client-side via
 * /api/auth/session so the rest of Navbar can stay a sync server component
 * (importable from both server and client pages).
 *
 * SSR renders the unauth state by default. After hydration, swaps to the
 * Dashboard link if the user has a valid ho_session cookie. Brief flicker
 * for logged-in users on the first paint is acceptable; auth-aware UI on
 * a public marketing nav doesn't need pixel-perfect SSR fidelity.
 */
export default function NavbarAuthCluster() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSessionUser()
      .then((u) => {
        if (!cancelled) setIsAuthed(Boolean(u?.id))
      })
      .catch(() => {
        if (!cancelled) setIsAuthed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // While the session check is in flight, render a placeholder that matches the
  // width of the auth buttons so the layout doesn't jump. Never show Login/Signup
  // until we know the user is definitely not authenticated.
  if (isAuthed === null) {
    return <div className="h-9 w-24 animate-pulse rounded-full bg-[rgba(255,92,24,0.18)]" aria-hidden />
  }

  if (isAuthed === true) {
    return (
      <Link
        href="/dashboard"
        prefetch
        className="marketing-auth-primary"
      >
        <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
        Dashboard
      </Link>
    )
  }

  return (
    <>
      <Link
        href="/login"
        prefetch
        className="marketing-auth-login"
      >
        <LogIn className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        <span className="hidden sm:inline">Login</span>
      </Link>
      <Link
        href="/signup"
        prefetch
        className="marketing-auth-primary"
      >
        <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
        Sign up
      </Link>
    </>
  )
}
