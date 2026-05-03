"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { SponsorshipTruthData, SponsorshipVerdict } from "@/app/api/employers/[id]/sponsorship-truth/route"

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return "#1D9E75"
  if (score >= 40) return "#D97706"
  return "#DC2626"
}

function verdictLabel(verdict: SponsorshipVerdict): string {
  switch (verdict) {
    case "active_sponsor": return "Active sponsor — verified in DOL data"
    case "unverified": return "Signal detected, not fully verified"
    case "claims_only": return "Claims sponsorship — no filings found"
    case "no_data": return "No sponsorship data on file"
  }
}

function fmtRate(rate: number | null): string {
  if (rate == null) return "—"
  return `${Math.round(rate * 100)}%`
}

function fmtSalary(n: number | null): string {
  if (!n) return "—"
  return `$${Math.round(n / 1000)}k`
}

function fmtTrend(trend: string | null): string {
  if (!trend) return ""
  if (trend === "improving") return "↑ improving"
  if (trend === "declining") return "↓ declining"
  return trend
}

// ── Bar chart (no border-radius, teal fill) ───────────────────────────────────

function FilingBars({ data }: { data: SponsorshipTruthData["filingsByYear"] }) {
  if (data.length === 0) return null
  const sorted = [...data].sort((a, b) => a.year - b.year)
  const max = Math.max(...sorted.map((d) => d.total), 1)

  return (
    <div>
      <div className="flex items-end gap-3" style={{ height: 64 }}>
        {sorted.map(({ year, total }) => (
          <div key={year} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full" style={{ height: 52, display: "flex", alignItems: "flex-end" }}>
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(4, Math.round((total / max) * 100))}%`,
                  background: "#0D9488",
                }}
                title={`${total.toLocaleString()} filings`}
              />
            </div>
            <span className="text-[10px] text-[var(--color-text-muted,theme(colors.slate.400))]">
              {year}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-[var(--color-border,theme(colors.slate.200))]" />
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  companyId: string
  companyName: string
}

export function SponsorshipTruthScore({ companyId, companyName }: Props) {
  const [data, setData] = useState<SponsorshipTruthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/employers/${encodeURIComponent(companyId)}/sponsorship-truth`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: SponsorshipTruthData) => { setData(json); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [companyId])

  if (loading) {
    return (
      <div className="space-y-6 py-2 animate-pulse">
        <div className="flex items-start justify-between">
          <div className="h-6 w-48 rounded bg-slate-100" />
          <div className="h-14 w-20 rounded bg-slate-100" />
        </div>
        <div className="h-px bg-slate-100" />
        <div className="h-4 w-72 rounded bg-slate-100" />
        <div className="grid grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-7 w-12 rounded bg-slate-100" />
              <div className="h-3 w-20 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) return null

  const color = scoreColor(data.score)
  const filingYears =
    data.filingsByYear.length > 0
      ? `${data.filingsByYear[data.filingsByYear.length - 1].year}–${data.filingsByYear[0].year}`
      : null

  // Industry avg benchmarks (DOL aggregate baselines)
  const INDUSTRY_CERT_AVG = 0.93
  const INDUSTRY_DENIAL_AVG = 0.04
  const certDelta = data.certRate != null ? data.certRate - INDUSTRY_CERT_AVG : null
  const denialDelta = data.denialRate != null ? data.denialRate - INDUSTRY_DENIAL_AVG : null

  return (
    <div className="space-y-5">

      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-medium leading-snug text-[var(--color-text-strong,theme(colors.slate.900))]">
            {companyName}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted,theme(colors.slate.500))]">
            Sponsorship Truth Score
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p
            className="text-[48px] font-bold leading-none tabular-nums"
            style={{ color }}
          >
            {data.score}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted,theme(colors.slate.400))]">
            Truth score
          </p>
          <p className="mt-0.5 text-[12px]" style={{ color }}>
            {data.verdict === "active_sponsor" ? "Active sponsor" :
             data.verdict === "unverified" ? "Unverified" :
             data.verdict === "claims_only" ? "Claims only" :
             "No data"}
          </p>
        </div>
      </div>

      <Divider />

      {/* ── Verified line ── */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: data.totalFilings > 0 ? "#1D9E75" : "#94A3B8" }}
        />
        {data.totalFilings > 0 ? (
          <p className="text-sm text-[var(--color-text,theme(colors.slate.700))]">
            <span className="font-semibold">{data.totalFilings.toLocaleString()}</span> LCA filings verified in DOL public data
            {filingYears && <> · {filingYears}</>}
            {data.certRate != null && (
              <> · <span className="font-semibold">{fmtRate(data.certRate)}</span> certification rate</>
            )}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted,theme(colors.slate.500))]">
            No LCA filings found in DOL public data
          </p>
        )}
      </div>

      <Divider />

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-x-0 gap-y-4 sm:flex sm:items-start sm:divide-x sm:divide-[var(--color-border,theme(colors.slate.200))]">
        {[
          {
            value: data.totalFilings.toLocaleString(),
            label: "Total filings",
            delta: null,
            deltaPositive: null,
          },
          {
            value: fmtRate(data.certRate),
            label: "Cert rate",
            delta: certDelta != null
              ? `${certDelta >= 0 ? "+" : ""}${Math.round(certDelta * 100)}pp vs avg`
              : null,
            deltaPositive: certDelta != null ? certDelta >= 0 : null,
          },
          {
            value: fmtSalary(data.avgSalary),
            label: "Avg LCA salary",
            delta: null,
            deltaPositive: null,
          },
          {
            value: fmtRate(data.denialRate),
            label: "Denial rate",
            delta: denialDelta != null
              ? `${denialDelta >= 0 ? "+" : ""}${Math.round(denialDelta * 100)}pp vs avg`
              : null,
            deltaPositive: denialDelta != null ? denialDelta <= 0 : null,
          },
        ].map(({ value, label, delta, deltaPositive }) => (
          <div key={label} className="flex-1 px-0 sm:px-5 first:pl-0 last:pr-0">
            <p className="text-[28px] font-bold leading-none tabular-nums text-[var(--color-text-strong,theme(colors.slate.900))]">
              {value}
            </p>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted,theme(colors.slate.400))]">
              {label}
            </p>
            {delta && (
              <p
                className="mt-0.5 text-[11px] font-medium"
                style={{ color: deltaPositive ? "#1D9E75" : "#DC2626" }}
              >
                {delta}
              </p>
            )}
          </div>
        ))}
      </div>

      <Divider />

      {/* ── Claims vs data ── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">
            What they claim
          </p>
          <p className="text-sm leading-relaxed text-[var(--color-text,theme(colors.slate.700))]">
            {data.employerClaim === true
              ? `${companyName} lists itself as an H-1B sponsor on its profile.`
              : data.employerClaim === false
              ? `${companyName} does not indicate H-1B sponsorship.`
              : "No explicit sponsorship claim on file."}
          </p>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1D9E75]">
            What the data shows
          </p>
          <p className="text-sm leading-relaxed text-[var(--color-text,theme(colors.slate.700))]">
            {data.totalFilings > 0
              ? `${data.totalFilings.toLocaleString()} verified DOL filings${data.certRate != null ? ` with a ${fmtRate(data.certRate)} certification rate` : ""}${data.approvalTrend ? ` — trend ${fmtTrend(data.approvalTrend)}` : ""}.`
              : "No LCA filings found in DOL public records. Score derived from posting signals only."}
          </p>
        </div>
      </div>

      {data.filingsByYear.length > 0 && (
        <>
          <Divider />

          {/* ── Bar chart ── */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted,theme(colors.slate.400))]">
                H-1B filing history
              </p>
              <p className="text-[12px] font-semibold tabular-nums text-[var(--color-text-strong,theme(colors.slate.900))]">
                {data.totalFilings.toLocaleString()} total
              </p>
            </div>
            <FilingBars data={data.filingsByYear} />
          </div>
        </>
      )}

      {data.visaTypes.length > 0 && (
        <>
          <Divider />

          {/* ── Visa types ── */}
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted,theme(colors.slate.400))]">
              Visa types sponsored
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {data.visaTypes.map(({ type, count }) => (
                <div key={type}>
                  <p className="text-sm font-semibold text-[var(--color-text-strong,theme(colors.slate.900))]">
                    {type}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-muted,theme(colors.slate.400))]">
                    {count.toLocaleString()} filings
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Caveats ── */}
      {(data.isStaffingFirm || data.hasHighDenialRate || data.verdict === "claims_only") && (
        <>
          <Divider />
          <div className="border-l-2 border-amber-400 pl-4">
            {data.isStaffingFirm && (
              <p className="text-sm leading-relaxed text-[var(--color-text,theme(colors.slate.700))]">
                This employer appears to be a staffing firm. LCA filings may represent client placements, not direct employment. Score may overstate sponsorship likelihood for permanent roles.
              </p>
            )}
            {data.hasHighDenialRate && !data.isStaffingFirm && (
              <p className="text-sm leading-relaxed text-[var(--color-text,theme(colors.slate.700))]">
                This employer has a historically elevated denial rate. Consider this when evaluating visa risk.
              </p>
            )}
            {data.verdict === "claims_only" && !data.isStaffingFirm && !data.hasHighDenialRate && (
              <p className="text-sm leading-relaxed text-[var(--color-text,theme(colors.slate.700))]">
                Sponsorship is claimed on the employer profile but no matching DOL filings were found. Verify directly with the hiring team.
              </p>
            )}
          </div>
        </>
      )}

      <Divider />

      {/* ── Footer ── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--color-text-muted,theme(colors.slate.400))]">
          {data.dataSource}
          {data.lastUpdated && (
            <>
              {" · "}Updated {new Date(data.lastUpdated).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </>
          )}
        </p>
        <Link
          href="/dashboard/international"
          className="text-[11px] font-medium text-[var(--color-link,theme(colors.blue.600))] hover:underline"
        >
          Find similar employers →
        </Link>
      </div>
    </div>
  )
}
