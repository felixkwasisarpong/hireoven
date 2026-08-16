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
        <div className="flex h-14 w-14 items-center justify-center border border-[#38e08a]/25 bg-[#38e08a]/12">
          <CheckCircle2 className="h-7 w-7 text-[#38e08a]" />
        </div>
        <p className="text-[15px] font-bold text-white">You&apos;re on the list!</p>
        <p className="text-sm text-[#ccd6cf]/55">
          We&apos;ll email <strong className="text-[#ccd6cf]">{email}</strong> with your invite link when your spot is ready.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="waitlist-email" className="sr-only">Email address</label>
        <input
          id="waitlist-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={state === "loading"}
          className="h-12 flex-1 border border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] px-4 text-[14px] text-[#ccd6cf] placeholder:text-[#ccd6cf]/40 outline-none transition focus:border-[#38e08a] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={state === "loading" || !email.trim()}
          className="term-btn term-btn-amber h-12 shrink-0 justify-center px-6 text-[14px] disabled:opacity-60"
        >
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>Request access <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </div>
      {state === "error" && (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </form>
  )
}
