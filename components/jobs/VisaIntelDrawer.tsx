"use client"

import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  open: boolean
  onClose: () => void
  job: Job & { company: Company | null }
  displayTitle: string
}

// Highest possible 32-bit z-index value, applied inline so no global CSS rule
// (e.g. `body.site-chroma > * { z-index: 1 }`) can ever push us behind anything.
const Z_TOP = 2147483647

// Inline white background — drawer must be fully opaque even on chroma pages
// where global rules dim `.bg-white` for visual depth.
const WHITE: React.CSSProperties = { backgroundColor: "#ffffff" }

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Divider() {
  return <div className="border-t border-slate-100" />
}

function ConfidencePip({ level }: { level: IntelligenceConfidence }) {
  const map: Record<IntelligenceConfidence, { label: string; cls: string }> = {
    high:    { label: "High confidence",    cls: "bg-emerald-100 text-emerald-700" },
    medium:  { label: "Medium confidence",  cls: "bg-amber-100 text-amber-700" },
    low:     { label: "Low confidence",     cls: "bg-orange-100 text-orange-700" },
    unknown: { label: "Confidence unknown", cls: "bg-slate-100 text-slate-500" },
  }
  const conf = map[level] ?? map.unknown
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", conf.cls)}>
      <Info className="h-3 w-3 shrink-0" aria-hidden />
      {conf.label}
    </span>
  )
}

function ScoreArc({ value, label }: { value: number | null; label: VisaFitScoreLabel | null }) {
  const gradId = useId().replace(/:/g, "")
  const size = 128
  const stroke = 11
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const arcLen = Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)))
  const dash = (pct / 100) * arcLen

  const color =
    label === "Very Strong" || label === "Strong" ? "#10B981"
    : label === "Medium" ? "#3B82F6"
    : label === "Blocked" ? "#EF4444"
    : "#F97316"

  return (
    <div className="flex items-end gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size / 2 + 4 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-x-0 top-0">
          <defs>
            <linearGradient id={`vi-grad-${gradId}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.7" />
            </linearGradient>
          </defs>
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke="#E2E8F0" strokeWidth={stroke} strokeLinecap="round" />
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={`url(#vi-grad-${gradId})`} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${dash} ${arcLen}`}
            className="transition-[stroke-dasharray] duration-700 ease-out" />
        </svg>
        <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
          <span className="text-[22px] font-bold leading-none tabular-nums text-slate-900">
            {value == null ? "—" : `${pct}`}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">/100</span>
        </div>
      </div>
      <div className="pb-0.5">
        <p className="text-[15px] font-bold text-slate-900">{label ?? "Unknown"}</p>
        <p className="mt-0.5 text-[12px] text-slate-500">Visa fit score</p>
      </div>
    </div>
  )
}

function SignalRow({
  label,
  detail,
  positive,
}: {
  label: string
  detail: string | null
  positive: boolean
}) {
  return (
    <div className="flex gap-2.5">
      {positive
        ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
        : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
      }
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-800">{label}</p>
        {detail && <p className="mt-0.5 text-[12px] text-slate-500">{detail}</p>}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5 ring-1 ring-slate-200/60" style={{ backgroundColor: "#F8FAFC" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-slate-800">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

export default function VisaIntelDrawer({ open, onClose, job, displayTitle }: Props) {
  const panelRef = useRef<HTMLElement | null>(null)

  // ── Side effects only fire while open ───────────────────────────────────
  // Non-blocking side-panel pattern: NO body-scroll lock and NO backdrop.
  // The page behind stays fully visible and interactive. Close via X or Esc.
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)

    panelRef.current?.focus()

    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  // SSR safety
  if (typeof document === "undefined") return null
  if (!open) return null

  const company = job.company
  const intel = getJobIntelligence(job)
  const immigProfile = getCompanyImmigrationProfile(company)

  const visa = intel.visa
  const hasBlocker = (intel.visa?.blockers ?? []).some((b) => b.detected)
  const activeBlocker = (intel.visa?.blockers ?? intel.sponsorshipBlockers ?? []).find((b) => b.detected)

  const positiveSignals = visa?.positiveSignals ?? []
  const riskSignals = visa?.riskSignals ?? []
  const dataGapSummary = visa?.summary ?? null
  const wageLevelLabel = intel.lcaSalary?.commonWageLevel ?? intel.lcaSalary?.wageLevel ?? null
  const stemOpt = intel.stemOpt
  const capExempt = intel.capExempt

  const lcaCertRate =
    intel.companyHiringHealth?.lcaCertificationRate ??
    immigProfile.lcaCertificationRate
  const totalLca = immigProfile.totalLcaApplications
  const recentPetitions = immigProfile.recentH1BPetitions
  const sponsorshipTrend = intel.companyHiringHealth?.sponsorshipTrend ?? "unknown"

  // Non-modal side panel: pinned to the right edge, no backdrop, no scroll
  // lock. Page underneath remains fully visible and interactive. Close via X
  // button or Escape key.
  const drawer = (
    <aside
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="Visa Intelligence breakdown"
      className="animate-slide-in-right fixed inset-y-0 right-0 flex h-full w-full max-w-[480px] flex-col border-l border-slate-200 shadow-2xl outline-none"
      style={{ ...WHITE, zIndex: Z_TOP }}
    >
        {/* ── Header ── */}
        <header
          className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"
          style={WHITE}
        >
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Visa Intelligence
            </p>
            <h2 className="mt-0.5 truncate text-[15px] font-semibold text-slate-900">
              {displayTitle}
            </h2>
            {company?.name && (
              <p className="mt-0.5 truncate text-[12px] text-slate-500">{company.name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 -mt-0.5 shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-5" style={WHITE}>
          <div className="space-y-5">

            {/* 1. Top Disclaimer */}
            <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5" style={{ backgroundColor: "#F8FAFC" }}>
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <p className="text-[11.5px] leading-relaxed text-slate-500">
                This is job-search guidance, not legal advice. Consult a licensed immigration attorney for case-specific counsel.
              </p>
            </div>

            {/* 2. Visa Fit Score */}
            <DrawerSection title="Visa Fit Score">
              <ScoreArc value={visa?.visaFitScore ?? null} label={visa?.label ?? null} />
              <div className="mt-2">
                <ConfidencePip level={visa?.confidence ?? "unknown"} />
              </div>
              {visa?.summary && !dataGapSummary?.startsWith("Missing") && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">{visa.summary}</p>
              )}
            </DrawerSection>

            <Divider />

            {/* 3. Sponsorship Blocker */}
            <DrawerSection title="Sponsorship Blocker">
              {hasBlocker && activeBlocker ? (
                <div className="rounded-lg bg-red-50 px-4 py-3 ring-1 ring-red-200">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                    <span className="text-[13px] font-semibold text-red-800">Blocker detected</span>
                    <span className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                      activeBlocker.severity === "high" ? "bg-red-200 text-red-900"
                        : activeBlocker.severity === "medium" ? "bg-orange-100 text-orange-800"
                        : "bg-slate-100 text-slate-600"
                    )}>
                      {activeBlocker.severity} severity
                    </span>
                  </div>
                  {activeBlocker.kind && (
                    <p className="mt-1.5 text-[12px] capitalize text-red-700">
                      {activeBlocker.kind.replace(/_/g, " ")}
                    </p>
                  )}
                  {activeBlocker.evidence.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {activeBlocker.evidence.map((e, i) => (
                        <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-red-700">
                          <span aria-hidden>&ldquo;</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                  <span className="text-[13px] font-medium text-emerald-800">No sponsorship blockers found in the posting.</span>
                </div>
              )}
            </DrawerSection>

            <Divider />

            {/* 4. Company LCA History */}
            <DrawerSection title={`${company?.name ?? "Company"} LCA History`}>
              {totalLca == null && recentPetitions == null && lcaCertRate == null ? (
                <p className="text-[12.5px] italic text-slate-400">No LCA records on file for this employer.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {totalLca != null && (
                    <StatTile label="Total LCA apps" value={totalLca.toLocaleString()} />
                  )}
                  {recentPetitions != null && (
                    <StatTile label="Recent petitions" value={recentPetitions.toLocaleString()} />
                  )}
                  {lcaCertRate != null && (
                    <StatTile label="Certification rate" value={`${Math.round(lcaCertRate * 100)}%`} />
                  )}
                  {sponsorshipTrend !== "unknown" && (
                    <StatTile
                      label="Sponsorship trend"
                      value={sponsorshipTrend.charAt(0).toUpperCase() + sponsorshipTrend.slice(1)}
                    />
                  )}
                </div>
              )}
              {immigProfile.commonJobTitles.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Common sponsored titles</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {immigProfile.commonJobTitles.slice(0, 5).map((t) => (
                      <span key={t} className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium text-slate-700" style={{ backgroundColor: "#F1F5F9" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </DrawerSection>

            {/* 5. Positive signals */}
            {positiveSignals.length > 0 && (
              <>
                <Divider />
                <DrawerSection title="Positive Signals">
                  <div className="space-y-2.5">
                    {positiveSignals.map((s, i) => (
                      <SignalRow key={i} label={s.label} detail={s.detail} positive />
                    ))}
                  </div>
                </DrawerSection>
              </>
            )}

            {/* 6. Risk signals */}
            {riskSignals.length > 0 && (
              <>
                <Divider />
                <DrawerSection title="Risk Signals">
                  <div className="space-y-2.5">
                    {riskSignals.map((s, i) => (
                      <SignalRow key={i} label={s.label} detail={s.detail} positive={false} />
                    ))}
                  </div>
                </DrawerSection>
              </>
            )}

            {/* 7. Wage-level signal */}
            {wageLevelLabel && (
              <>
                <Divider />
                <DrawerSection title="Wage-Level Signal">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-slate-400" aria-hidden />
                    <span className="text-[13px] font-medium text-slate-800">
                      Common level: <strong>{wageLevelLabel}</strong>
                    </span>
                  </div>
                  {intel.lcaSalary?.explanation && (
                    <p className="mt-1 text-[12px] italic leading-relaxed text-slate-500">
                      {intel.lcaSalary.explanation}
                    </p>
                  )}
                </DrawerSection>
              </>
            )}

            {/* 8. STEM OPT Readiness */}
            <Divider />
            <DrawerSection title="STEM OPT Readiness">
              {stemOpt?.eligible === true ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                  <span className="text-[13px] font-semibold text-emerald-700">Likely STEM OPT eligible</span>
                </div>
              ) : stemOpt?.eligible === false ? (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                  <span className="text-[13px] font-medium text-amber-700">Eligibility uncertain</span>
                </div>
              ) : (
                <p className="text-[12.5px] italic text-slate-400">
                  E-Verify and role signals not yet analyzed.
                </p>
              )}
              {stemOpt?.eVerifyLikely != null && (
                <p className="mt-1 text-[12px] text-slate-500">
                  E-Verify: <strong>{stemOpt.eVerifyLikely ? "Signal present" : "Not detected"}</strong>
                </p>
              )}
              {stemOpt?.stemRelatedRole != null && (
                <p className="text-[12px] text-slate-500">
                  STEM role: <strong>{stemOpt.stemRelatedRole ? "Yes" : "Unclear"}</strong>
                </p>
              )}
              {stemOpt?.missingSignals && stemOpt.missingSignals.length > 0 && (
                <p className="mt-1 text-[11.5px] text-slate-400">
                  Missing: {stemOpt.missingSignals.join(" · ")}
                </p>
              )}
              {stemOpt?.summary && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{stemOpt.summary}</p>
              )}
            </DrawerSection>

            {/* 9. Cap-exempt */}
            <Divider />
            <DrawerSection title="Cap-Exempt Signal">
              {capExempt?.isLikelyCapExempt === true ? (
                <div className="rounded-lg bg-sky-50 px-4 py-3 ring-1 ring-sky-200">
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-sky-600" aria-hidden />
                    <span className="text-[13px] font-semibold text-sky-800">Likely cap-exempt employer</span>
                  </div>
                  <p className="mt-1 text-[12px] capitalize text-sky-700">
                    Category: {capExempt.category.replace(/_/g, " ")}
                  </p>
                  {capExempt.evidence.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {capExempt.evidence.map((e, i) => (
                        <li key={i} className="text-[11.5px] text-sky-700">· {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : capExempt?.isLikelyCapExempt === false ? (
                <p className="text-[12.5px] text-slate-600">
                  This employer does not appear to be cap-exempt — standard H-1B lottery may apply.
                </p>
              ) : (
                <p className="text-[12.5px] italic text-slate-400">Cap-exempt status not yet determined.</p>
              )}
            </DrawerSection>

            {/* 10. Data gaps */}
            {dataGapSummary && (
              <>
                <Divider />
                <DrawerSection title="Data Gaps">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                    <p className="text-[12px] leading-relaxed text-amber-800">{dataGapSummary}</p>
                  </div>
                </DrawerSection>
              </>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        <footer
          className="shrink-0 border-t border-slate-100 px-5 py-3"
          style={{ backgroundColor: "#F8FAFC" }}
        >
          <p className="text-[11px] leading-relaxed text-slate-400">
            <strong className="text-slate-500">Disclaimer:</strong> This is job-search guidance based on publicly available LCA and DOL data, not legal advice. Results may not reflect the most current employer policies. Always verify with the employer or an immigration attorney.
          </p>
        </footer>
    </aside>
  )

  return createPortal(drawer, document.body)
}
