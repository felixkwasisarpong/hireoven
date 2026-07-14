"use client"

import { useEffect, useState } from "react"
import { Copy, Check, Gift, Users, Sparkles, Clock3, ChevronRight } from "lucide-react"

type ReferralStatus = {
  code: string
  url: string
  totalReferrals: number
  convertedReferrals: number
  pendingReferrals: number
  daysEarned: number
  capReached: boolean
  referrals: Array<{
    id: string
    refereeName: string
    status: "pending" | "rewarded" | "expired"
    joinedAt: string
    convertedAt: string | null
  }>
}

const MAX_REFERRALS = 3

function useCopyToClipboard(text: string) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement("textarea")
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return { copied, copy }
}

function ProgressRing({ value, max }: { value: number; max: number }) {
  const r = 40
  const circ = 2 * Math.PI * r
  const pct = Math.min(value / max, 1)
  const offset = circ * (1 - pct)
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={r} fill="none"
        stroke="url(#refGrad)" strokeWidth="10"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <defs>
        <linearGradient id="refGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF5C18" />
          <stop offset="100%" stopColor="#FF9A3C" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function StatusPill({ status }: { status: string }) {
  if (status === "rewarded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        +14 days earned
      </span>
    )
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Verifying (7d)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
      Expired
    </span>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className ?? ""}`} />
}

export default function ReferralsPageClient() {
  const [data, setData] = useState<ReferralStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const { copied, copy } = useCopyToClipboard(data?.url ?? "")

  useEffect(() => {
    fetch("/api/referral/status")
      .then((r) => r.json())
      .then((d: ReferralStatus) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const converted = data?.convertedReferrals ?? 0
  const pending = data?.pendingReferrals ?? 0
  const daysEarned = data?.daysEarned ?? 0

  return (
    <div className="min-h-full bg-slate-50/60">

      {/* ── Hero banner ──────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden px-6 py-10 sm:px-8 sm:py-12"
        style={{ background: "linear-gradient(135deg, #1a0a00 0%, #2d1200 40%, #1e0f2e 100%)" }}
      >
        {/* Ambient glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-orange-600/20 blur-[80px]" />
          <div className="absolute -bottom-10 right-10 h-48 w-48 rounded-full bg-violet-600/15 blur-[60px]" />
        </div>

        <div className="relative z-10 mx-auto max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1">
            <Gift className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-xs font-semibold text-orange-300">Referral program</span>
          </div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Share Hireoven,<br />
            <span style={{ background: "linear-gradient(90deg, #FF5C18, #FF9A3C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              get free Pro time
            </span>
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/60 leading-relaxed">
            Invite friends who are job hunting. They get <strong className="text-white/80">7 days of Pro free</strong> the moment they sign up — and you earn <strong className="text-white/80">14 days</strong> once they stick around for a week.
          </p>

          {/* Steps row */}
          <div className="mt-7 flex flex-wrap items-center gap-2 sm:gap-0">
            {[
              { step: "1", text: "Copy your link" },
              { step: "2", text: "Friend signs up" },
              { step: "3", text: "You both get Pro" },
            ].map((s, i) => (
              <div key={s.step} className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: "linear-gradient(135deg, #FF5C18, #FF7A35)" }}>
                    {s.step}
                  </div>
                  <span className="text-xs font-medium text-white/70">{s.text}</span>
                </div>
                {i < 2 && <ChevronRight className="mx-1 h-3.5 w-3.5 text-white/25 sm:mx-3" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-7 sm:px-6">

        {/* Share link card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Your referral link</p>
          </div>
          <div className="p-5">
            {loading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                  <span className="truncate font-mono text-sm text-slate-600">{data?.url ?? "—"}</span>
                </div>
                <button
                  type="button"
                  onClick={() => data?.url && copy()}
                  disabled={!data?.url}
                  className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-50"
                  style={{ background: copied ? "#10b981" : "linear-gradient(135deg, #FF5C18 0%, #FF7A35 100%)" }}
                >
                  {copied ? (
                    <><Check className="h-4 w-4" /> Copied!</>
                  ) : (
                    <><Copy className="h-4 w-4" /> Copy link</>
                  )}
                </button>
              </div>
            )}
            <p className="mt-3 text-[12px] text-slate-400">
              Anyone who signs up through your link gets 7 days of Pro free — no credit card needed.
            </p>
          </div>
        </div>

        {/* Progress + stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

          {/* Progress ring */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:col-span-1">
            {loading ? (
              <Skeleton className="h-24 w-24 rounded-full" />
            ) : (
              <div className="relative">
                <ProgressRing value={converted} max={MAX_REFERRALS} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-slate-900">{converted}</span>
                  <span className="text-[10px] font-medium text-slate-400">of {MAX_REFERRALS}</span>
                </div>
              </div>
            )}
            <p className="mt-3 text-xs font-semibold text-slate-600">Converted</p>
            <p className="text-[11px] text-slate-400">referrals</p>
          </div>

          {/* Days earned + pending */}
          <div className="flex flex-col gap-4 sm:col-span-2">
            <div className="flex flex-1 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "linear-gradient(135deg, #FF5C18, #FF7A35)" }}>
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                {loading ? <Skeleton className="h-7 w-20 mb-1" /> : (
                  <p className="text-2xl font-bold text-slate-900">
                    {daysEarned}
                    <span className="ml-1 text-sm font-normal text-slate-400">days free</span>
                  </p>
                )}
                <p className="text-xs text-slate-500">Pro time earned so far</p>
              </div>
            </div>

            <div className="flex flex-1 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-1 ring-amber-100">
                <Clock3 className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                {loading ? <Skeleton className="h-7 w-12 mb-1" /> : (
                  <p className="text-2xl font-bold text-slate-900">{pending}</p>
                )}
                <p className="text-xs text-slate-500">Pending — verifying after 7 days</p>
              </div>
            </div>
          </div>
        </div>

        {/* Cap reached banner */}
        {!loading && data?.capReached && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <span className="text-2xl">🏆</span>
            <div>
              <p className="font-semibold text-emerald-800">Max referrals reached — well done!</p>
              <p className="mt-0.5 text-sm text-emerald-700">
                You&apos;ve earned the full 6 weeks of free Pro. Good luck with your search!
              </p>
            </div>
          </div>
        )}

        {/* Referral history */}
        {!loading && (data?.referrals.length ?? 0) > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Users className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Your referrals</p>
            </div>
            <ul className="divide-y divide-slate-50">
              {data!.referrals.map((r, i) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                      {r.refereeName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{r.refereeName}</p>
                      <p className="text-[11px] text-slate-400">
                        Joined {new Date(r.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Empty state */}
        {!loading && (data?.referrals.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <Gift className="h-6 w-6 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-700">No referrals yet</p>
            <p className="mt-1 text-sm text-slate-400">Copy your link above and share it with friends who are job hunting.</p>
          </div>
        )}

        {/* Fine print */}
        <p className="pb-4 text-center text-[11px] text-slate-400">
          Rewards are capped at {MAX_REFERRALS} referrals per account · Referee reward fires on sign-up · Referrer reward fires after 7 days
        </p>
      </div>
    </div>
  )
}
