import type { TaxResult } from "./tax-engine"

export type DeductionInputs = {
  /** Monthly pre-tax 401k contribution (used in tax engine — passed through for display) */
  retirement401kMonthly?: number
  /** Monthly employee healthcare premium (post-tax deduction) */
  healthcarePremium?: number
  /** Monthly student loan payment (post-tax deduction) */
  studentLoanPayment?: number
  /** Monthly commute cost (post-tax deduction) */
  commuteCostMonthly?: number
}

export type DeductionLineItem = {
  name: string
  amount: number
  type: "income" | "tax" | "deduction" | "retirement"
}

export type DeductionsResult = {
  monthlyGross: number
  federal: number
  state: number
  local: number
  fica: number
  retirement401k: number
  healthcare: number
  studentLoan: number
  commute: number
  totalDeductions: number
  monthlyTakeHome: number
  lineItems: DeductionLineItem[]
}

export function applyDeductions(taxResult: TaxResult, inputs: DeductionInputs = {}): DeductionsResult {
  const {
    retirement401kMonthly = 0,
    healthcarePremium = 0,
    studentLoanPayment = 0,
    commuteCostMonthly = 0,
  } = inputs

  const monthly = {
    federal: Math.round(taxResult.federalTax / 12),
    state: Math.round(taxResult.stateTax / 12),
    local: Math.round(taxResult.localTax / 12),
    fica: Math.round(taxResult.fica / 12),
  }

  const totalDeductions =
    monthly.federal +
    monthly.state +
    monthly.local +
    monthly.fica +
    retirement401kMonthly +
    healthcarePremium +
    studentLoanPayment +
    commuteCostMonthly

  const monthlyTakeHome = Math.max(0, taxResult.monthlyGross - totalDeductions)

  const lineItems: DeductionLineItem[] = [
    { name: "Gross salary",         amount: taxResult.monthlyGross,  type: "income"     },
    { name: "Federal income tax",   amount: -monthly.federal,        type: "tax"        },
    { name: "State income tax",     amount: -monthly.state,          type: "tax"        },
    ...(monthly.local > 0
      ? [{ name: "Local income tax", amount: -monthly.local,          type: "tax" as const }]
      : []),
    { name: "Social Security & Medicare", amount: -monthly.fica,     type: "tax"        },
    ...(retirement401kMonthly > 0
      ? [{ name: "401(k) contribution", amount: -retirement401kMonthly, type: "retirement" as const }]
      : []),
    ...(healthcarePremium > 0
      ? [{ name: "Healthcare premium",   amount: -healthcarePremium,    type: "deduction" as const }]
      : []),
    ...(studentLoanPayment > 0
      ? [{ name: "Student loan",         amount: -studentLoanPayment,   type: "deduction" as const }]
      : []),
    ...(commuteCostMonthly > 0
      ? [{ name: "Commute",              amount: -commuteCostMonthly,   type: "deduction" as const }]
      : []),
  ]

  return {
    monthlyGross: taxResult.monthlyGross,
    federal: monthly.federal,
    state: monthly.state,
    local: monthly.local,
    fica: monthly.fica,
    retirement401k: retirement401kMonthly,
    healthcare: healthcarePremium,
    studentLoan: studentLoanPayment,
    commute: commuteCostMonthly,
    totalDeductions,
    monthlyTakeHome,
    lineItems,
  }
}
