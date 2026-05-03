import { NextRequest, NextResponse } from "next/server"
import { calculateTax, type FilingStatus } from "@/lib/compensation/tax-engine"
import { applyDeductions } from "@/lib/compensation/deductions-engine"
import { adjustSalaryForCOL, hasColData } from "@/lib/compensation/col-adjuster"

export const runtime = "nodejs"

type CalculateBody = {
  annualSalary: number
  filingStatus?: string
  location?: string          // "City, ST" format
  healthcarePremium?: number
  retirement401k?: number    // monthly
  studentLoanPayment?: number
  commuteCostMonthly?: number
  includeColAdjustment?: boolean
  colCompareCity?: string
}

export type BreakdownItem = {
  name: string
  amount: number
  type: "income" | "tax" | "deduction" | "retirement"
  barWidth: number           // percentage of gross (0–100)
}

export type CalculateResponse = {
  monthlyGross: number
  monthlyNet: number
  annualNet: number
  effectiveTaxRate: number
  totalMonthlyDeductions: number
  breakdown: BreakdownItem[]
  colAdjustedSalary?: number
  location: { city: string; stateCode: string }
}

function parseLocation(raw: string): { city: string; stateCode: string } {
  const parts = raw.split(",").map((p) => p.trim())
  const city = parts[0] ?? ""
  const stateCode = (parts[1] ?? "").toUpperCase().slice(0, 2)
  return { city, stateCode: stateCode || "TX" }
}

function isValidFilingStatus(s: string): s is FilingStatus {
  return s === "single" || s === "married_jointly" || s === "head_of_household"
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as CalculateBody

  const annualSalary = Number(body.annualSalary ?? 0)
  if (!Number.isFinite(annualSalary) || annualSalary <= 0) {
    return NextResponse.json({ error: "annualSalary must be a positive number" }, { status: 400 })
  }

  const filingStatus: FilingStatus = isValidFilingStatus(body.filingStatus ?? "")
    ? (body.filingStatus as FilingStatus)
    : "single"

  const { city, stateCode } = parseLocation(body.location ?? ", TX")
  const retirement401kMonthly = Number(body.retirement401k ?? 0)
  const preTax401kAnnual = retirement401kMonthly * 12

  const taxResult = calculateTax({
    annualSalary,
    filingStatus,
    stateCode,
    city,
    preTax401kAnnual,
  })

  const deductions = applyDeductions(taxResult, {
    retirement401kMonthly,
    healthcarePremium:    Number(body.healthcarePremium    ?? 0),
    studentLoanPayment:   Number(body.studentLoanPayment   ?? 0),
    commuteCostMonthly:   Number(body.commuteCostMonthly   ?? 0),
  })

  const gross = deductions.monthlyGross
  const breakdown: BreakdownItem[] = deductions.lineItems.map((item) => ({
    name: item.name,
    amount: Math.abs(item.amount),
    type: item.type,
    barWidth: gross > 0 ? Math.round((Math.abs(item.amount) / gross) * 100) : 0,
  }))

  let colAdjustedSalary: number | undefined
  if (body.includeColAdjustment && body.colCompareCity && city) {
    if (hasColData(city) || hasColData(body.colCompareCity)) {
      colAdjustedSalary = adjustSalaryForCOL(annualSalary, city, body.colCompareCity)
    }
  }

  return NextResponse.json({
    monthlyGross: deductions.monthlyGross,
    monthlyNet: deductions.monthlyTakeHome,
    annualNet: deductions.monthlyTakeHome * 12,
    effectiveTaxRate: taxResult.effectiveRate,
    totalMonthlyDeductions: deductions.totalDeductions,
    breakdown,
    ...(colAdjustedSalary !== undefined ? { colAdjustedSalary } : {}),
    location: { city, stateCode },
  } satisfies CalculateResponse)
}
