"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { calculateOptTimelineDashboard } from "@/lib/immigration/opt-timeline"
import { computeLotteryOdds, cumulativeOdds, remainingCapSeasons, WAGE_LEVEL_META } from "@/lib/stay/lottery-odds"
import type {
  OptTimelineEmploymentStatus,
  OptTimelineFallbackCategory,
  OptTimelineImmigrationStatus,
  OptTimelineUrgencyLevel,
} from "@/types"

const URGENCY_TONE: Record<OptTimelineUrgencyLevel, string> = {
  Low: "#38e08a",
  Medium: "#f5a623",
  High: "#f5a623",
  Emergency: "#e5695f",
}

const FALLBACK_LABEL: Record<OptTimelineFallbackCategory, { label: string; href?: string }> = {
  sponsor_friendly_employers: { label: "Apply to proven sponsor-friendly employers", href: "/find" },
  university_or_cap_exempt_roles: { label: "Add cap-exempt (lottery-free) roles to your list", href: "/h1b-sponsors/cap-exempt" },
  e_verified_employers: { label: "Target E-Verify employers (STEM-OPT eligible)", href: "/h1b-sponsors/e-verify" },
  contract_or_temp_roles: { label: "Consider contract / temp roles to keep status active" },
  staffing_or_consulting_firms: { label: "Talk to staffing / consulting firms that sponsor volume" },
  bridge_education_options: { label: "Research bridge-education options as a backstop" },
  dso_or_immigration_review: { label: "Book a check-in with your DSO / immigration counsel" },
  non_visa_sensitive_roles: { label: "Broaden to non–visa-sensitive roles" },
}

const STATUS_OPTIONS: { value: OptTimelineImmigrationStatus; label: string }[] = [
  { value: "F1_OPT", label: "F-1 OPT" },
  { value: "F1_STEM_OPT", label: "F-1 STEM OPT" },
]

const EMPLOYMENT_OPTIONS: { value: OptTimelineEmploymentStatus; label: string }[] = [
  { value: "unemployed", label: "Job searching" },
  { value: "offer_accepted", label: "Offer accepted" },
  { value: "employed", label: "Employed" },
  { value: "not_started", label: "Not started yet" },
]

function labelField(label: string, node: React.ReactNode) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">{label}</span>
      {node}
    </label>
  )
}

const inputCls =
  "w-full border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-3 py-2.5 font-mono text-[14px] text-[#ccd6cf] outline-none focus:border-[#38e08a]"

// Inlined so a native <select> can't render as an unstyled OS control regardless
// of external-stylesheet state (appearance:none is the fix).
const TERM_SELECT_STYLE: React.CSSProperties = {
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundColor: "#0a0e0c",
  color: "#ccd6cf",
  border: "1px solid rgba(120,200,160,0.2)",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ccd6cf' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.65rem center",
  paddingRight: "1.9rem",
}

export default function TimelineCopilot() {
  const [status, setStatus] = useState<OptTimelineImmigrationStatus>("F1_STEM_OPT")
  const [endDate, setEndDate] = useState("")
  const [unemployedDays, setUnemployedDays] = useState("")
  const [employment, setEmployment] = useState<OptTimelineEmploymentStatus>("unemployed")
  const [salary, setSalary] = useState(78_000)

  const isStem = status === "F1_STEM_OPT"

  const view = useMemo(() => {
    const dashboard = calculateOptTimelineDashboard({
      immigrationStatus: status,
      optStartDate: null,
      optEndDate: status === "F1_OPT" ? endDate || null : null,
      stemOptStartDate: null,
      stemOptEndDate: status === "F1_STEM_OPT" ? endDate || null : null,
      unemploymentDaysUsed: unemployedDays === "" ? null : Number(unemployedDays),
      currentEmploymentStatus: employment,
      targetWeeklyApplicationGoal: null,
      manualOverrides: null,
    })

    const asOf = new Date()
    const seasons = remainingCapSeasons({ asOf, runwayEndISO: endDate || null })
    const odds = computeLotteryOdds({ salary, isStem })
    const cumulativeOverRunway =
      odds && seasons > 0 ? Math.round(cumulativeOdds(odds.singleDrawPct / 100, seasons) * 100) : odds?.singleDrawPct ?? null

    return { dashboard, seasons, odds, cumulativeOverRunway }
  }, [status, endDate, unemployedDays, employment, salary, isStem])

  const { dashboard, seasons, odds, cumulativeOverRunway } = view
  const urgencyColor = URGENCY_TONE[dashboard.urgencyLevel]

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      {/* Inputs */}
      <div className="term-panel h-fit p-5">
        <p className="term-label">&gt; your_clock</p>
        <div className="mt-4 grid gap-4">
          {labelField(
            "Current status",
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatus(o.value)}
                  aria-pressed={status === o.value}
                  className={[
                    "border px-3 py-2 text-[13px] font-semibold transition-colors",
                    status === o.value
                      ? "border-[#38e08a] bg-[#38e08a]/12 text-[#38e08a]"
                      : "border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#ccd6cf]/70 hover:border-[#38e08a]/60",
                  ].join(" ")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {labelField(
            `${isStem ? "STEM OPT" : "OPT"} end date`,
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          )}
          {labelField(
            "Unemployment days used",
            <input
              type="number"
              min={0}
              max={isStem ? 150 : 90}
              value={unemployedDays}
              onChange={(e) => setUnemployedDays(e.target.value)}
              placeholder={`0 of ${isStem ? 150 : 90} allowed`}
              className={inputCls}
            />
          )}
          {labelField(
            "Where you are",
            <select
              value={employment}
              onChange={(e) => setEmployment(e.target.value as OptTimelineEmploymentStatus)}
              style={TERM_SELECT_STYLE}
              className="term-select w-full px-3 py-2.5 font-mono text-[14px] outline-none"
            >
              {EMPLOYMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {labelField(
            `Target salary — ${"$" + salary.toLocaleString()}`,
            <input
              type="range"
              min={55_000}
              max={185_000}
              step={1000}
              value={salary}
              onChange={(e) => setSalary(Number(e.target.value))}
              className="stay-range w-full"
              style={{ ["--pct" as string]: `${((salary - 55_000) / (185_000 - 55_000)) * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* Readout */}
      <div className="grid gap-4">
        {/* Urgency + clock */}
        <div className="term-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="term-label">&gt; runway_status</p>
            <span
              className="border px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: urgencyColor, borderColor: urgencyColor + "66", background: urgencyColor + "18" }}
            >
              {dashboard.urgencyLevel}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)]">
            <Metric value={dashboard.daysRemaining} label="days of work auth left" />
            <Metric value={dashboard.estimatedUnemploymentDaysRemaining} label="unemployment days left" />
            <Metric value={seasons} label="H-1B draws left in runway" plain />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[#ccd6cf]/70">{dashboard.recommendedJobSearchStrategy}</p>
        </div>

        {/* Lottery math against the runway */}
        {odds && (
          <div className="term-panel p-5">
            <p className="term-label">&gt; your_lottery_math</p>
            <p className="mt-3 text-[14px] leading-relaxed text-[#ccd6cf]/80">
              At <span className="text-white">${salary.toLocaleString()}</span> ({WAGE_LEVEL_META[odds.level].label}), each
              draw is <span style={{ color: odds.singleDrawPct < 20 ? "#e5695f" : odds.singleDrawPct < 40 ? "#f5a623" : "#38e08a" }}>{odds.singleDrawPct}%</span>.{" "}
              {seasons > 0 ? (
                <>
                  You can register in <span className="text-white">{seasons}</span> more March{seasons === 1 ? "" : "s"} before your
                  runway ends → roughly{" "}
                  <span style={{ color: (cumulativeOverRunway ?? 0) < 25 ? "#e5695f" : (cumulativeOverRunway ?? 0) < 45 ? "#f5a623" : "#38e08a" }}>
                    {cumulativeOverRunway}%
                  </span>{" "}
                  cumulative odds across them.
                </>
              ) : (
                <span className="text-[#e5695f]"> Your runway ends before the next registration — a cap-subject H-1B can&apos;t finish in time. Prioritize cap-exempt roles.</span>
              )}
            </p>
          </div>
        )}

        {/* What to do this week */}
        <div className="term-panel p-5">
          <p className="term-label">&gt; what_to_do_this_week</p>
          <p className="mt-2 text-[13px] text-[#ccd6cf]/60">
            Aim for <span className="text-white">{dashboard.recommendedWeeklyApplicationTarget}</span> targeted applications this week.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {dashboard.recommendedFallbackCategories.map((cat) => {
              const item = FALLBACK_LABEL[cat]
              return (
                <li key={cat} className="flex items-start gap-2.5 text-[13.5px] text-[#ccd6cf]/80">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-[#f5a623]" aria-hidden />
                  {item.href ? (
                    <Link href={item.href} className="text-[#ccd6cf] underline decoration-[#f5a623]/40 underline-offset-4 hover:text-[#f5a623] hover:decoration-[#f5a623]">
                      {item.label}
                    </Link>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        {(dashboard.warnings.length > 0 || dashboard.dataGaps.length > 0) && (
          <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
            {dashboard.dataGaps.map((g) => (
              <p key={g} className="text-[12px] text-[#6c7a72]">
                <span className="text-[#f5a623]">·</span> {g}
              </p>
            ))}
            {dashboard.warnings.map((w) => (
              <p key={w} className="text-[12px] text-[#f5a623]/80">
                <span>!</span> {w}
              </p>
            ))}
          </div>
        )}

        <p className="text-[12px] leading-relaxed text-[#6c7a72]">{dashboard.disclaimer}</p>
      </div>
    </div>
  )
}

function Metric({ value, label, plain }: { value: number | null; label: string; plain?: boolean }) {
  return (
    <div className="bg-[#0e1411] p-3.5">
      <p className={["text-[26px] font-semibold leading-none tabular-nums", plain ? "text-white" : "text-[#38e08a]"].join(" ")}>
        {value == null ? "—" : value}
      </p>
      <p className="mt-1.5 text-[11px] leading-tight text-[#6c7a72]">{label}</p>
    </div>
  )
}
