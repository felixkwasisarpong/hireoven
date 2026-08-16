"use client"

import { useMemo, useState } from "react"
import { applicableRules, type Applicability, type FilingContext, type StayStatus } from "@/lib/stay/rules"

const TERM_SELECT_STYLE: React.CSSProperties = {
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundColor: "var(--term-input-bg)",
  color: "var(--term-fg)",
  border: "1px solid var(--term-line-strong)",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.65rem center",
  paddingRight: "1.9rem",
}

const STATUS_OPTIONS: { value: StayStatus; label: string }[] = [
  { value: "f1_student", label: "F-1 student (pre-OPT)" },
  { value: "opt", label: "F-1 OPT" },
  { value: "stem_opt", label: "F-1 STEM OPT" },
  { value: "other", label: "Other / not F-1" },
]

const FILING_OPTIONS: { value: FilingContext; label: string }[] = [
  { value: "change_of_status_in_us", label: "Change of status — I'm inside the US" },
  { value: "consular_outside_us", label: "Consular processing — I'm outside the US" },
  { value: "unknown", label: "Not sure yet" },
]

const APPLIC_META: Record<Applicability, { label: string; color: string }> = {
  applies: { label: "Affects you", color: "var(--term-amber-text)" },
  maybe: { label: "Depends", color: "var(--term-dim)" },
  does_not_apply: { label: "Doesn't apply", color: "var(--term-green)" },
}

const selectCls = "w-full px-3 py-2.5 text-[14px] outline-none"

export default function RulesChecker() {
  const [status, setStatus] = useState<StayStatus>("opt")
  const [filingContext, setFilingContext] = useState<FilingContext>("change_of_status_in_us")
  const [capExemptPath, setCapExemptPath] = useState(false)

  const rules = useMemo(
    () => applicableRules({ status, filingContext, capExemptPath }),
    [status, filingContext, capExemptPath]
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      {/* Inputs */}
      <div className="term-panel h-fit p-5">
        <p className="term-label">Your case</p>
        <div className="mt-4 grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Current status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as StayStatus)} style={TERM_SELECT_STYLE} className={selectCls}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">How would your H-1B be filed?</span>
            <select value={filingContext} onChange={(e) => setFilingContext(e.target.value as FilingContext)} style={TERM_SELECT_STYLE} className={selectCls}>
              {FILING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCapExemptPath((v) => !v)}
            aria-pressed={capExemptPath}
            className={[
              "flex items-center justify-between border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors",
              capExemptPath
                ? "border-[#38e08a] bg-[#38e08a]/12 text-[#38e08a]"
                : "border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#ccd6cf]/70 hover:border-[#38e08a]/60",
            ].join(" ")}
          >
            Targeting cap-exempt roles?
            <span>{capExemptPath ? "Yes" : "No"}</span>
          </button>
        </div>
      </div>

      {/* Verdicts */}
      <div className="grid gap-3">
        {rules.map((r) => {
          const meta = APPLIC_META[r.applicability]
          return (
            <div key={r.key} className="term-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-white">{r.title}</h3>
                <span
                  className="shrink-0 border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                  style={{
                    color: meta.color,
                    borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`,
                    background: `color-mix(in srgb, ${meta.color} 9%, transparent)`,
                  }}
                >
                  {meta.label}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#ccd6cf]/75">{r.meaning}</p>
            </div>
          )
        })}
        <p className="text-[12px] leading-relaxed text-[var(--term-dim)]">
          Plain-English guidance modeled from the 2026 rule changes — not legal or immigration advice. Confirm your
          specific case with your DSO or immigration counsel.
        </p>
      </div>
    </div>
  )
}
