"use client"

import { FormEvent, useMemo, useState } from "react"
import { useEffect } from "react"
import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasRecoverySession, setHasRecoverySession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(false)

  const isPasswordStrongEnough = useMemo(() => password.length >= 8, [password])

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      const isRecovery = session?.user?.aud === "authenticated"
      setHasRecoverySession(Boolean(isRecovery))
      setCheckingSession(false)
    }

    void checkSession()

    return () => {
      mounted = false
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!hasRecoverySession) {
      setError("Recovery session missing. Please use the latest reset link from your email.")
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
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setUpdated(true)
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 inline-flex items-center">
          <HireovenLogo className="h-10 w-auto" priority />
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Set a new password</h1>
        <p className="text-sm text-gray-500 mb-8">
          Choose a strong password to secure your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm transition-shadow"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat password"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent text-sm transition-shadow"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          )}

          {!checkingSession && !hasRecoverySession && !updated && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              This page needs a valid recovery session. Open the newest reset email and click the link again.
            </p>
          )}

          {updated && (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated successfully. You can now sign in.
            </p>
          )}

          <button
            type="submit"
            disabled={loading || checkingSession || !hasRecoverySession}
            className="w-full py-3 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
          >
            {checkingSession ? "Checking link..." : loading ? "Updating..." : "Update password"}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          <Link href="/login" className="text-[#0369A1] font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
