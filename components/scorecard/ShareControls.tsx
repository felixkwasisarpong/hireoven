"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Link2, RefreshCw, Share2 } from "lucide-react"
import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"

const CONSENT_COPY =
  "I agree to publish a sanitized version of my scorecard (display name, score, grade, component breakdown). I can revoke at any time."

export function ShareControls({ card }: { card: PersonalScorecard }) {
  const router = useRouter()
  const base = typeof window !== "undefined" ? window.location.origin : "https://hireoven.com"
  const [isPublic, setIsPublic] = useState(card.is_public)
  const [token, setToken] = useState(card.share_token)
  const [displayName, setDisplayName] = useState(card.display_name ?? "")
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const publicUrl = token ? `${base}/scorecard/${token}` : null

  async function call(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return null
      }
      return data
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    const data = await call("/api/scorecard/personal/share", {
      make_public: true,
      consented: true,
      display_name: displayName || undefined,
    })
    if (data?.url) {
      setIsPublic(true)
      setToken(data.url.split("/scorecard/")[1] ?? token)
    }
  }

  async function makePrivate() {
    const data = await call("/api/scorecard/personal/share", { make_public: false })
    if (data) setIsPublic(false)
  }

  async function revoke() {
    const data = await call("/api/scorecard/personal/revoke")
    if (data) {
      setIsPublic(false)
      setToken(null)
    }
  }

  async function recompute() {
    const data = await call("/api/scorecard/personal/recompute")
    if (data) router.refresh()
  }

  async function copy() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex items-center gap-2">
        <Share2 className="h-4 w-4 text-slate-400" />
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Share your scorecard</h2>
      </div>

      {card.resume_changed && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Your resume changed since this score was computed.</span>
          <button
            onClick={recompute}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recompute
          </button>
        </div>
      )}

      {!isPublic ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-slate-500">
            Private by default. Publishing creates a shareable link with a sanitized card — no
            resume, contact info, or company matches.
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">Display name on the public card</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              placeholder="Your first name or a handle"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5"
            />
            <span>{CONSENT_COPY}</span>
          </label>
          <button
            onClick={publish}
            disabled={busy || !consented}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-600 disabled:opacity-50"
          >
            Publish public card
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-slate-500">Your card is public.</p>
          {publicUrl && (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {publicUrl}
              </div>
              <button
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={makePrivate}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Make private
            </button>
            <button
              onClick={revoke}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Revoke link
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  )
}
