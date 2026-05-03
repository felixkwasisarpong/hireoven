import { NextRequest, NextResponse } from "next/server"
import { calculateTax, type FilingStatus } from "@/lib/compensation/tax-engine"
import { applyDeductions } from "@/lib/compensation/deductions-engine"

export const runtime = "nodejs"

type OfferInput = {
  jobTitle?: string
  company?: string
  annualSalary: number
  location?: string
  filingStatus?: string
  healthcarePremium?: number
  retirement401k?: number
  studentLoanPayment?: number
  commuteCostMonthly?: number
}

export type ComparedOffer = {
  jobTitle: string
  company: string
  location: string
  annualSalary: number
  monthlyGross: number
  monthlyNet: number
  annualNet: number
  effectiveTaxRate: number
  isWinner: boolean
  monthlyDifference: number   // vs winner (0 for winner itself)
}

export type CompareResponse = {
  offers: ComparedOffer[]
  winnerIndex: number
}

function parseLocation(raw = ""): { city: string; stateCode: string } {
  const parts = raw.split(",").map((p) => p.trim())
  return { city: parts[0] ?? "", stateCode: (parts[1] ?? "TX").toUpperCase().slice(0, 2) }
}

function isValidFilingStatus(s: string): s is FilingStatus {
  return s === "single" || s === "married_jointly" || s === "head_of_household"
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => []) as OfferInput[]

  if (!Array.isArray(body) || body.length < 1 || body.length > 3) {
    return NextResponse.json({ error: "Provide 1–3 offer objects" }, { status: 400 })
  }

  const results: ComparedOffer[] = body.map((offer) => {
    const annualSalary = Number(offer.annualSalary ?? 0)
    const filingStatus: FilingStatus = isValidFilingStatus(offer.filingStatus ?? "")
      ? (offer.filingStatus as FilingStatus)
      : "single"
    const { city, stateCode } = parseLocation(offer.location)
    const retirement401kMonthly = Number(offer.retirement401k ?? 0)

    const taxResult = calculateTax({
      annualSalary,
      filingStatus,
      stateCode,
      city,
      preTax401kAnnual: retirement401kMonthly * 12,
    })

    const deductions = applyDeductions(taxResult, {
      retirement401kMonthly,
      healthcarePremium:  Number(offer.healthcarePremium  ?? 0),
      studentLoanPayment: Number(offer.studentLoanPayment ?? 0),
      commuteCostMonthly: Number(offer.commuteCostMonthly ?? 0),
    })

    return {
      jobTitle:        offer.jobTitle   ?? "Role",
      company:         offer.company    ?? "Company",
      location:        offer.location   ?? "",
      annualSalary,
      monthlyGross:    deductions.monthlyGross,
      monthlyNet:      deductions.monthlyTakeHome,
      annualNet:       deductions.monthlyTakeHome * 12,
      effectiveTaxRate: taxResult.effectiveRate,
      isWinner:        false,
      monthlyDifference: 0,
    }
  })

  // Rank by monthly net, mark winner
  const sorted = [...results].sort((a, b) => b.monthlyNet - a.monthlyNet)
  const winnerNet = sorted[0].monthlyNet
  results.forEach((o) => {
    o.isWinner = o.monthlyNet === winnerNet
    o.monthlyDifference = winnerNet - o.monthlyNet
  })
  const winnerIndex = results.findIndex((o) => o.isWinner)

  return NextResponse.json({ offers: results, winnerIndex } satisfies CompareResponse)
}
