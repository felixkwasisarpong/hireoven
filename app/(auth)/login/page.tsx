"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
  const searchParams = useSearchParams()
  const explicitNext = searchParams.get("next")

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
    const supabase = createClient()
    await ((supabase.from("profiles") as any).upsert({
      id: user.id,
      email: user.email ?? null,
      full_name: user.user_metadata?.full_name ?? null,
    }))
  }

  async function getPostLoginDestination(userId: string) {
    if (explicitNext) return explicitNext

    const supabase = createClient()
    const { data: profile } = await ((supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single()) as any)

    return profile?.is_admin ? "/admin" : "/dashboard"
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
      const destination = await getPostLoginDestination(data.user.id)
      window.location.assign(destination)
      return
    }
    window.location.assign("/dashboard")
  }

  async function handleGoogleLogin() {
    setOauthLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${explicitNext ? `?next=${encodeURIComponent(explicitNext)}` : ""}`,
      },
    })

    if (error) {
      setError(error.message)
      setOauthLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="mb-10 inline-flex items-center">
          <HireovenLogo className="h-10 w-auto" priority />
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
        <p className="text-sm text-gray-500 mb-8">Sign in to your account</p>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={oauthLoading || loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 mb-6"
        >
          {oauthLoading ? (
            <Spinner />
          ) : (
            <GoogleIcon />
          )}
          Continue with Google
        </button>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 bg-gray-50 text-xs text-gray-400">or continue with email</span>
          </div>
        </div>

        {/* Email/password form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
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
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm transition-shadow"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <Link href="/forgot-password" className="text-xs text-[#0369A1] hover:underline">
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
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm transition-shadow"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">
              <ErrorIcon />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || oauthLoading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? <><Spinner /> Signing in…</> : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[#0369A1] font-medium hover:underline">
            Sign up free
          </Link>
        </p>
      </div>
    </main>
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
