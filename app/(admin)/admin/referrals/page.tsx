"use client"

import { useEffect, useState } from "react"
import type { ReferralMetrics } from "@/lib/admin/referral-metrics"

function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

function shortDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string
  tone?: "default" | "warn" | "good"
}) {
  const valueTone =
    tone === "warn" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : "text-slate-900"
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-[26px] font-bold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
    </div>
  )
}

function StatusPill({ status, awaiting }: { status: string; awaiting: boolean }) {
  if (awaiting) {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
        awaiting payout
      </span>
    )
  }
  const cls =
    status === "converted"
      ? "bg-emerald-50 text-emerald-700"
      : status === "pending"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600"
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status}</span>
}

export default function AdminReferralsPage() {
  const [data, setData] = useState<ReferralMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch("/api/admin/referrals")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`)
        return res.json()
      })
      .then((d: ReferralMetrics) => {
        if (alive) setData(d)
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const s = data?.summary
  const cfg = data?.config

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Referrals</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Referral funnel and reward payouts.
          {cfg
            ? ` Referee gets ${cfg.refereeRewardDays}d Pro at signup; referrer gets ${cfg.referrerRewardDays}d after ${cfg.eligibilityDays}d, capped at ${cfg.maxReferralRewards}.`
            : ""}{" "}
          UTC.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : data && s ? (
        <>
          {s.awaitingPayout > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <span className="font-semibold">
                {fmt(s.awaitingPayout)} referral{s.awaitingPayout === 1 ? "" : "s"} past the{" "}
                {cfg?.eligibilityDays}-day gate with the referrer still unpaid
              </span>
              {s.oldestAwaitingDays != null ? ` — oldest waiting ${fmt(s.oldestAwaitingDays)} days.` : "."}{" "}
              Referrer rewards are only granted by <code>/api/cron/process-referrals</code>; a growing number
              here means that cron is not running.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total referrals" value={fmt(s.total)} />
            <StatCard label="Pending" value={fmt(s.pending)} hint="Referrer not yet paid" />
            <StatCard label="Converted" value={fmt(s.converted)} tone={s.converted > 0 ? "good" : "default"} />
            <StatCard
              label="Awaiting payout"
              value={fmt(s.awaitingPayout)}
              hint="Past the eligibility gate"
              tone={s.awaitingPayout > 0 ? "warn" : "good"}
            />
            <StatCard label="Referee rewards granted" value={fmt(s.refereeRewardsGranted)} />
            <StatCard label="Referrer rewards granted" value={fmt(s.referrerRewardsGranted)} />
            <StatCard label="Active referee trials" value={fmt(s.activeRefereeTrials)} hint="Trial still running" />
            <StatCard
              label="Referees now paying"
              value={fmt(s.refereesConvertedToPaid)}
              hint="Stripe-backed active sub"
              tone={s.refereesConvertedToPaid > 0 ? "good" : "default"}
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Top referrers</h2>
            </div>
            {data.leaders.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">No referrals yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11.5px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2 font-medium">Referrer</th>
                      <th className="px-5 py-2 font-medium">Code</th>
                      <th className="px-5 py-2 font-medium tabular-nums">Referred</th>
                      <th className="px-5 py-2 font-medium tabular-nums">Converted</th>
                      <th className="px-5 py-2 font-medium tabular-nums">Rewards</th>
                      <th className="px-5 py-2 font-medium tabular-nums">Cap left</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.leaders.map((l) => (
                      <tr key={l.referrerId}>
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-slate-900">{l.fullName ?? "—"}</div>
                          <div className="text-[12px] text-slate-500">{l.email ?? l.referrerId}</div>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[12px] text-slate-600">
                          {l.referralCode ?? "—"}
                        </td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-700">{fmt(l.total)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-700">{fmt(l.converted)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-700">{fmt(l.rewardsGranted)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-500">{fmt(l.capRemaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Recent referrals</h2>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">No referrals yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11.5px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2 font-medium">Referrer</th>
                      <th className="px-5 py-2 font-medium">Referee</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium">Referee plan</th>
                      <th className="px-5 py-2 font-medium">Signed up</th>
                      <th className="px-5 py-2 font-medium">Referrer paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-2.5 text-[12px] text-slate-600">{r.referrerEmail ?? "—"}</td>
                        <td className="px-5 py-2.5 text-[12px] text-slate-600">{r.refereeEmail ?? "—"}</td>
                        <td className="px-5 py-2.5">
                          <StatusPill status={r.status} awaiting={r.awaitingPayout} />
                        </td>
                        <td className="px-5 py-2.5 text-[12px] text-slate-600">
                          {r.refereePlan ? `${r.refereePlan} · ${r.refereeSubStatus}` : "free"}
                          {r.refereeTrialEnd ? (
                            <div className="text-[11px] text-slate-400">
                              trial ends {shortDate(r.refereeTrialEnd)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-2.5 text-[12px] text-slate-500">{shortDate(r.createdAt)}</td>
                        <td className="px-5 py-2.5 text-[12px] text-slate-500">
                          {shortDate(r.referrerRewardGrantedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[12px] text-slate-400">
            Referee rewards are granted synchronously at signup. Referrer rewards are granted only by the
            daily <code>process-referrals</code> cron, once a referral is {cfg?.eligibilityDays} days old and
            below the {cfg?.maxReferralRewards}-reward cap. &ldquo;Referees now paying&rdquo; counts referees with a
            Stripe-backed active subscription.
          </p>
        </>
      ) : null}
    </div>
  )
}
