"use client"

import { type FormEvent, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import HireovenLogo from "@/components/ui/HireovenLogo"

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
  waitlist:             "We're invite-only right now. Join the waitlist below and we'll send you an invite when there's room.",
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

const WAITLIST_MODE = process.env.NEXT_PUBLIC_WAITLIST_MODE === "true"

export function AuthForm({ defaultMode = "login" }: Props) {
  const searchParams = useSearchParams()
  const next = sanitizeNext(searchParams.get("next"))
  const emailFromQuery = searchParams.get("email")?.trim() ?? ""
  const inviteToken = searchParams.get("invite")?.trim() || null
  // Hide Google sign-in entirely while the waitlist is active — including for
  // invitees — so signups go through the password flow and we get a captured
  // email even when Google's OAuth profile diverges.
  const showGoogle = !WAITLIST_MODE

  // If arriving via invite link, lock to signup mode
  const [mode, setMode] = useState<AuthMode>(inviteToken ? "signup" : defaultMode)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState(emailFromQuery)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [inviteResolved, setInviteResolved] = useState(false)
  const isReferral = searchParams.get("ref") === "1"
  const [error, setError] = useState<string | null>(() => {
    const raw = searchParams.get("error")
    if (!raw) return null
    return OAUTH_ERRORS[raw] ?? "Something went wrong. Please try again."
  })

  useEffect(() => {
    if (!emailFromQuery || inviteToken) return
    setEmail(emailFromQuery)
  }, [emailFromQuery, inviteToken])

  // Resolve invite token → pre-fill email
  useEffect(() => {
    if (!inviteToken) return
    fetch(`/api/auth/invite-info?token=${encodeURIComponent(inviteToken)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { email?: string } | null) => {
        if (d?.email) setEmail(d.email)
        setInviteResolved(true)
      })
      .catch(() => setInviteResolved(true))
  }, [inviteToken])

  async function claimReferralIfPresent() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)hireoven_ref=([^;]+)/)
      const code = match?.[1]
      if (!code) return
      await fetch("/api/referral/claim", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      // Clear cookie regardless of response
      document.cookie = "hireoven_ref=; Path=/; Max-Age=0; SameSite=Lax"
    } catch {
      // Best-effort — never block signup
    }
  }

  function switchMode(m: AuthMode) {
    if (inviteToken) return // locked to signup when arriving via invite link
    setMode(m)
    setError(null)
    setPassword("")
    setShowPassword(false)
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

    // Read DOM values at submit so autofill / password managers that set
    // element.value without firing a React synthetic change event still work.
    const form = e.currentTarget as HTMLFormElement
    const emailVal = (form.elements.namedItem("email") as HTMLInputElement | null)?.value?.trim() || email
    const passwordVal = (form.elements.namedItem("password") as HTMLInputElement | null)?.value || password

    const supabase = createClient()

    if (mode === "login") {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: emailVal, password: passwordVal })
      if (err) {
        setError(err.message === "Invalid login credentials"
          ? "Incorrect email or password."
          : err.message)
        setLoading(false)
        return
      }
      if (data.user) {
        await fetch("/api/profile", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: data.user.email ?? null, full_name: null }),
        })
      }
      window.location.assign(next ?? "/dashboard")
    } else {
      if (passwordVal.length < 8) {
        setError("Password must be at least 8 characters.")
        setLoading(false)
        return
      }
      // Call signup directly so we can pass inviteToken
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal, password: passwordVal, full_name: fullName, inviteToken }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
      if (!res.ok) {
        if (body.code === "INVITE_REQUIRED" || body.code === "INVALID_INVITE") {
          setError("A valid invite is required to sign up. Join the waitlist to get access.")
        } else if (body.code === "INVITE_USED") {
          setError("This invite has already been used. Try signing in instead.")
        } else if (body.code === "INVITE_EMAIL_MISMATCH") {
          setError("This invite is for a different email address.")
        } else {
          setError(body.error ?? "Signup failed. Please try again.")
        }
        setLoading(false)
        return
      }
      await fetch("/api/profile", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal, full_name: fullName }),
      })
      await claimReferralIfPresent()
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

        {/* Logo — icon in native colors + white wordmark text */}
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-3">
            <HireovenLogo variant="mark" priority className="h-12 w-12 shrink-0" />
            <HireovenLogo variant="wordmark" priority className="h-8 w-auto brightness-0 invert" />
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
        <Link href="/" className="mb-8 lg:hidden">
          <HireovenLogo variant="header" priority className="h-11 w-auto" />
        </Link>

        <div className="w-full max-w-[400px]">

          {/* Referral welcome banner */}
          {isReferral && !inviteToken && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
              <span className="mt-0.5 text-lg">🎁</span>
              <div>
                <p className="text-[13px] font-bold text-orange-800">You got 7 days of Pro free!</p>
                <p className="text-[12px] text-orange-700 leading-relaxed">
                  A friend invited you. Create your account to claim your free Pro trial.
                </p>
              </div>
            </div>
          )}

          {/* Invite banner — shown when arriving via invite link */}
          {inviteToken && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="mt-0.5 text-lg">🎉</span>
              <div>
                <p className="text-[13px] font-bold text-emerald-800">You're invited!</p>
                <p className="text-[12px] text-emerald-700 leading-relaxed">
                  Your spot has been approved. Create your account below to get started.
                </p>
              </div>
            </div>
          )}

          {/* Tab switcher — hidden when locked to invite signup */}
          {!inviteToken && (
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
          )}

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-xl font-bold text-slate-900">
              {inviteToken ? "Create your account" : isLogin ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {inviteToken ? "You're on the list — fill in your details to get in." : isLogin ? "Sign in to continue to your dashboard." : "Start finding great jobs in minutes."}
            </p>
          </div>

          {/* Google button */}
          {showGoogle && (
            <>
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
            </>
          )}

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
                name="email"
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
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={isLogin ? undefined : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isLogin ? "••••••••" : "Min. 8 characters"}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-0 transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-slate-400 transition hover:text-slate-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
