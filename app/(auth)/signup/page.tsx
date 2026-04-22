"use client"

import { FormEvent, Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { createClient } from "@/lib/supabase/client"
import { PLAN_DATA, type BillingInterval, type PlanKey } from "@/lib/pricing"

function getPublicAppOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return (configured || window.location.origin).replace(/\/$/, "")
}

function sanitizeNextPath(next: string | null) {
  if (!next) return null
  if (!next.startsWith("/") || next.startsWith("//")) return null
  return next
}

// ─── Post-signup plan step ────────────────────────────────────────────────────

function PostSignupPlanStep({ plan, interval }: { plan: PlanKey; interval: BillingInterval }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = PLAN_DATA[plan]

  async function handleContinue() {
    setLoading(true)
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    })
    const json = await res.json()
    if (json.url) {
      window.location.href = json.url
    } else {
      setError(json.error ?? "Could not start checkout. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="mb-10 inline-flex items-center">
        <HireovenLogo className="h-10 w-auto" priority />
      </Link>

      <div className="rounded-[20px] border border-slate-200/80 bg-white p-7 shadow-[0_8px_28px_rgba(15,23,42,0.08)]">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[#0369A1]/10">
          <span className="text-lg">🎉</span>
        </div>
        <h1 className="mt-3 text-xl font-bold text-slate-900">One more step</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Complete your account to start your{" "}
          <span className="font-semibold text-slate-700">{data.name}</span> trial.
        </p>

        <div className="my-5 rounded-[14px] border border-[#0369A1]/20 bg-[#F0FDFA]/60 px-4 py-3.5">
          <p className="text-sm font-semibold text-slate-800">7-day free trial</p>
          <p className="mt-0.5 text-xs text-slate-500">
            ${interval === "yearly" ? data.yearly : data.monthly}/mo after trial •{" "}
            {interval === "yearly"
              ? `Billed $${(data as any).yearlyBilled}/year`
              : "Billed monthly"}{" "}
            • Cancel anytime
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={loading}
          className="w-full rounded-xl bg-[#0369A1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:opacity-60"
        >
          {loading ? "Loading…" : "Continue to payment"}
        </button>

        <Link
          href="/dashboard/onboarding"
          className="mt-3 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-medium text-slate-500 transition hover:bg-slate-50"
        >
          Skip for now - stay on Free
        </Link>
      </div>
    </div>
  )
}

// ─── Main signup form ─────────────────────────────────────────────────────────

function SignupForm() {
  const searchParams = useSearchParams()
  const planParam = searchParams.get("plan") as PlanKey | null
  const rawIntervalParam = searchParams.get("interval")
  const intervalParam: BillingInterval =
    rawIntervalParam === "yearly" ? "yearly" : "monthly"
  const nextParam = sanitizeNextPath(searchParams.get("next")) ?? "/dashboard/onboarding"

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [signedUp, setSignedUp] = useState(false)

  const validPlan =
    planParam && planParam !== "free" && Object.keys(PLAN_DATA).includes(planParam)
      ? planParam
      : null

  async function handleSignup(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      await (supabase.from("profiles") as any).upsert({
        id: data.user.id,
        email,
        full_name: fullName,
      })
    }

    if (validPlan) {
      setSignedUp(true)
      setLoading(false)
    } else {
      window.location.assign(nextParam)
    }
  }

  async function handleGoogleSignup() {
    setOauthLoading(true)
    setError(null)

    const supabase = createClient()
    const next = validPlan
      ? `/dashboard/upgrade?plan=${validPlan}&interval=${intervalParam}&checkout=1`
      : nextParam

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${getPublicAppOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    if (error) {
      setError(error.message)
      setOauthLoading(false)
    }
  }

  if (signedUp && validPlan) {
    return <PostSignupPlanStep plan={validPlan} interval={intervalParam} />
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="mb-10 inline-flex items-center">
        <HireovenLogo className="h-10 w-auto" priority />
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h1>
      <p className="text-sm text-gray-500 mb-8">
        {validPlan
          ? `Start your 7-day ${PLAN_DATA[validPlan].name} trial`
          : "See new jobs within minutes of posting"}
      </p>

      <button
        type="button"
        onClick={handleGoogleSignup}
        disabled={oauthLoading || loading}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 mb-6"
      >
        {oauthLoading ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-gray-50 text-xs text-gray-400">or sign up with email</span>
        </div>
      </div>

      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label htmlFor="full-name" className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
          <input
            id="full-name" type="text" autoComplete="name" required
            value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="Alex Johnson"
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <input
            id="password" type="password" autoComplete="new-password" required minLength={8}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">
            <ErrorIcon />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit" disabled={loading || oauthLoading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? <><Spinner /> Creating account…</> : "Create account"}
        </button>

        <p className="text-xs text-gray-400 text-center leading-relaxed">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="text-gray-500 hover:underline">Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-gray-500 hover:underline">Privacy Policy</Link>.
        </p>
      </form>

      <p className="text-sm text-gray-500 mt-6 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-[#0369A1] font-medium hover:underline">Sign in</Link>
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <Suspense>
        <SignupForm />
      </Suspense>
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
