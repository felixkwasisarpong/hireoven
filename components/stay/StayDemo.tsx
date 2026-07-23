"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { computeLotteryOdds, nextLevelTarget, WAGE_LEVEL_META, type WageLevel } from "@/lib/stay/lottery-odds"
import type { StayScoreResult, StayTone } from "@/lib/stay/stay-score"
import type { PrevailingWageBands } from "@/lib/stay/wage-level-query"
import { checkEmployerStay, modeledBandsFor } from "@/app/(public)/stay/actions"

// Inlined so a native <select> can't win and a stale external stylesheet can't
// leave it looking like an unstyled OS control (appearance:none is the fix).
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

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
] as const

const ARC_LEN = 298
const SAL_MIN = 55_000
const SAL_MAX = 185_000

const TONE_COLOR: Record<StayTone, string> = {
  good: "#38e08a",
  warn: "#f5a623",
  crit: "#e5695f",
  brand: "#5b9bff",
  neutral: "#6c7a72",
}

function fmtUsd(n: number): string {
  return "$" + n.toLocaleString()
}

function oddsColor(pct: number): string {
  return pct < 20 ? "#e5695f" : pct < 40 ? "#f5a623" : "#38e08a"
}

export default function StayDemo({
  capExemptRoles,
  roleOptions = [],
}: {
  capExemptRoles: number
  roleOptions?: { socGroup: string; label: string }[]
}) {
  const [isStem, setIsStem] = useState(true)
  const [salary, setSalary] = useState(78_000)
  const [socGroup, setSocGroup] = useState("")
  const [stateAbbr, setStateAbbr] = useState("")
  const [bands, setBands] = useState<PrevailingWageBands | null>(null)
  const [bandsPending, startBands] = useTransition()

  // Fetch real local wage cutoffs when both a role and a state are chosen.
  useEffect(() => {
    if (!socGroup || !stateAbbr) {
      setBands(null)
      return
    }
    startBands(async () => {
      const res = await modeledBandsFor({ socGroup, stateAbbr })
      setBands(res)
    })
  }, [socGroup, stateAbbr])

  const modeledBands = bands?.bands ?? null
  const odds = useMemo(
    () => computeLotteryOdds({ salary, isStem, prevailingWageBands: modeledBands }) ?? null,
    [salary, isStem, modeledBands]
  )
  const raise = useMemo(
    () => nextLevelTarget({ salary, isStem, prevailingWageBands: modeledBands }),
    [salary, isStem, modeledBands]
  )
  const single = odds?.singleDrawPct ?? 0
  const cumulative = odds?.cumulativePct ?? 0
  const level = (odds?.level ?? 1) as WageLevel
  const arcOffset = ARC_LEN - (ARC_LEN * single) / 100
  const salPct = ((salary - SAL_MIN) / (SAL_MAX - SAL_MIN)) * 100

  return (
    <div className="term-panel p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr] lg:items-center">
        {/* Your situation */}
        <div>
          <p className="term-label">&gt; your_situation</p>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[13px] font-medium text-[#ccd6cf]/80">
              <span>Degree type</span>
              <span className="text-white">{isStem ? "STEM" : "Non-STEM"}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { label: "STEM (36mo OPT)", val: true },
                { label: "Non-STEM (12mo)", val: false },
              ].map((o) => (
                <button
                  key={String(o.val)}
                  type="button"
                  onClick={() => setIsStem(o.val)}
                  aria-pressed={isStem === o.val}
                  className={[
                    "border px-3 py-2.5 text-[13px] font-semibold transition-colors",
                    isStem === o.val
                      ? "border-[#38e08a] bg-[#38e08a]/12 text-[#38e08a]"
                      : "border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#ccd6cf]/70 hover:border-[#38e08a]/60",
                  ].join(" ")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-[13px] font-medium text-[#ccd6cf]/80">
              <span>Target starting salary</span>
              <span className="text-white tabular-nums">{fmtUsd(salary)}</span>
            </div>
            <input
              type="range"
              min={SAL_MIN}
              max={SAL_MAX}
              step={1000}
              value={salary}
              onChange={(e) => setSalary(Number(e.target.value))}
              aria-label="Target starting salary"
              className="stay-range mt-3 w-full"
              style={{ ["--pct" as string]: `${salPct}%` }}
            />
          </div>

          {roleOptions.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#ccd6cf]/70">Refine with a real role + location</span>
                {socGroup && stateAbbr && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: bandsPending ? "#6c7a72" : bands ? "#38e08a" : "#f5a623" }}
                  >
                    {bandsPending ? "modeling…" : bands ? `modeled · ${bands.sampleSize.toLocaleString()} filings` : "national estimate"}
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={socGroup}
                  onChange={(e) => setSocGroup(e.target.value)}
                  aria-label="Role"
                  style={TERM_SELECT_STYLE}
                  className="term-select min-w-0 px-2.5 py-2 font-mono text-[13px] outline-none"
                >
                  <option value="">Any role</option>
                  {roleOptions.map((r) => (
                    <option key={r.socGroup} value={r.socGroup}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  value={stateAbbr}
                  onChange={(e) => setStateAbbr(e.target.value)}
                  aria-label="State"
                  style={TERM_SELECT_STYLE}
                  className="term-select px-2.5 py-2 font-mono text-[13px] outline-none"
                >
                  <option value="">State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <p className="mt-4 text-[12.5px] leading-relaxed text-[#ccd6cf]/55">
            A {fmtUsd(salary)} offer is a DOL{" "}
            <span className="text-white">{WAGE_LEVEL_META[level].label}</span> wage
            {bands ? " (local data)" : ""} — single-draw odds{" "}
            <span style={{ color: oddsColor(single) }}>{single}%</span>.{" "}
            {isStem ? "STEM gives ~3 lottery cycles" : "Non-STEM gives ~1 cycle"}, so your multi-year odds land near{" "}
            <span style={{ color: oddsColor(cumulative) }}>{cumulative}%</span>.
          </p>

          {raise ? (
            <div className="mt-4 border border-[#f5a623]/30 bg-[#f5a623]/[0.07] p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#f5a623]">↑ raise your odds</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#ccd6cf]/80">
                A <span className="text-white tabular-nums">{fmtUsd(raise.salaryNeeded)}</span> offer reaches{" "}
                <span className="text-white">{raise.nextLevelLabel}</span> — lifting each draw{" "}
                <span className="text-[#38e08a]">{raise.currentSingleDrawPct}% → {raise.nextSingleDrawPct}%</span>
                {raise.salaryGap > 0 && <> (just {fmtUsd(raise.salaryGap)} more)</>}. Negotiating up, or targeting a
                higher-band title, literally buys you better odds.
              </p>
            </div>
          ) : (
            <div className="mt-4 border border-[#38e08a]/30 bg-[#38e08a]/[0.07] p-3">
              <p className="text-[12.5px] leading-relaxed text-[#ccd6cf]/80">
                <span className="font-semibold text-[#38e08a]">Level IV — top of the stack.</span> At this wage your draw
                odds are as high as the weighted lottery gives.
              </p>
            </div>
          )}
        </div>

        {/* Gauge */}
        <div className="flex flex-col items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5">
          <div className="relative h-[150px] w-[230px]">
            <svg width="230" height="150" viewBox="0 0 230 150" aria-hidden>
              <path d="M20 140 A95 95 0 0 1 210 140" fill="none" stroke="rgba(120,200,160,0.14)" strokeWidth="16" strokeLinecap="round" />
              <path
                d="M20 140 A95 95 0 0 1 210 140"
                fill="none"
                stroke={oddsColor(single)}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={ARC_LEN}
                strokeDashoffset={arcOffset}
                style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.7,.2,1), stroke .3s" }}
              />
            </svg>
            <div
              className="absolute inset-x-0 text-center text-[46px] font-semibold tabular-nums"
              style={{ top: 70, color: oddsColor(single) }}
            >
              {single}%
            </div>
            <div className="absolute inset-x-0 text-center text-[11px] uppercase tracking-[0.08em] text-[#6c7a72]" style={{ top: 124 }}>
              H-1B odds / draw
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[13px] text-[#ccd6cf]/70">
            old lottery: <s className="text-[#6c7a72]">~{odds?.legacySingleDrawPct ?? 35}%</s>
            <span className="font-bold text-[#e5695f]">→</span>
            <span style={{ color: oddsColor(single) }}>{single}% now</span>
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {([1, 2, 3, 4] as WageLevel[]).map((lv) => (
              <span
                key={lv}
                className={[
                  "border px-2 py-1 text-[11px] font-semibold tabular-nums",
                  lv === level
                    ? "border-[#f5a623]/50 bg-[#f5a623]/12 text-[#f5a623]"
                    : "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#6c7a72]",
                ].join(" ")}
              >
                L{lv} · {Math.round(WAGE_LEVEL_META[lv].singleDrawOdds * 100)}%
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* escape hatch + checker */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <CapExemptCounter roles={capExemptRoles} />
        <JobChecker salary={salary} isStem={isStem} />
      </div>
    </div>
  )
}

function CapExemptCounter({ roles }: { roles: number }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)
  const started = useRef(false)
  const target = roles > 0 ? roles : 43_000

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !started.current) {
        started.current = true
        const dur = 1400
        const t0 = performance.now()
        const step = (t: number) => {
          const p = Math.min(1, (t - t0) / dur)
          const eased = 1 - Math.pow(1 - p, 3)
          setDisplay(Math.round(target * eased))
          if (p < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [target])

  return (
    <div ref={ref} className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
      <div className="flex items-baseline gap-1 text-[30px] font-semibold tabular-nums text-[#38e08a]">
        {display.toLocaleString()}<span className="text-[20px]">+</span>
      </div>
      <p className="mt-1 text-[13px] text-[#ccd6cf]/70">
        open roles that <span className="text-white">skip the lottery entirely</span>
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6c7a72]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#38e08a]" aria-hidden />
        universities · research nonprofits · hospitals · national labs
      </p>
    </div>
  )
}

function JobChecker({ salary, isStem }: { salary: number; isStem: boolean }) {
  const [query, setQuery] = useState("")
  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof checkEmployerStay>> | null>(null)
  const [pending, startTransition] = useTransition()

  const run = useCallback(
    (q: string) => {
      const value = q.trim()
      if (!value) return
      setQuery(value)
      startTransition(async () => {
        const res = await checkEmployerStay({ query: value, salary, isStem })
        setLookup(res)
      })
    },
    [salary, isStem]
  )

  const result: StayScoreResult | null = lookup?.result ?? null

  return (
    <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
      <p className="term-label">&gt; paste any job or type a company</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(query)}
          placeholder="e.g. Stanford, Google, Mayo Clinic…"
          className="min-w-0 flex-1 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-2.5 font-mono text-[14px] text-[#ccd6cf] outline-none placeholder:text-[#6c7a72] focus:border-[#38e08a]"
        />
        <button type="button" onClick={() => run(query)} disabled={pending} className="term-btn term-btn-amber justify-center disabled:opacity-60">
          {pending ? "scoring…" : "Score it"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Stanford University", "Google", "Mayo Clinic", "a 12-person startup"].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => run(c)}
            className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2.5 py-1 text-[12px] text-[#ccd6cf]/70 transition hover:border-[#38e08a] hover:text-[#38e08a]"
          >
            {c}
          </button>
        ))}
      </div>

      {result && (
        <div className="mt-4 border-t border-[rgba(120,200,160,0.12)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-white">
                {lookup?.name}
                {lookup && !lookup.found && <span className="text-[#6c7a72]"> · unrated</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className="text-[34px] font-semibold tabular-nums"
                style={{ color: TONE_COLOR[result.badgeTone] }}
              >
                {result.score}
              </span>
              <span
                className="border px-2 py-1 text-[11px] font-semibold"
                style={{
                  color: TONE_COLOR[result.badgeTone],
                  borderColor: TONE_COLOR[result.badgeTone] + "66",
                  background: TONE_COLOR[result.badgeTone] + "18",
                }}
              >
                {result.band}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            {result.bars.map((b) => (
              <div key={b.key} className="grid grid-cols-[minmax(120px,170px)_1fr_auto] items-center gap-3 text-[13px]">
                <span className="text-[#ccd6cf]/70">{b.key}</span>
                <span className="h-2 overflow-hidden bg-[#0e1411]">
                  <span
                    className="block h-2 transition-[width] duration-500"
                    style={{ width: `${b.value}%`, background: TONE_COLOR[b.tone] }}
                  />
                </span>
                <span className="w-9 text-right tabular-nums text-[#ccd6cf]/70">{b.value}</span>
              </div>
            ))}
          </div>

          <p className="mt-4 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-3 text-[13px] leading-relaxed text-[#ccd6cf]/80">
            {result.verdict}
          </p>
        </div>
      )}
    </div>
  )
}
