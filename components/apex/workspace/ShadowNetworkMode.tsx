"use client"

import { useState } from "react"
import { Network, Loader2, Copy, CheckCheck, ExternalLink, Zap, ThumbsUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoredConnection } from "@/lib/apex/shadow-network/scorer"

type Props = {
  targetCompany?: string
  targetJobTitle?: string
  extensionConnected?: boolean
  className?: string
}

type ConnectionWithDM = ScoredConnection & { dm?: string; dmLoading?: boolean; copied?: boolean }

const TIER_CONFIG = {
  hot:  { label: "Hot",  color: "bg-amber-100 text-amber-700 border-amber-200",  dot: "bg-amber-500",  icon: Zap },
  warm: { label: "Warm", color: "bg-indigo-100 text-indigo-700 border-indigo-200", dot: "bg-indigo-400", icon: ThumbsUp },
  cold: { label: "Cold", color: "bg-slate-100 text-slate-500 border-slate-200",   dot: "bg-slate-400",  icon: Minus },
}

function ConnectionCard({
  conn,
  onGenerateDM,
  onCopy,
}: {
  conn: ConnectionWithDM
  onGenerateDM: (id: string) => void
  onCopy: (id: string, text: string) => void
}) {
  const tier = TIER_CONFIG[conn.referralTier]
  const TierIcon = tier.icon

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-[0_1px_4px_rgba(15,23,42,0.06)] transition hover:shadow-[0_2px_8px_rgba(15,23,42,0.10)]">
      <div className="flex items-start justify-between gap-3">
        {/* Avatar placeholder */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-[13px] font-bold text-white">
          {conn.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-slate-900">{conn.name}</p>
            <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", tier.color)}>
              <TierIcon className="h-2.5 w-2.5" />
              {tier.label}
            </span>
          </div>
          <p className="truncate text-[11.5px] text-slate-500">{conn.title}</p>
          <p className="text-[11px] text-indigo-600">{conn.company}</p>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-[20px] font-black leading-none text-slate-800">{conn.referralScore}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">score</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{conn.degree}° conn.</p>
        </div>
      </div>

      {/* Score breakdown chips */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {conn.recentlyActive && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Active on LinkedIn</span>
        )}
        {conn.mutualCount > 0 && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{conn.mutualCount} mutual</span>
        )}
        {conn.tenureMonths >= 12 && conn.tenureMonths <= 36 && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">Sweet-spot tenure</span>
        )}
      </div>

      {/* DM section */}
      <div className="mt-3">
        {conn.dm ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-700">
              {conn.dm}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onCopy(conn.id, conn.dm!)}
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-indigo-700"
              >
                {conn.copied ? <CheckCheck className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {conn.copied ? "Copied!" : "Copy DM"}
              </button>
              {conn.profileUrl && (
                <a
                  href={conn.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open profile
                </a>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onGenerateDM(conn.id)}
            disabled={conn.dmLoading}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
          >
            {conn.dmLoading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Zap className="h-3 w-3" />
            }
            {conn.dmLoading ? "Drafting…" : "Draft DM"}
          </button>
        )}
      </div>
    </div>
  )
}

type ScanState = "idle" | "scanning" | "done" | "error" | "no_extension"

export function ShadowNetworkMode({ targetCompany, targetJobTitle = "Software Engineer", extensionConnected = false, className }: Props) {
  // Allow user to override the company if it wasn't extracted from the message
  const [company, setCompany] = useState(targetCompany ?? "")
  const [connections, setConnections] = useState<ConnectionWithDM[]>([])
  const [filter, setFilter] = useState<"all" | "hot" | "warm">("all")
  const [scanState, setScanState] = useState<ScanState>("idle")
  const [scanError, setScanError] = useState<string | null>(null)

  // Sync if parent updates the company (e.g. after Claude response lands)
  const prevCompanyRef = useState(targetCompany)[0]
  if (targetCompany && targetCompany !== prevCompanyRef && targetCompany !== company) {
    setCompany(targetCompany)
  }

  async function scanLinkedIn() {
    if (!company.trim()) {
      setScanState("error")
      setScanError("Type a company name first.")
      return
    }
    if (!extensionConnected) {
      setScanState("no_extension")
      return
    }
    setScanState("scanning")
    setScanError(null)
    try {
      // Post a message to the extension via the web app bridge
      const result = await new Promise<{ ok: boolean; connections?: unknown[]; error?: string }>((resolve) => {
        window.postMessage({ source: "hireoven-apex", type: "APEX_SCAN_CONNECTIONS", companyName: company, jobTitle: targetJobTitle }, "*")
        // Listen for the response
        const handler = (e: MessageEvent) => {
          if (e.data?.type === "APEX_SCAN_CONNECTIONS_RESULT") {
            window.removeEventListener("message", handler)
            resolve(e.data as { ok: boolean; connections?: unknown[]; error?: string })
          }
        }
        window.addEventListener("message", handler)
        // Timeout after 40s
        setTimeout(() => {
          window.removeEventListener("message", handler)
          resolve({ ok: false, error: "Timed out. Make sure the Apex extension is installed and you're logged into LinkedIn." })
        }, 40_000)
      })

      if (!result.ok || !result.connections) {
        setScanState("error")
        setScanError(result.error ?? "Scan failed")
        return
      }

      // Send raw connections to server for ranking
      const rankRes = await fetch("/api/apex/shadow-network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connections: result.connections, jobTitle: targetJobTitle, companyName: company }),
      })
      const { ranked } = await rankRes.json()
      setConnections(ranked ?? [])
      setScanState("done")
    } catch (err) {
      setScanState("error")
      setScanError(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  async function generateDM(id: string) {
    const conn = connections.find((c) => c.id === id)
    if (!conn) return

    setConnections((prev) => prev.map((c) => c.id === id ? { ...c, dmLoading: true } : c))
    try {
      const res = await fetch("/api/apex/shadow-network", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: conn, jobTitle: targetJobTitle, companyName: company }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.dm) {
        const fallback = `Hi ${conn.name.split(" ")[0]}, I noticed you're at ${conn.company || company}. I'm exploring the ${targetJobTitle} role there and would really appreciate a quick referral or your honest take on the team. Happy to share my resume. No pressure either way!`
        setConnections((prev) => prev.map((c) => c.id === id ? { ...c, dm: fallback, dmLoading: false } : c))
        return
      }
      setConnections((prev) => prev.map((c) => c.id === id ? { ...c, dm: data.dm, dmLoading: false } : c))
    } catch (err) {
      const fallback = `Hi ${conn.name.split(" ")[0]}, I noticed you're at ${conn.company || company}. I'm exploring the ${targetJobTitle} role there and would appreciate a quick referral or your take on the team. Happy to share my resume!`
      setConnections((prev) => prev.map((c) => c.id === id ? { ...c, dm: fallback, dmLoading: false } : c))
    }
  }

  function copyDM(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setConnections((prev) => prev.map((c) => c.id === id ? { ...c, copied: true } : c))
    setTimeout(() => setConnections((prev) => prev.map((c) => c.id === id ? { ...c, copied: false } : c)), 2000)
  }

  const filtered = connections.filter((c) => filter === "all" || c.referralTier === filter)
  const hotCount  = connections.filter((c) => c.referralTier === "hot").length
  const warmCount = connections.filter((c) => c.referralTier === "warm").length

  return (
    <div className={cn("rounded-2xl border border-indigo-100 bg-slate-50", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 rounded-t-2xl border-b border-slate-200 bg-white px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <Network className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-900">Shadow Network</p>
          {scanState === "done" ? (
            <p className="text-[11px] text-slate-500">
              {hotCount} hot · {warmCount} warm referral paths at {company}
            </p>
          ) : (
            <input
              type="text"
              placeholder="Type company name (e.g. Stripe)"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") scanLinkedIn() }}
              disabled={scanState === "scanning"}
              className="mt-0.5 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[12px] text-slate-800 outline-none focus:border-indigo-400 placeholder:text-slate-400 disabled:opacity-60"
            />
          )}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5">
          {(["all", "hot", "warm"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition",
                filter === f ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Connection list */}
      <div className="space-y-2.5 p-4">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-slate-400">No {filter} connections found</p>
        ) : (
          filtered.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              onGenerateDM={generateDM}
              onCopy={copyDM}
            />
          ))
        )}

        {/* Scan CTA / status */}
        {scanState === "idle" && (
          <div className={cn(
            "rounded-xl border border-dashed p-4",
            extensionConnected ? "border-indigo-200 bg-indigo-50/50" : "border-slate-200 bg-slate-50"
          )}>
            <p className="text-[13px] font-semibold text-slate-800">Scan your LinkedIn connections at {company}</p>
            <p className="mt-1 text-[11.5px] text-slate-500 leading-relaxed">
              Apex opens a LinkedIn people search, reads who you know at {company}, ranks them by referral likelihood, and closes the tab — all in ~15 seconds.
            </p>
            {!extensionConnected ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                ⚠ Apex extension not detected in this tab — reload the page after installing it
              </p>
            ) : (
              <button
                type="button"
                onClick={scanLinkedIn}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                <Network className="h-3.5 w-3.5" />
                Scan LinkedIn connections
              </button>
            )}
          </div>
        )}

        {scanState === "scanning" && (
          <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600 flex-shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-indigo-800">Scanning LinkedIn…</p>
              <p className="text-[11px] text-indigo-500">Opening search, reading your connections, then closing the tab.</p>
            </div>
          </div>
        )}

        {scanState === "no_extension" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[13px] font-semibold text-amber-800">Apex extension not detected</p>
            <p className="mt-1 text-[12px] text-amber-700">Install the Apex Chrome extension to enable LinkedIn scanning.</p>
            <a
              href="https://chrome.google.com/webstore"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-amber-800 transition hover:bg-amber-50"
            >
              <ExternalLink className="h-3 w-3" />
              Get the extension
            </a>
          </div>
        )}

        {scanState === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-[13px] font-semibold text-red-800">Scan failed</p>
            <p className="mt-0.5 text-[12px] text-red-600">{scanError}</p>
            <button
              type="button"
              onClick={() => setScanState("idle")}
              className="mt-2 text-[11.5px] font-semibold text-indigo-600 hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {scanState === "done" && connections.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-[13px] text-slate-600">No 1st or 2nd degree connections found at {company || "this company"}.</p>
            <button type="button" onClick={() => setScanState("idle")} className="mt-2 text-[11.5px] text-indigo-500 hover:underline">Rescan</button>
          </div>
        )}
      </div>
    </div>
  )
}
