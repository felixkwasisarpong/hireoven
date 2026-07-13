"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Loader2, Megaphone, X } from "lucide-react"
import { useSubscription } from "@/lib/hooks/useSubscription"

const SNOOZE_KEY = "launch-promo-snooze-until-v2"
const DAY_MS = 24 * 60 * 60 * 1000

// Mirrors the LAUNCH promotion in Stripe (20% off Pro Max monthly) and the
// promos-table row that ends 2026-08-04 — after that the code is inactive and
// checkout would reject it, so stop advertising it.
const LAUNCH_PROMO_CODE = "LAUNCH"
const OFFER_ENDS_AT = Date.parse("2026-08-04T17:25:00Z")

/** Yellow sphere — replicates the 3D floating balls in the reference. */
function Orb({ className }: { className: string }) {
  return (
    <span
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        background: "radial-gradient(circle at 35% 35%, #FFE566, #F59E0B)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25), inset 0 -2px 4px rgba(0,0,0,0.1)",
      }}
    />
  )
}

/** Small blue accent sphere. */
function BlueOrb({ className }: { className: string }) {
  return (
    <span
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        background: "radial-gradient(circle at 35% 35%, #93C5FD, #3B82F6)",
        boxShadow: "0 3px 8px rgba(0,0,0,0.2)",
      }}
    />
  )
}

export default function LaunchPromoPopup() {
  const { isPro, isLoading } = useSubscription()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    // Preview mode bypasses all guards
    if (window.location.search.includes("launchPromo=preview")) {
      setOpen(true)
      return
    }

    if (isLoading || isPro) return
    if (Date.now() >= OFFER_ENDS_AT) return

    const snoozeUntil = Number(window.localStorage.getItem(SNOOZE_KEY) || 0)
    if (snoozeUntil && Date.now() < snoozeUntil) return

    const t = window.setTimeout(() => setOpen(true), 2000)
    return () => window.clearTimeout(t)
  }, [isPro, isLoading])

  function close() {
    setLeaving(true)
    window.setTimeout(() => setOpen(false), 220)
  }

  function snoozeDay() {
    try { window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + DAY_MS)) } catch { /* ignore */ }
    close()
  }

  function dismiss() {
    try { window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * DAY_MS)) } catch { /* ignore */ }
    close()
  }

  async function claimOffer() {
    setCheckingOut(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro_max", interval: "monthly", promoCode: LAUNCH_PROMO_CODE }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.url) { window.location.href = data.url; return }
    } catch { /* fall through */ }
    setCheckingOut(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Launch promotion"
    >
      {/* backdrop */}
      <button
        type="button"
        onClick={snoozeDay}
        aria-label="Close promotion"
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm ${
          leaving ? "opacity-0 transition-opacity duration-220" : "animate-fade-in-backdrop"
        }`}
      />

      <div
        className={`relative w-full max-w-md overflow-hidden rounded-3xl shadow-2xl ring-1 ring-black/10 ${
          leaving
            ? "scale-95 opacity-0 transition-all duration-220"
            : "animate-scale-in"
        }`}
      >
        {/* ── blue stage ── */}
        <div
          className="relative overflow-hidden px-6 pb-12 pt-6"
          style={{ background: "radial-gradient(ellipse at 50% 30%, #818CF8 0%, #6366F1 60%, #4F46E5 100%)" }}
        >
          {/* close button */}
          <button
            type="button"
            onClick={snoozeDay}
            aria-label="Dismiss promotion"
            className="absolute right-4 top-4 z-50 rounded-full p-2 text-white/70 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>

          {/* floating orbs */}
          <Orb className="left-6 top-6 h-10 w-10" />
          <Orb className="right-10 top-4 h-12 w-12" />
          <Orb className="right-3 top-20 h-8 w-8" />
          <Orb className="left-2 bottom-12 h-11 w-11" />
          <Orb className="right-14 bottom-5 h-12 w-12" />
          <Orb className="left-1/2 bottom-3 h-9 w-9" />
          <BlueOrb className="left-20 top-16 h-5 w-5" />
          <BlueOrb className="right-20 bottom-14 h-4 w-4" />

          {/* ── stacked banner panels ── */}
          <div className="relative mt-3 flex flex-col items-center gap-0">
            {/* top panel */}
            <div
              className="relative z-10 w-[88%] -rotate-1 rounded-2xl px-6 py-4 text-center"
              style={{
                background: "linear-gradient(135deg, #67E8F9, #38BDF8)",
                boxShadow: "0 8px 0 #0284C7, 0 14px 24px rgba(0,0,0,0.3)",
              }}
            >
              <p className="text-4xl font-black tracking-wider text-white drop-shadow">SPECIAL</p>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-white/85">
                Launch Offer
              </p>
            </div>

            {/* middle panel (yellow) — pops wider */}
            <div
              className="relative z-20 -mt-2 w-full rotate-1 rounded-2xl px-6 py-5"
              style={{
                background: "linear-gradient(135deg, #FDE68A, #F59E0B)",
                boxShadow: "0 8px 0 #B45309, 0 14px 24px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex items-center justify-center gap-4">
                <Megaphone
                  className="h-12 w-12 -rotate-12 flex-shrink-0"
                  style={{ color: "#0EA5E9" }}
                />
                <div className="leading-none">
                  <p
                    className="text-4xl font-black tracking-wide"
                    style={{ color: "#DC2626", textShadow: "0 2px 0 rgba(0,0,0,0.12)" }}
                  >
                    PRO MAX
                  </p>
                  <p
                    className="mt-0.5 text-xs font-bold uppercase tracking-widest"
                    style={{ color: "#9A1515" }}
                  >
                    First month with code {LAUNCH_PROMO_CODE}
                  </p>
                </div>
              </div>
            </div>

            {/* bottom panel */}
            <div
              className="relative z-10 -mt-2 w-[88%] -rotate-1 rounded-2xl px-6 py-4 text-center"
              style={{
                background: "linear-gradient(135deg, #67E8F9, #38BDF8)",
                boxShadow: "0 8px 0 #0284C7, 0 14px 24px rgba(0,0,0,0.3)",
              }}
            >
              <p className="font-black text-white drop-shadow">
                <span className="text-6xl">20%</span>
                <span className="text-lg uppercase tracking-widest"> off</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── CTA strip ── */}
        <div className="flex items-center gap-2 bg-white px-6 py-5">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={claimOffer}
            disabled={checkingOut}
            className="group ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/35 transition hover:shadow-xl active:scale-[0.98] disabled:opacity-70"
          >
            {checkingOut ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</>
            ) : (
              <>Claim offer <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
