"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AuthPageShell } from "@/components/auth/AuthPageShell"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { createClient } from "@/lib/supabase/client"

function sanitizeNextPath(next: string | null) {
  if (!next) return null
  if (!next.startsWith("/") || next.startsWith("//")) return null
  return next
}

export default function LoginPage() {
  const searchParams = useSearchParams()
  const explicitNext = sanitizeNextPath(searchParams.get("next"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(
    searchParams.get("error") ?? null
  )
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  async function ensureProfileRow(user: {
    id: string
    email?: string | null
    user_metadata?: { full_name?: string | null }
  }) {
    await fetch("/api/profile", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email ?? null,
        full_name: user.user_metadata?.full_name ?? null,
      }),
    })
  }

  async function getPostLoginDestination() {
    if (explicitNext) return explicitNext

    const res = await fetch("/api/profile", { credentials: "include", cache: "no-store" })
    if (res.ok) {
      const { profile } = (await res.json()) as { profile: { is_admin?: boolean } | null }
      return profile?.is_admin ? "/admin" : "/dashboard"
    }
    return "/dashboard"
  }

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Incorrect email or password. Please try again."
          : error.message
      )
      setLoading(false)
      return
    }

    if (data.user) {
      await ensureProfileRow(data.user)
      const destination = await getPostLoginDestination()
      window.location.assign(destination)
      return
    }
    window.location.assign("/dashboard")
  }

  async function handleGoogleLogin() {
    setOauthLoading(true)
    setError(null)

    const providersRes = await fetch("/api/auth/providers", { cache: "no-store" })
    const providers = providersRes.ok ? ((await providersRes.json()) as { google?: boolean }) : { google: false }
    if (!providers.google) {
      setError("Google sign-in is not configured on this server.")
      setOauthLoading(false)
      return
    }

    const next =
      explicitNext ??
      (await (async () => {
        const res = await fetch("/api/profile", { credentials: "include", cache: "no-store" })
        if (res.ok) {
          const { profile } = (await res.json()) as { profile: { is_admin?: boolean } | null }
          return profile?.is_admin ? "/admin" : "/dashboard"
        }
        return "/dashboard"
      })())

    window.location.assign(
      `/api/auth/google?next=${encodeURIComponent(next)}`
    )
  }

  return (
    <AuthPageShell>
      <Link href="/" className="mb-8 inline-flex items-center">
        <HireovenLogo className="h-10 w-auto" priority />
      </Link>

      <h1 className="mb-1 text-2xl font-bold text-strong">Welcome back</h1>
      <p className="mb-8 text-sm text-muted-foreground">Sign in to your account</p>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={oauthLoading || loading}
        className="mb-6 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-surface/90 px-4 py-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-surface-alt disabled:opacity-60"
      >
        {oauthLoading ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs text-muted-foreground">
          <span className="rounded-md bg-surface/95 px-3 py-0.5 backdrop-blur-sm">
            or continue with email
          </span>
        </div>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            <ErrorIcon />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || oauthLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? (
            <>
              <Spinner /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Sign up free
        </Link>
      </p>
    </AuthPageShell>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}
