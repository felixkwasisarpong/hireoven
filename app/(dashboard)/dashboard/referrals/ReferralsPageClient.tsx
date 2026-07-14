"use client"

import { useEffect, useState } from "react"
import { Copy, Check, Gift, Users, Clock } from "lucide-react"

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea")
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      {copied ? (
        <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</>
      ) : (
        <><Copy className="h-3.5 w-3.5" /> Copy</>
      )}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "rewarded") {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">+14 days earned</span>
  }
  if (status === "pending") {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Pending (7-day check)</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Expired</span>
}

export default function ReferralsPageClient() {
  const [data, setData] = useState<ReferralStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/referral/status")
      .then((r) => r.json())
      .then((d: ReferralStatus) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const MAX_REFERRALS = 3

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Refer a friend</h1>
        <p className="mt-1 text-sm text-slate-500">
          Share your link. When a friend signs up, you both get free Pro time.
        </p>
      </div>

      {/* How it works */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { icon: "🔗", label: "Share your link", desc: "Send it to a friend who's job hunting" },
          { icon: "✅", label: "They sign up", desc: "They get 7 days of Pro free instantly" },
          { icon: "🎁", label: "You earn 14 days", desc: "After their first week (up to 3×)" },
        ].map((step) => (
          <div key={step.label} className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
            <div className="mb-2 text-2xl">{step.icon}</div>
            <p className="text-xs font-semibold text-slate-700">{step.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{step.desc}</p>
          </div>
        ))}
      </div>

      {/* Referral link */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Your referral link</p>
        {loading ? (
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-700">
              {data?.url ?? "—"}
            </div>
            {data?.url && <CopyButton text={data.url} />}
          </div>
        )}
      </div>

      {/* Stats */}
      {!loading && data && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Users className="h-4 w-4" />
                <span className="text-xs font-medium">Referred</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {data.convertedReferrals}
                <span className="ml-1 text-sm font-normal text-slate-400">/ {MAX_REFERRALS}</span>
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Gift className="h-4 w-4" />
                <span className="text-xs font-medium">Days earned</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {data.daysEarned}
                <span className="ml-1 text-sm font-normal text-slate-400">days</span>
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-medium">Pending</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {data.pendingReferrals}
              </p>
            </div>
          </div>

          {/* Cap notice */}
          {data.capReached && (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">You&apos;ve hit the max — nice work!</p>
              <p className="text-xs text-emerald-700 mt-0.5">You&apos;ve earned the full 6 weeks of free Pro. Keep applying!</p>
            </div>
          )}

          {/* Referral history */}
          {data.referrals.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Referral history</p>
              </div>
              <ul className="divide-y divide-slate-50">
                {data.referrals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{r.refereeName}</p>
                      <p className="text-xs text-slate-400">
                        Joined {new Date(r.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
