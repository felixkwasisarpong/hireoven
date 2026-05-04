"use client"

import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Plane,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  X,
  Zap,
} from "lucide-react"
import { getJobIntelligence, getCompanyImmigrationProfile } from "@/lib/jobs/intelligence"
import { cn } from "@/lib/utils"
import type { Company, Job, IntelligenceConfidence, VisaFitScoreLabel } from "@/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onClose: () => void
  job: Job & { company: Company | null }
  displayTitle: string
}

const Z_TOP = 2147483647

// ── Colour helpers ─────────────────────────────────────────────────────────────

function scoreColor(label: VisaFitScoreLabel | null): {
  bg: string; text: string; ring: string; arc: string; glow: string
} {
  switch (label) {
    case "Very Strong":
    case "Strong":
      return { bg: "#ECFDF5", text: "#065F46", ring: "#A7F3D0", arc: "#10B981", glow: "rgba(16,185,129,0.35)" }
    case "Medium":
      return { bg: "#EFF6FF", text: "#1E40AF", ring: "#BFDBFE", arc: "#3B82F6", glow: "rgba(59,130,246,0.3)" }
    case "Weak":
      return { bg: "#FFF7ED", text: "#9A3412", ring: "#FED7AA", arc: "#F97316", glow: "rgba(249,115,22,0.3)" }
    case "Blocked":
      return { bg: "#FEF2F2", text: "#991B1B", ring: "#FECACA", arc: "#EF4444", glow: "rgba(239,68,68,0.3)" }
    default:
      return { bg: "#F8FAFC", text: "#475569", ring: "#E2E8F0", arc: "#94A3B8", glow: "rgba(148,163,184,0.2)" }
  }
}

// ── Score arc ─────────────────────────────────────────────────────────────────

function ScoreArc({ value, label }: { value: number | null; label: VisaFitScoreLabel | null }) {
  const gradId = useId().replace(/:/g, "")
  const size = 110
  const stroke = 10
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const arcLen = Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)))
  const dash = (pct / 100) * arcLen
  const { arc, glow } = scoreColor(label)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size / 2 + 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-x-0 top-0">
        <defs>
          <linearGradient id={`vi-arc-${gradId}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={arc} stopOpacity="0.8" />
            <stop offset="100%" stopColor={arc} />
          </linearGradient>
          <filter id={`vi-glow-${gradId}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Track */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} strokeLinecap="round" />
        {/* Fill */}
        {pct > 0 && (
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={`url(#vi-arc-${gradId})`} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${dash} ${arcLen}`}
            filter={`url(#vi-glow-${gradId})`}
            style={{ filter: `drop-shadow(0 0 4px ${glow})` }}
            className="transition-[stroke-dasharray] duration-700 ease-out" />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[34%] text-center">
        <span className="text-[28px] font-black leading-none tabular-nums text-white">
          {value == null ? "—" : pct}
        </span>
        <span className="text-[12px] font-semibold text-white/50">/100</span>
      </div>
    </div>
  )
}

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: IntelligenceConfidence }) {
  const map: Record<IntelligenceConfidence, { label: string; cls: string }> = {
    high:    { label: "High confidence",   cls: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/30" },
    medium:  { label: "Medium confidence", cls: "bg-amber-500/20 text-amber-200 ring-amber-500/30" },
    low:     { label: "Low confidence",    cls: "bg-orange-500/20 text-orange-200 ring-orange-500/30" },
    unknown: { label: "Unverified",        cls: "bg-white/10 text-white/50 ring-white/10" },
  }
  const { label, cls } = map[level] ?? map.unknown
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1", cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-slate-100 bg-white p-4 shadow-[0_1px_4px_rgba(15,23,42,0.05)]", className)}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{children}</p>
  )
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({ label, detail, positive }: { label: string; detail: string | null; positive: boolean }) {
  return (
    <div className={cn(
      "flex gap-3 rounded-lg border-l-2 px-3 py-2.5",
      positive ? "border-emerald-400 bg-emerald-50" : "border-red-400 bg-red-50"
    )}>
      <div className="min-w-0">
        <p className={cn("text-[12.5px] font-semibold", positive ? "text-emerald-800" : "text-red-800")}>{label}</p>
        {detail && <p className={cn("mt-0.5 text-[11.5px] leading-relaxed", positive ? "text-emerald-700" : "text-red-700")}>{detail}</p>}
      </div>
    </div>
  )
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/60">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={cn("mt-1 text-[18px] font-bold leading-none tabular-nums", accent ?? "text-slate-800")}>{value}</p>
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export default function VisaIntelDrawer({ open, onClose, job, displayTitle }: Props) {
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (typeof document === "undefined" || !open) return null

  const company = job.company
  const intel = getJobIntelligence(job)
  const immigProfile = getCompanyImmigrationProfile(company)

  const visa = intel.visa
  const hasBlocker = (intel.visa?.blockers ?? []).some((b) => b.detected)
  const activeBlocker = (intel.visa?.blockers ?? intel.sponsorshipBlockers ?? []).find((b) => b.detected)
  const positiveSignals = visa?.positiveSignals ?? []
  const riskSignals = visa?.riskSignals ?? []
  const wageLevelLabel = intel.lcaSalary?.commonWageLevel ?? intel.lcaSalary?.wageLevel ?? null
  const stemOpt = intel.stemOpt
  const capExempt = intel.capExempt
  const lcaCertRate = intel.companyHiringHealth?.lcaCertificationRate ?? immigProfile.lcaCertificationRate
  const totalLca = immigProfile.totalLcaApplications
  const recentPetitions = immigProfile.recentH1BPetitions
  const sponsorshipTrend = intel.companyHiringHealth?.sponsorshipTrend ?? "unknown"
  const colors = scoreColor(visa?.label ?? null)

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ zIndex: Z_TOP - 1 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Visa Intelligence"
        className="fixed inset-y-0 right-0 flex h-full w-full max-w-[440px] flex-col shadow-[0_0_60px_-12px_rgba(15,23,42,0.5)] outline-none"
        style={{ zIndex: Z_TOP, backgroundColor: "#F8FAFC",
          animation: "visaDrawerIn 0.22s cubic-bezier(0.25,0.46,0.45,0.94) both" }}
      >

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <header
          className="relative shrink-0 overflow-hidden px-5 pb-5 pt-5"
          style={{
            background: "linear-gradient(145deg, #0f172a 0%, #1e1b4b 45%, #312e81 100%)",
          }}
        >
          {/* Ambient glows */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-2xl"
            style={{ background: `${colors.arc}22` }} />
          <div className="pointer-events-none absolute -bottom-8 left-1/4 h-24 w-24 rounded-full blur-xl"
            style={{ background: `${colors.arc}18` }} />

          {/* Top row */}
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Visa Intelligence</p>
              <h2 className="mt-1 truncate text-[14px] font-bold leading-snug text-white">{displayTitle}</h2>
              {company?.name && (
                <p className="mt-0.5 truncate text-[12px] text-white/55">{company.name}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white/80"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Score + label */}
          <div className="relative mt-4 flex items-end gap-4">
            <ScoreArc value={visa?.visaFitScore ?? null} label={visa?.label ?? null} />
            <div className="pb-1">
              <p className="text-[22px] font-black leading-none text-white">
                {visa?.label ?? "Unknown"}
              </p>
              <p className="mt-1 text-[12px] text-white/50">Visa fit rating</p>
              <div className="mt-2">
                <ConfidenceBadge level={visa?.confidence ?? "unknown"} />
              </div>
            </div>
          </div>

          {/* Recency strip */}
          {visa?.dataRecency?.asOfDate && (
            <div className="relative mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] text-white/45">
                Data as of{" "}
                <span className="font-semibold text-white/65">
                  {new Date(visa.dataRecency.asOfDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                {visa.dataRecency.status && ` · ${visa.dataRecency.status}`}
              </p>
            </div>
          )}
        </header>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ backgroundColor: "#F8FAFC" }}>

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Job-search guidance only — not legal advice. Consult a licensed immigration attorney for your specific situation.
            </p>
          </div>

          {/* Summary */}
          {visa?.summary && (
            <Card>
              <p className="text-[12.5px] leading-relaxed text-slate-700">{visa.summary}</p>
            </Card>
          )}

          {/* Sponsorship blocker */}
          <Card className={hasBlocker ? "border-red-100 bg-red-50/60" : "border-emerald-100 bg-emerald-50/50"}>
            <SectionLabel>Sponsorship</SectionLabel>
            {hasBlocker && activeBlocker ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                  <span className="text-[13px] font-bold text-red-800">Blocker detected</span>
                  <span className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    activeBlocker.severity === "high" ? "bg-red-200 text-red-900"
                      : activeBlocker.severity === "medium" ? "bg-orange-200 text-orange-900"
                      : "bg-slate-200 text-slate-700"
                  )}>
                    {activeBlocker.severity}
                  </span>
                </div>
                {activeBlocker.kind && (
                  <p className="text-[12px] capitalize text-red-700 mb-2">
                    {activeBlocker.kind.replace(/_/g, " ")}
                  </p>
                )}
                {activeBlocker.evidence.length > 0 && (
                  <div className="space-y-1">
                    {activeBlocker.evidence.map((e, i) => (
                      <p key={i} className="text-[11.5px] leading-relaxed text-red-700 before:mr-1 before:content-['·']">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                <span className="text-[13px] font-semibold text-emerald-800">No blockers found in this posting</span>
              </div>
            )}
          </Card>

          {/* Positive signals */}
          {positiveSignals.length > 0 && (
            <Card>
              <SectionLabel>Positive Signals</SectionLabel>
              <div className="space-y-2">
                {positiveSignals.map((s, i) => (
                  <SignalRow key={i} label={s.label} detail={s.detail} positive />
                ))}
              </div>
            </Card>
          )}

          {/* Risk signals */}
          {riskSignals.length > 0 && (
            <Card>
              <SectionLabel>Risk Signals</SectionLabel>
              <div className="space-y-2">
                {riskSignals.map((s, i) => (
                  <SignalRow key={i} label={s.label} detail={s.detail} positive={false} />
                ))}
              </div>
            </Card>
          )}

          {/* LCA History */}
          <Card>
            <SectionLabel>{company?.name ?? "Company"} LCA History</SectionLabel>
            {totalLca == null && recentPetitions == null && lcaCertRate == null ? (
              <p className="text-[12.5px] italic text-slate-400">No LCA records on file for this employer.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {totalLca != null && (
                  <StatTile label="Total LCA Apps" value={totalLca.toLocaleString()} />
                )}
                {recentPetitions != null && (
                  <StatTile label="Recent Petitions" value={recentPetitions.toLocaleString()} accent="text-indigo-700" />
                )}
                {lcaCertRate != null && (
                  <StatTile
                    label="Cert Rate"
                    value={`${Math.round(lcaCertRate * 100)}%`}
                    accent={lcaCertRate >= 0.8 ? "text-emerald-700" : lcaCertRate >= 0.5 ? "text-amber-700" : "text-red-700"}
                  />
                )}
                {sponsorshipTrend !== "unknown" && (
                  <StatTile
                    label="Trend"
                    value={sponsorshipTrend.charAt(0).toUpperCase() + sponsorshipTrend.slice(1)}
                    accent={sponsorshipTrend === "improving" ? "text-emerald-700" : sponsorshipTrend === "declining" ? "text-red-700" : "text-slate-700"}
                  />
                )}
              </div>
            )}
            {immigProfile.commonJobTitles.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  Common Sponsored Titles
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {immigProfile.commonJobTitles.slice(0, 5).map((t) => (
                    <span key={t} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200/60">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Wage-level signal */}
          {wageLevelLabel && (
            <Card>
              <SectionLabel>Wage-Level Signal</SectionLabel>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 ring-1 ring-violet-200">
                  <TrendingUp className="h-4 w-4 text-violet-600" aria-hidden />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">
                    Prevailing wage: <span className="text-violet-700">{wageLevelLabel}</span>
                  </p>
                  {intel.lcaSalary?.explanation && (
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{intel.lcaSalary.explanation}</p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* STEM OPT */}
          <Card>
            <SectionLabel>STEM OPT Readiness</SectionLabel>
            {stemOpt?.eligible === true ? (
              <div className="flex items-center gap-2.5 mb-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <span className="text-[13px] font-bold text-emerald-700">Likely STEM OPT eligible</span>
              </div>
            ) : stemOpt?.eligible === false ? (
              <div className="flex items-center gap-2.5 mb-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                </div>
                <span className="text-[13px] font-semibold text-amber-700">Eligibility uncertain</span>
              </div>
            ) : (
              <p className="mb-2 text-[12.5px] italic text-slate-400">E-Verify and role signals not yet analyzed.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {stemOpt?.eVerifyLikely != null && (
                <div className={cn(
                  "rounded-lg px-3 py-2 text-center text-[11.5px] font-semibold ring-1",
                  stemOpt.eVerifyLikely
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-50 text-slate-500 ring-slate-200"
                )}>
                  E-Verify: {stemOpt.eVerifyLikely ? "Present" : "Not detected"}
                </div>
              )}
              {stemOpt?.stemRelatedRole != null && (
                <div className={cn(
                  "rounded-lg px-3 py-2 text-center text-[11.5px] font-semibold ring-1",
                  stemOpt.stemRelatedRole
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-50 text-slate-500 ring-slate-200"
                )}>
                  STEM role: {stemOpt.stemRelatedRole ? "Yes" : "Unclear"}
                </div>
              )}
            </div>
            {stemOpt?.missingSignals && stemOpt.missingSignals.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">
                Missing signals: {stemOpt.missingSignals.join(" · ")}
              </p>
            )}
            {stemOpt?.summary && (
              <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{stemOpt.summary}</p>
            )}
          </Card>

          {/* Cap-exempt */}
          <Card className={
            capExempt?.likelihood === "likely" || capExempt?.likelihood === "possible"
              ? "border-sky-100 bg-sky-50/40"
              : ""
          }>
            <SectionLabel>Cap-Exempt Likelihood</SectionLabel>
            {capExempt?.likelihood === "likely" || capExempt?.likelihood === "possible" ? (
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100">
                    <Plane className="h-4 w-4 text-sky-600" aria-hidden />
                  </div>
                  <span className="text-[13px] font-bold text-sky-800">
                    {capExempt.likelihood === "likely" ? "Likely" : "Possible"} cap-exempt pathway
                  </span>
                </div>
                <p className="mb-2 text-[12px] font-medium capitalize text-sky-700">
                  Category: {capExempt.category.replace(/_/g, " ")}
                </p>
                {capExempt.evidence.length > 0 && (
                  <div className="space-y-1">
                    {capExempt.evidence.map((e, i) => (
                      <p key={i} className="text-[11.5px] text-sky-700 before:mr-1.5 before:content-['·']">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : capExempt?.likelihood === "unlikely" ? (
              <p className="text-[12.5px] text-slate-600">Cap-exempt pathway appears unlikely from available records.</p>
            ) : (
              <p className="text-[12.5px] italic text-slate-400">Cap-exempt likelihood is unknown.</p>
            )}
          </Card>

          {/* Data gaps */}
          {visa?.summary?.startsWith("Missing") && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              <p className="text-[12px] leading-relaxed text-amber-800">{visa.summary}</p>
            </div>
          )}

          {/* Bottom padding */}
          <div className="h-2" />
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-3">
          <p className="text-[10.5px] leading-relaxed text-slate-400">
            Based on publicly available LCA and DOL data. Not legal advice — always verify with the employer or an immigration attorney.
          </p>
        </footer>
      </aside>

      <style>{`
        @keyframes visaDrawerIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )

  return createPortal(drawer, document.body)
}
