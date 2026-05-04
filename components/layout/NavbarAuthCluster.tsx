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

  if (isAuthed === true) {
    return (
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] transition-colors hover:bg-primary-hover"
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
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
      >
        <LogIn className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        <span className="hidden sm:inline">Login</span>
      </Link>
      <Link
        href="/signup"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] transition-colors hover:bg-primary-hover"
      >
        <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
        Sign up
      </Link>
    </>
  )
}
