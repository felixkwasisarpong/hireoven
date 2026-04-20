"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import type { Waitlist } from "@/types"

type Row = Pick<
  Waitlist,
  | "id"
  | "email"
  | "joined_at"
  | "is_international"
  | "visa_status"
  | "university"
  | "source"
  | "referrer"
  | "confirmed"
>

type Stats = {
  total: number
  confirmed: number
  international: number
  intlPct: number
  topUniversities: { name: string; count: number }[]
  topSources: { name: string; count: number }[]
}

function computeStats(rows: Row[]): Stats {
  const total = rows.length
  const confirmed = rows.filter((r) => r.confirmed).length
  const international = rows.filter((r) => r.is_international === true).length
  const intlPct = total ? Math.round((international / total) * 1000) / 10 : 0

  const uniMap = new Map<string, number>()
  for (const r of rows) {
    const u = r.university?.trim()
    if (u) uniMap.set(u, (uniMap.get(u) ?? 0) + 1)
  }
  const topUniversities = [...uniMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const srcMap = new Map<string, number>()
  for (const r of rows) {
    const s = (r.source ?? "unknown").trim() || "unknown"
    srcMap.set(s, (srcMap.get(s) ?? 0) + 1)
  }
  const topSources = [...srcMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    total,
    confirmed,
    international,
    intlPct,
    topUniversities,
    topSources,
  }
}

export default function WaitlistAdminPanel({ initialRows }: { initialRows: Row[] }) {
  const stats = useMemo(() => computeStats(initialRows), [initialRows])
  const [sendOpen, setSendOpen] = useState(false)
  const [subject, setSubject] = useState("Hireoven update")
  const [bodyText, setBodyText] = useState(
    "Hi — quick update from the Hireoven team.\n\nWe're shipping fast and you'll be first in line when we open the doors.\n\n— The Hireoven team"
  )
  const [sendBusy, setSendBusy] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  async function runSend(previewOnly: boolean) {
    setSendBusy(true)
    setSendResult(null)
    try {
      const res = await fetch("/api/admin/waitlist/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, bodyText, previewOnly }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSendResult(data.error ?? "Send failed")
        return
      }
      if (previewOnly) {
        setSendResult(
          `Preview: ${data.recipientCount ?? 0} confirmed recipients (sample: ${(data.sampleEmails ?? []).join(", ")})`
        )
      } else {
        setSendResult(`Sent ${data.sent ?? 0} of ${data.attempted ?? 0}`)
      }
    } finally {
      setSendBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total signups", value: stats.total },
          { label: "Confirmed emails", value: stats.confirmed },
          {
            label: "International",
            value: `${stats.international} (${stats.intlPct}%)`,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {s.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-950">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-950">Top universities</h2>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            {stats.topUniversities.length === 0 ? (
              <li className="text-gray-400">No data yet</li>
            ) : (
              stats.topUniversities.map((u) => (
                <li key={u.name} className="flex justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className="font-semibold text-gray-900">{u.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-950">Top sources</h2>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            {stats.topSources.map((u) => (
              <li key={u.name} className="flex justify-between gap-2">
                <span className="truncate">{u.name}</span>
                <span className="font-semibold text-gray-900">{u.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline" className="rounded-xl">
          <a href="/api/admin/waitlist?format=csv" download>
            Export CSV
          </a>
        </Button>
        <Button
          type="button"
          className="rounded-xl bg-gray-900 text-white hover:bg-gray-800"
          onClick={() => setSendOpen(true)}
        >
          Send update email
        </Button>
      </div>

      {sendOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-950">Email confirmed waitlist members</h2>
            <p className="mt-1 text-sm text-gray-500">
              Sends in batches of 100. Respects marketing unsubscribe flags in metadata.
            </p>
            <label className="mt-4 block text-xs font-semibold text-gray-700">Subject</label>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <label className="mt-4 block text-xs font-semibold text-gray-700">Body (plain text)</label>
            <textarea
              className="mt-1 min-h-[160px] w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
              <p className="font-semibold text-gray-800">Preview</p>
              <p className="mt-2 whitespace-pre-wrap">{bodyText}</p>
            </div>
            {sendResult ? (
              <p className="mt-3 text-sm text-gray-700">{sendResult}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={sendBusy}
                onClick={() => void runSend(true)}
                className="rounded-xl"
              >
                Preview count
              </Button>
              <Button
                type="button"
                disabled={sendBusy}
                onClick={() => void runSend(false)}
                className="rounded-xl bg-teal-600 hover:bg-teal-700"
              >
                {sendBusy ? "Sending…" : "Send to all confirmed"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSendOpen(false)
                  setSendResult(null)
                }}
                className="rounded-xl"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Intl</th>
              <th className="px-4 py-3">Visa</th>
              <th className="px-4 py-3">University</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Referrer / UTM</th>
              <th className="px-4 py-3">Confirmed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {initialRows.map((r) => (
              <tr key={r.id} className="text-gray-700">
                <td className="px-4 py-2.5 font-mono text-xs">{r.email}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600">
                  {new Date(r.joined_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  {r.is_international === true ? "Y" : r.is_international === false ? "N" : "—"}
                </td>
                <td className="max-w-[120px] truncate px-4 py-2.5 text-xs">
                  {r.visa_status ?? "—"}
                </td>
                <td className="max-w-[140px] truncate px-4 py-2.5 text-xs">
                  {r.university ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-xs">{r.source ?? "—"}</td>
                <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-gray-500">
                  {r.referrer ?? "—"}
                </td>
                <td className="px-4 py-2.5">{r.confirmed ? "Y" : "N"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
