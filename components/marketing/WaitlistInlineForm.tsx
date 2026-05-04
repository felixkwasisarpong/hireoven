"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react"

export function WaitlistInlineForm() {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setState("loading")
    setError("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source: "homepage" }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok && res.status !== 409) {
        setError(body.error ?? "Something went wrong. Try again.")
        setState("error")
        return
      }
      setState("done")
    } catch {
      setError("Network error. Please try again.")
      setState("error")
    }
  }

  if (state === "done") {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        </div>
        <p className="text-[15px] font-bold text-slate-900">You&apos;re on the list!</p>
        <p className="text-sm text-slate-500">
          We&apos;ll email <strong className="text-slate-700">{email}</strong> with your invite link when your spot is ready.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={state === "loading"}
          className="h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={state === "loading" || !email.trim()}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(255,92,24,0.35)] transition hover:brightness-105 disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}
        >
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>Request access <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </div>
      {state === "error" && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </form>
  )
}
