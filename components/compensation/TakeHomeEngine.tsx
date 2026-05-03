"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalculateResponse, BreakdownItem } from "@/app/api/compensation/calculate/route"
import type { CompareResponse } from "@/app/api/compensation/compare/route"

// ── Types ────────────────────────────────────────────────────────────────────

type DeductionToggle = "healthcare" | "retirement" | "studentloan" | "commute" | "col"

type CompareOffer = {
  jobTitle: string
  company: string
  annualSalary: string
  location: string
}

type Props = {
  initialSalary?: number
  initialLocation?: string
  initialFilingStatus?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function fmtDollar(n: number): string {
  return `$${fmt(n)}`
}

const BAR_COLORS: Record<BreakdownItem["type"], string> = {
  income:     "bg-emerald-500",
  tax:        "bg-red-400",
  deduction:  "bg-amber-400",
  retirement: "bg-blue-400",
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-[var(--color-border,#E2E8F0)]" />
}

// ── Label ─────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
      {children}
    </p>
  )
}

// ── Waterfall bar row ─────────────────────────────────────────────────────────

function WaterfallRow({ item, isFinal }: { item: BreakdownItem; isFinal: boolean }) {
  const isIncome = item.type === "income"
  return (
    <div className={cn("flex items-center gap-3 py-1.5", isFinal && "pt-3")}>
      <span className={cn(
        "w-44 flex-shrink-0 text-[13px]",
        isFinal ? "font-bold text-emerald-600" : "text-[var(--color-text,#334155)]"
      )}>
        {isFinal ? "Take-home" : item.name}
      </span>
      <div className="flex-1">
        <div
          className={cn("h-2.5", BAR_COLORS[item.type], "transition-[width] duration-500")}
          style={{ width: `${Math.max(1, item.barWidth)}%` }}
        />
      </div>
      <span className={cn(
        "w-20 flex-shrink-0 text-right text-[13px] tabular-nums",
        isFinal ? "font-bold text-emerald-600" : isIncome ? "font-semibold" : "text-[var(--color-text-muted,#64748B)]"
      )}>
        {isIncome ? fmtDollar(item.amount) : `-${fmtDollar(item.amount)}`}
      </span>
    </div>
  )
}

// ── Toggle pill ───────────────────────────────────────────────────────────────

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
        active
          ? "bg-emerald-500 text-white"
          : "border border-[var(--color-border,#E2E8F0)] text-[var(--color-text-muted,#64748B)] hover:border-emerald-300 hover:text-emerald-600"
      )}
    >
      {label}
    </button>
  )
}

// ── Input field ───────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted,#94A3B8)]">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3 py-2 text-sm text-[var(--color-text-strong,#0F172A)] placeholder-[var(--color-text-muted,#94A3B8)] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20"

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 w-40 rounded bg-slate-100" />
          <div className="h-12 w-48 rounded bg-slate-100" />
          <div className="h-3 w-32 rounded bg-slate-100" />
        </div>
        <div className="space-y-1 text-right">
          <div className="h-3 w-24 rounded bg-slate-100" />
          <div className="h-7 w-32 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TakeHomeEngine({
  initialSalary = 0,
  initialLocation = "",
  initialFilingStatus = "single",
}: Props) {
  // ── Inputs
  const [salary, setSalary] = useState(initialSalary ? String(initialSalary) : "")
  const [location, setLocation] = useState(initialLocation)
  const [filingStatus, setFilingStatus] = useState(initialFilingStatus)
  const [healthcare, setHealthcare] = useState("")
  const [retirement, setRetirement] = useState("")
  const [studentLoan, setStudentLoan] = useState("")
  const [commute, setCommute] = useState("")

  // ── Toggles
  const [activeToggles, setActiveToggles] = useState<Set<DeductionToggle>>(new Set())

  // ── Result
  const [result, setResult] = useState<CalculateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // ── Comparison
  const [compareOffers, setCompareOffers] = useState<CompareOffer[]>([])
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null)
  const [showAddCompare, setShowAddCompare] = useState(false)
  const [newOffer, setNewOffer] = useState<CompareOffer>({ jobTitle: "", company: "", annualSalary: "", location: "" })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggle = (t: DeductionToggle) => {
    setActiveToggles((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const calculate = useCallback(async (overrides?: Partial<typeof Object>) => {
    const sal = Number(salary.replace(/,/g, ""))
    if (!sal || sal < 1000) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch("/api/compensation/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annualSalary: sal,
          filingStatus,
          location: location || "Austin, TX",
          healthcarePremium:  activeToggles.has("healthcare")  ? Number(healthcare)  : 0,
          retirement401k:     activeToggles.has("retirement")  ? Number(retirement)  : 0,
          studentLoanPayment: activeToggles.has("studentloan") ? Number(studentLoan) : 0,
          commuteCostMonthly: activeToggles.has("commute")     ? Number(commute)     : 0,
          ...overrides,
        }),
      })
      if (res.ok) setResult(await res.json())
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [salary, filingStatus, location, healthcare, retirement, studentLoan, commute, activeToggles])

  // Debounced recalculate on any input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void calculate() }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [calculate])

  // Run comparison when compareOffers changes
  useEffect(() => {
    if (compareOffers.length === 0) { setCompareResult(null); return }
    const sal = Number(salary.replace(/,/g, ""))
    if (!sal) return
    const allOffers = [
      { jobTitle: "This offer", company: "", annualSalary: sal, location: location || "Austin, TX", filingStatus },
      ...compareOffers.map((o) => ({ ...o, annualSalary: Number(o.annualSalary), filingStatus })),
    ]
    fetch("/api/compensation/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(allOffers),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setCompareResult(d))
      .catch(() => {})
  }, [compareOffers, salary, location, filingStatus])

  const sal = Number(salary.replace(/,/g, ""))
  const hasResult = result && !loading

  return (
    <div className="space-y-7">

      {/* ── Hero row ── */}
      {loading && !result && <Skeleton />}
      {!loading && error && !result && (
        <p className="text-sm text-red-500">Could not calculate — check your inputs.</p>
      )}
      {(hasResult || (loading && result)) && result && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
              Your actual monthly take-home
            </p>
            <p
              className="text-[48px] font-black leading-none tabular-nums"
              style={{ color: "#1D9E75" }}
            >
              {fmtDollar(result.monthlyNet)}
            </p>
            <p className="mt-1.5 text-[12px] text-[var(--color-text-muted,#64748B)]">
              {result.location.city || "US"} · {filingStatus.replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
              Gross salary
            </p>
            <p className="text-[22px] font-bold text-[var(--color-text-strong,#0F172A)]">
              {fmtDollar(sal)}
            </p>
            <p className="mt-1 text-[12px] text-red-500">
              −{fmtDollar(sal - result.monthlyNet * 12)} / yr taken out
            </p>
          </div>
        </div>
      )}
      {!sal && !loading && (
        <p className="text-[15px] text-[var(--color-text-muted,#94A3B8)]">
          Enter a salary below to see your real take-home.
        </p>
      )}

      <Divider />

      {/* ── Waterfall ── */}
      {hasResult && result.breakdown.length > 0 && (
        <div className="space-y-1">
          <SectionLabel>Where your money goes · monthly</SectionLabel>
          <div className="mt-3 divide-y divide-[var(--color-border,#E2E8F0)]">
            {result.breakdown.map((item, i) => (
              <WaterfallRow key={item.name} item={item} isFinal={false} />
            ))}
          </div>
          <Divider />
          {/* Take-home final row */}
          <WaterfallRow
            item={{
              name: "Take-home",
              amount: result.monthlyNet,
              type: "income",
              barWidth: Math.round((result.monthlyNet / result.monthlyGross) * 100),
            }}
            isFinal
          />
        </div>
      )}

      {hasResult && <Divider />}

      {/* ── Comparison ── */}
      {compareResult && compareResult.offers.length > 1 && (
        <>
          <div className="space-y-4">
            <SectionLabel>Comparing offers</SectionLabel>
            <div className="flex divide-x divide-[var(--color-border,#E2E8F0)]">
              {compareResult.offers.map((offer, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex-1 px-4 py-3 first:pl-0 last:pr-0",
                    offer.isWinner && "bg-emerald-50/60"
                  )}
                >
                  {offer.isWinner && (
                    <span className="mb-1.5 inline-block text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                      Winner
                    </span>
                  )}
                  <p className="truncate text-[13px] font-semibold text-[var(--color-text-strong,#0F172A)]">
                    {offer.jobTitle}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-text-muted,#64748B)]">
                    {offer.company}{offer.location ? ` · ${offer.location}` : ""}
                  </p>
                  <p className="mt-2 text-[26px] font-black tabular-nums" style={{ color: "#1D9E75" }}>
                    {fmtDollar(offer.monthlyNet)}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted,#64748B)]">
                    {fmtDollar(offer.annualSalary)} gross
                  </p>
                  {!offer.isWinner && offer.monthlyDifference > 0 && (
                    <p className="mt-1 text-[11px] font-semibold text-red-500">
                      ↓ {fmtDollar(offer.monthlyDifference)}/mo less in pocket
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Divider />
        </>
      )}

      {/* ── Inputs ── */}
      <div className="space-y-5">
        <SectionLabel>Adjust your numbers</SectionLabel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Base salary">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted,#94A3B8)]">$</span>
              <input
                type="number"
                placeholder="120000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className={cn(inputCls, "pl-7")}
              />
            </div>
          </Field>

          <Field label="Filing status">
            <div className="relative">
              <select
                value={filingStatus}
                onChange={(e) => setFilingStatus(e.target.value)}
                className={cn(inputCls, "appearance-none pr-8")}
              >
                <option value="single">Single</option>
                <option value="married_jointly">Married (jointly)</option>
                <option value="head_of_household">Head of household</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </Field>

          <Field label="Job location">
            <input
              type="text"
              placeholder="San Francisco, CA"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Monthly 401(k)">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted,#94A3B8)]">$</span>
              <input
                type="number"
                placeholder="0"
                value={retirement}
                onChange={(e) => { setRetirement(e.target.value); if (!activeToggles.has("retirement") && e.target.value) toggle("retirement") }}
                className={cn(inputCls, "pl-7")}
                disabled={!activeToggles.has("retirement")}
              />
            </div>
          </Field>
        </div>

        {/* Toggle pills */}
        <div className="flex flex-wrap gap-2">
          {([
            { key: "healthcare",  label: "Healthcare" },
            { key: "retirement",  label: "401(k)" },
            { key: "studentloan", label: "Student loans" },
            { key: "commute",     label: "Commute cost" },
            { key: "col",         label: "Cost of living" },
          ] as { key: DeductionToggle; label: string }[]).map(({ key, label }) => (
            <TogglePill
              key={key}
              label={label}
              active={activeToggles.has(key)}
              onClick={() => toggle(key)}
            />
          ))}
        </div>

        {/* Expanded deduction inputs */}
        {activeToggles.size > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {activeToggles.has("healthcare") && (
              <Field label="Healthcare premium / mo">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input type="number" placeholder="250" value={healthcare} onChange={(e) => setHealthcare(e.target.value)} className={cn(inputCls, "pl-7")} />
                </div>
              </Field>
            )}
            {activeToggles.has("studentloan") && (
              <Field label="Student loan / mo">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input type="number" placeholder="400" value={studentLoan} onChange={(e) => setStudentLoan(e.target.value)} className={cn(inputCls, "pl-7")} />
                </div>
              </Field>
            )}
            {activeToggles.has("commute") && (
              <Field label="Commute cost / mo">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input type="number" placeholder="150" value={commute} onChange={(e) => setCommute(e.target.value)} className={cn(inputCls, "pl-7")} />
                </div>
              </Field>
            )}
          </div>
        )}
      </div>

      <Divider />

      {/* ── Add comparison offer ── */}
      {showAddCompare && (
        <div className="space-y-3">
          <SectionLabel>Add comparison offer</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Job title"><input type="text" placeholder="Senior Engineer" value={newOffer.jobTitle} onChange={(e) => setNewOffer((p) => ({ ...p, jobTitle: e.target.value }))} className={inputCls} /></Field>
            <Field label="Company"><input type="text" placeholder="Acme Corp" value={newOffer.company} onChange={(e) => setNewOffer((p) => ({ ...p, company: e.target.value }))} className={inputCls} /></Field>
            <Field label="Annual salary">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                <input type="number" placeholder="130000" value={newOffer.annualSalary} onChange={(e) => setNewOffer((p) => ({ ...p, annualSalary: e.target.value }))} className={cn(inputCls, "pl-7")} />
              </div>
            </Field>
            <Field label="Location"><input type="text" placeholder="Austin, TX" value={newOffer.location} onChange={(e) => setNewOffer((p) => ({ ...p, location: e.target.value }))} className={inputCls} /></Field>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!newOffer.annualSalary) return
                setCompareOffers((p) => [...p, newOffer].slice(0, 2))
                setNewOffer({ jobTitle: "", company: "", annualSalary: "", location: "" })
                setShowAddCompare(false)
              }}
              className="rounded-lg bg-[var(--color-text-strong,#0F172A)] px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
            >
              Add offer
            </button>
            <button type="button" onClick={() => setShowAddCompare(false)} className="rounded-lg border border-[var(--color-border,#E2E8F0)] px-4 py-2 text-[12px] font-semibold text-[var(--color-text-muted,#64748B)] transition hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">
          Tax brackets updated April 2025 · IRS + state sources
        </p>
        {compareOffers.length < 2 && (
          <button
            type="button"
            onClick={() => setShowAddCompare(true)}
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--color-text-strong,#0F172A)] hover:underline"
          >
            <Plus className="h-3 w-3" />
            Compare another offer
          </button>
        )}
      </div>
    </div>
  )
}
