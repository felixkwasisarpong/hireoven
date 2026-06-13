"use client"

/**
 * Immigration services marketplace UI. Browse brokered services (attorney
 * consults, petition reviews, document prep), request one with your visa
 * context, and track the request's status. Hireoven matches you with a vetted
 * partner and takes a cut of the booking.
 */
import { useCallback, useEffect, useState } from "react"
import { Check, Clock, Loader2, Scale, ShieldCheck, Zap } from "lucide-react"

type Offering = {
  id: string
  name: string
  category: string
  summary: string
  basePrice: number
  platformFeeRate: number
  turnaround: string
}
type Req = {
  id: string
  offering_id: string
  category: string
  rush: boolean
  quoted_price: number
  status: "requested" | "matched" | "scheduled" | "completed" | "cancelled"
  visa_situation: string | null
  created_at: string
}

const STATUS_STYLE: Record<Req["status"], string> = {
  requested: "bg-amber-50 text-amber-700",
  matched: "bg-blue-50 text-blue-700",
  scheduled: "bg-violet-50 text-violet-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-400",
}

export default function ImmigrationServices() {
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [requests, setRequests] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Offering | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/immigration/services", { cache: "no-store" })
    if (res.ok) {
      const d = await res.json()
      setOfferings(d.offerings ?? [])
      setRequests(d.requests ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading services…
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5 text-[12.5px] text-emerald-800">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        Every request is matched with a licensed, vetted immigration partner. Quotes are flat — no surprise fees.
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {offerings.map((o) => (
          <div key={o.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-slate-400" />
              <p className="text-[14.5px] font-bold text-slate-900">{o.name}</p>
            </div>
            <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-slate-500">{o.summary}</p>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-[18px] font-bold text-slate-900">${o.basePrice}</p>
                <p className="flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" /> {o.turnaround}</p>
              </div>
              <button
                onClick={() => setActive(o)}
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800"
              >
                Request
              </button>
            </div>
          </div>
        ))}
      </div>

      {requests.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your requests</p>
          <ul className="space-y-2">
            {requests.map((r) => {
              const offering = offerings.find((o) => o.id === r.offering_id)
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-slate-800">{offering?.name ?? r.offering_id}</p>
                    <p className="text-[11.5px] text-slate-400">${r.quoted_price}{r.rush ? " · rush" : ""} · {new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {active && <RequestModal offering={active} onClose={() => setActive(null)} onDone={() => { setActive(null); void load() }} />}
    </div>
  )
}

function RequestModal({ offering, onClose, onDone }: { offering: Offering; onClose: () => void; onDone: () => void }) {
  const [rush, setRush] = useState(false)
  const [situation, setSituation] = useState("")
  const [email, setEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const rushSurcharge = rush ? Math.round(offering.basePrice * 0.25) : 0
  const price = offering.basePrice + rushSurcharge

  async function submit() {
    setSaving(true)
    const res = await fetch("/api/immigration/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offeringId: offering.id, rush, visaSituation: situation, contactEmail: email }),
    })
    setSaving(false)
    if (res.ok) {
      setDone(true)
      setTimeout(onDone, 1400)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check className="h-6 w-6" />
            </div>
            <p className="mt-3 text-[15px] font-bold text-slate-900">Request submitted</p>
            <p className="mt-1 text-[13px] text-slate-500">We&apos;ll match you with a vetted partner and follow up shortly.</p>
          </div>
        ) : (
          <>
            <p className="text-[16px] font-bold text-slate-900">{offering.name}</p>
            <p className="mt-1 text-[13px] text-slate-500">{offering.summary}</p>

            <label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                <Zap className="h-4 w-4 text-amber-500" /> Rush handling (+${Math.round(offering.basePrice * 0.25)})
              </span>
              <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            </label>

            <label className="mt-3 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your situation</span>
              <textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={3}
                placeholder="Current visa, timeline, employer, what you need help with…"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact email (optional)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="defaults to your account email"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none"
              />
            </label>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-[20px] font-bold text-slate-900">${price}</p>
              <button
                onClick={submit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit request
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">No charge yet. We confirm scope with your matched partner before any payment.</p>
          </>
        )}
      </div>
    </div>
  )
}
