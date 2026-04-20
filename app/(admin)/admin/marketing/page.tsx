"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Megaphone, RefreshCw, Send } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
} from "@/components/admin/AdminPrimitives"

type CampaignRow = {
  id: string
  name: string
  subject: string
  segment: "all" | "waitlist_confirmed" | string
  status: "draft" | "sending" | "sent" | "failed" | string
  total_recipients: number
  total_sent: number
  total_failed: number
  created_at: string
  sent_at: string | null
}

const SEGMENTS = [
  { value: "all", label: "All subscribers" },
  { value: "waitlist_confirmed", label: "Confirmed waitlist only" },
]

function statusTone(status: CampaignRow["status"]) {
  if (status === "sent") return "success" as const
  if (status === "failed") return "danger" as const
  if (status === "sending") return "warning" as const
  return "neutral" as const
}

export default function AdminMarketingPage() {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const [name, setName] = useState("Product update")
  const [subject, setSubject] = useState("What is new at Hireoven")
  const [segment, setSegment] = useState<"all" | "waitlist_confirmed">("waitlist_confirmed")
  const [bodyText, setBodyText] = useState(
    "Hi there,\n\nWe just shipped new updates on Hireoven.\n\n- Better matching quality\n- Faster job freshness\n- Improved alerts\n\nThanks,\nHireoven Team"
  )
  const [editorMode, setEditorMode] = useState<"text" | "html">("text")
  const [bodyHtml, setBodyHtml] = useState(
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f9ff;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:28px 30px;background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 100%);">
            <div style="font-size:12px;font-weight:700;color:#dbeafe;letter-spacing:0.12em;text-transform:uppercase;">Hireoven</div>
            <div style="margin-top:12px;font-size:30px;line-height:1.2;font-weight:800;color:#ffffff;">Your weekly hiring edge</div>
            <div style="margin-top:10px;font-size:15px;line-height:1.6;color:#e0f2fe;">New jobs, smarter matching, faster applications.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 30px;">
            <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=1400&auto=format&fit=crop" alt="Hireoven update" style="width:100%;max-width:560px;height:auto;border-radius:12px;display:block;" />
            <h2 style="margin:18px 0 10px;font-size:22px;line-height:1.3;color:#0f172a;">Fresh product updates</h2>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#334155;">We have shipped major upgrades to matching quality and job freshness so you can apply ahead of the crowd.</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155;">You can also embed GIFs and images in this template using public image URLs.</p>
            <a href="https://hireoven.com/dashboard" style="display:inline-block;background:#0369A1;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:700;">Open Hireoven</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
  )

  async function loadCampaigns() {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch("/api/admin/marketing/campaigns", { cache: "no-store" })
      const data = (await response.json()) as { rows?: CampaignRow[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "Could not load campaigns")
      setRows(data.rows ?? [])
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function sendCampaign(sendNow: boolean) {
    setSending(true)
    setResult(null)
    setError(null)
    try {
      const response = await fetch("/api/admin/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject,
          bodyText,
          bodyHtml: editorMode === "html" ? bodyHtml : undefined,
          segment,
          sendNow,
        }),
      })
      const data = (await response.json()) as {
        error?: string
        campaignId?: string
        sent?: number
        failed?: number
        totalRecipients?: number
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Could not create campaign")
      }

      if (sendNow) {
        setResult(
          `Campaign sent. ${data.sent ?? 0}/${data.totalRecipients ?? 0} delivered, ${data.failed ?? 0} failed.`
        )
      } else {
        setResult(`Draft campaign created: ${data.campaignId ?? "saved"}.`)
      }

      await loadCampaigns()
    } catch (sendError) {
      setError((sendError as Error).message)
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    void loadCampaigns()
  }, [])

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      ),
    [rows]
  )

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Marketing"
        title="Campaigns and newsletters"
        description="Create and send marketing campaigns to your subscriber segments with one-click unsubscribe built in."
        actions={
          <AdminButton tone="secondary" onClick={() => void loadCampaigns()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </AdminButton>
        }
      />

      <AdminPanel
        title="Create campaign"
        description="This sends from your configured support sender and auto-appends an unsubscribe link."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Campaign name
            </label>
            <AdminInput value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Segment
            </label>
            <AdminSelect
              value={segment}
              onChange={(event) => setSegment(event.target.value as "all" | "waitlist_confirmed")}
            >
              {SEGMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </AdminSelect>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
            Subject
          </label>
          <AdminInput value={subject} onChange={(event) => setSubject(event.target.value)} />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
            Body format
          </label>
          <div className="mb-3 flex gap-2">
            <AdminButton
              tone={editorMode === "text" ? "primary" : "secondary"}
              type="button"
              onClick={() => setEditorMode("text")}
            >
              Plain text
            </AdminButton>
            <AdminButton
              tone={editorMode === "html" ? "primary" : "secondary"}
              type="button"
              onClick={() => setEditorMode("html")}
            >
              Rich HTML
            </AdminButton>
          </div>
          {editorMode === "text" ? (
            <textarea
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              className="min-h-[220px] w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none shadow-[0_8px_20px_rgba(15,23,42,0.03)] placeholder:text-gray-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            />
          ) : (
            <textarea
              value={bodyHtml}
              onChange={(event) => setBodyHtml(event.target.value)}
              className="min-h-[260px] w-full rounded-2xl border border-gray-200 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none shadow-[0_8px_20px_rgba(15,23,42,0.03)] focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            />
          )}
          {editorMode === "html" ? (
            <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Use public URLs for images/GIFs via <code>&lt;img src="https://..." /&gt;</code>.
              The platform auto-appends unsubscribe footer.
            </div>
          ) : null}
        </div>

        {editorMode === "html" ? (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Live preview
            </label>
            <div
              className="max-h-[420px] overflow-auto rounded-2xl border border-gray-200 bg-white p-2"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {result ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {result}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <AdminButton tone="secondary" disabled={sending} onClick={() => void sendCampaign(false)}>
            <Megaphone className="mr-2 h-4 w-4" />
            Save as draft
          </AdminButton>
          <AdminButton disabled={sending} onClick={() => void sendCampaign(true)}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send now
          </AdminButton>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Recent campaigns"
        description="Latest campaign runs and delivery status."
      >
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Segment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Failed</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={7}>
                    No campaigns yet.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{row.name}</p>
                      <p className="text-xs text-gray-500">{row.subject}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{row.segment}</td>
                    <td className="px-4 py-3">
                      <AdminBadge tone={statusTone(row.status)}>{row.status}</AdminBadge>
                    </td>
                    <td className="px-4 py-3 text-gray-800">{row.total_recipients ?? 0}</td>
                    <td className="px-4 py-3 text-emerald-700">{row.total_sent ?? 0}</td>
                    <td className="px-4 py-3 text-red-700">{row.total_failed ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  )
}
