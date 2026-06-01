"use client"

import { FormEvent, useMemo, useState } from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { AuthPageShell } from "@/components/auth/AuthPageShell"
import HireovenLogo from "@/components/ui/HireovenLogo"

export default function ResetPasswordPageClient({
  initialToken,
}: {
  initialToken: string | null
}) {
  const token = initialToken

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(false)

  const isPasswordStrongEnough = useMemo(() => password.length >= 8, [password])
  const hasToken = Boolean(token?.trim())

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!hasToken) {
      setError("Missing reset token. Open the link from your email again.")
      return
    }

    if (!isPasswordStrongEnough) {
      setError("Password must be at least 8 characters.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token!.trim(), password }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }

    if (!res.ok) {
      setError(body.error ?? "Could not reset password.")
      setLoading(false)
      return
    }

    setUpdated(true)
    setLoading(false)
  }

  return (
    <AuthPageShell>
      <Link href="/" className="mb-8 inline-flex items-center">
        <HireovenLogo className="h-10 w-auto" priority />
      </Link>

      <h1 className="mb-1 text-2xl font-bold text-strong">Set a new password</h1>
      <p className="mb-8 text-sm text-muted-foreground">Choose a strong password to secure your account.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
            New password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="w-full pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-slate-400 transition hover:text-slate-700"
              aria-label={showPassword ? "Hide new password" : "Show new password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-foreground">
            Confirm password
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat password"
              className="w-full pr-11"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((current) => !current)}
              className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-slate-400 transition hover:text-slate-700"
              aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        {!hasToken && !updated && (
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            This page needs a valid reset link. Request a new reset email from the sign-in page.
          </p>
        )}

        {updated && (
          <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Password updated successfully. You can now sign in.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !hasToken}
          className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? "Updating..." : "Update password"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthPageShell>
  )
}
