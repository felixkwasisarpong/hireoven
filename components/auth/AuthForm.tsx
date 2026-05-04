"use client"

import { type FormEvent, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthMode = "login" | "signup"

type Props = {
  defaultMode?: AuthMode
}

// ── OAuth error map ───────────────────────────────────────────────────────────

const OAUTH_ERRORS: Record<string, string> = {
  oauth_token:          "Google sign-in failed. Please try again.",
  userinfo:             "Couldn't retrieve your Google profile. Please try again.",
  no_email:             "Your Google account has no email address associated.",
  signup_failed:        "Account creation failed. Please try again.",
  oauth_not_configured: "Google sign-in is not available right now.",
  invalid_state:        "Sign-in session expired. Please try again.",
  missing_code:         "Google did not return an authorisation code.",
  access_denied:        "You declined Google sign-in.",
}

function sanitizeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null
  return next
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-600">
      <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
      </svg>
      <span>{message}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AuthForm({ defaultMode = "login" }: Props) {
  const searchParams = useSearchParams()
  const next = sanitizeNext(searchParams.get("next"))

  const [mode, setMode] = useState<AuthMode>(defaultMode)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(() => {
    const raw = searchParams.get("error")
    if (!raw) return null
    return OAUTH_ERRORS[raw] ?? "Something went wrong. Please try again."
  })

  function switchMode(m: AuthMode) {
    setMode(m)
    setError(null)
    setPassword("")
    window.history.replaceState(null, "", m === "login" ? "/login" : "/signup")
  }

  function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    window.location.assign(`/api/auth/google?next=${encodeURIComponent(next ?? "/dashboard")}`)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    if (mode === "login") {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        setError(err.message === "Invalid login credentials"
          ? "Incorrect email or password."
          : err.message)
        setLoading(false)
        return
      }
      if (data.user) {
        // Ensure profile row exists
        await fetch("/api/profile", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: data.user.email ?? null, full_name: null }),
        })
      }
      window.location.assign(next ?? "/dashboard")
    } else {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.")
        setLoading(false)
        return
      }
      const { data, error: err } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } },
      })
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      if (data.user) {
        await fetch("/api/profile", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, full_name: fullName }),
        })
      }
      window.location.assign(next ?? "/dashboard/onboarding")
    }
  }

  const isLogin = mode === "login"

  return (
    <div className="flex min-h-[100dvh] w-full">

      {/* ── Left brand panel ────────────────────────────────────────────── */}
      <div className="relative hidden lg:flex lg:w-[46%] xl:w-[42%] flex-col justify-between overflow-hidden p-10 xl:p-14"
        style={{
          background: "linear-gradient(145deg, #1a0a00 0%, #2d1200 30%, #1e0f2e 65%, #0e0820 100%)",
        }}
      >
        {/* Ambient glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-orange-600/20 blur-[100px]" />
          <div className="absolute top-1/3 -right-24 h-72 w-72 rounded-full bg-violet-600/15 blur-[80px]" />
          <div className="absolute -bottom-24 left-1/4 h-64 w-64 rounded-full bg-orange-500/10 blur-[80px]" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #FF5C18, #FF9A3C)" }}>
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <span className="text-lg font-bold text-white tracking-tight">Hireoven</span>
          </Link>
        </div>

        {/* Hero copy */}
        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight">
              Your next job,<br />
              <span style={{ background: "linear-gradient(90deg, #FF5C18, #FF9A3C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                found first.
              </span>
            </h2>
            <p className="mt-4 text-[15px] text-white/60 leading-relaxed max-w-xs">
              Real-time alerts from 10,000+ companies. AI that reads the room, applies smart, and keeps your pipeline moving.
            </p>
          </div>

          {/* Trust signals */}
          <div className="space-y-3">
            {[
              { icon: "⚡", text: "New jobs within minutes of posting" },
              { icon: "🎯", text: "AI match scores on every role" },
              { icon: "🛡️", text: "Ghost job & layoff risk detection" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <span className="text-base">{icon}</span>
                <span className="text-sm text-white/70">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom quote */}
        <div className="relative z-10">
          <blockquote className="border-l-2 border-orange-500/60 pl-4">
            <p className="text-sm text-white/50 italic leading-relaxed">
              &ldquo;Found my current role 3 days after signing up. The match score was spot on.&rdquo;
            </p>
            <footer className="mt-2 text-xs text-white/35">— Software Engineer, Series B startup</footer>
          </blockquote>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8">

        {/* Mobile logo */}
        <Link href="/" className="mb-8 inline-flex items-center gap-2 lg:hidden">
          <div className="h-7 w-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #FF5C18, #FF9A3C)" }}>
            <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <span className="text-base font-bold text-foreground">Hireoven</span>
        </Link>

        <div className="w-full max-w-[400px]">

          {/* Tab switcher */}
          <div className="mb-7 flex rounded-xl bg-slate-100/80 p-1 gap-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={[
                  "flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-150",
                  mode === m
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                    : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {m === "login" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-xl font-bold text-slate-900">
              {isLogin ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {isLogin ? "Sign in to continue to your dashboard." : "Start finding great jobs in minutes."}
            </p>
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="mb-5 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60"
          >
            {googleLoading ? <Spinner /> : <GoogleIcon />}
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-slate-400">or with email</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label htmlFor="full-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Full name
                </label>
                <input
                  id="full-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Johnson"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-0 transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
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
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-0 transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">
                  Password
                </label>
                {isLogin && (
                  <Link href="/forgot-password" className="text-xs text-[#FF5C18] hover:underline font-medium">
                    Forgot password?
                  </Link>
                )}
              </div>
              <input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                minLength={isLogin ? undefined : 8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? "••••••••" : "Min. 8 characters"}
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-0 transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15"
              />
            </div>

            {error && <ErrorBanner message={error} />}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
              style={{ background: loading || googleLoading ? "#e5530f" : "linear-gradient(135deg, #FF5C18 0%, #FF7A35 100%)" }}
            >
              {loading ? (
                <><Spinner />{isLogin ? "Signing in…" : "Creating account…"}</>
              ) : (
                isLogin ? "Sign in" : "Create account"
              )}
            </button>

            {!isLogin && (
              <p className="text-center text-xs text-slate-400 leading-relaxed">
                By signing up you agree to our{" "}
                <Link href="/terms" className="text-slate-600 hover:underline">Terms</Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-slate-600 hover:underline">Privacy Policy</Link>.
              </p>
            )}
          </form>

          {/* Switch mode link */}
          <p className="mt-6 text-center text-sm text-slate-500">
            {isLogin ? (
              <>No account?{" "}
                <button type="button" onClick={() => switchMode("signup")} className="font-semibold text-[#FF5C18] hover:underline">
                  Sign up free
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} className="font-semibold text-[#FF5C18] hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
