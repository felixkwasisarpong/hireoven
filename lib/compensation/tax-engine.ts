/**
 * Take-Home Compensation Tax Engine — Tax Year 2025
 * Sources: IRS Rev. Proc. 2024-61, state DOR publications
 */

export type FilingStatus = "single" | "married_jointly" | "head_of_household"

export type TaxResult = {
  federalTax: number
  stateTax: number
  localTax: number
  fica: number
  totalTax: number
  effectiveRate: number
  monthlyGross: number
  monthlyNet: number
  annualNet: number
}

// ── Federal brackets ──────────────────────────────────────────────────────────

type Bracket = { min: number; max: number; rate: number }

const FEDERAL_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { min: 0,       max: 11_925,   rate: 0.10 },
    { min: 11_925,  max: 48_475,   rate: 0.12 },
    { min: 48_475,  max: 103_350,  rate: 0.22 },
    { min: 103_350, max: 197_300,  rate: 0.24 },
    { min: 197_300, max: 250_525,  rate: 0.32 },
    { min: 250_525, max: 626_350,  rate: 0.35 },
    { min: 626_350, max: Infinity, rate: 0.37 },
  ],
  married_jointly: [
    { min: 0,       max: 23_850,   rate: 0.10 },
    { min: 23_850,  max: 96_950,   rate: 0.12 },
    { min: 96_950,  max: 206_700,  rate: 0.22 },
    { min: 206_700, max: 394_600,  rate: 0.24 },
    { min: 394_600, max: 501_050,  rate: 0.32 },
    { min: 501_050, max: 751_600,  rate: 0.35 },
    { min: 751_600, max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { min: 0,       max: 17_000,   rate: 0.10 },
    { min: 17_000,  max: 64_850,   rate: 0.12 },
    { min: 64_850,  max: 103_350,  rate: 0.22 },
    { min: 103_350, max: 197_300,  rate: 0.24 },
    { min: 197_300, max: 250_500,  rate: 0.32 },
    { min: 250_500, max: 626_350,  rate: 0.35 },
    { min: 626_350, max: Infinity, rate: 0.37 },
  ],
}

const FEDERAL_STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15_000,
  married_jointly: 30_000,
  head_of_household: 22_500,
}

function calcBracketTax(taxableIncome: number, brackets: Bracket[]): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  for (const { min, max, rate } of brackets) {
    if (taxableIncome <= min) break
    tax += (Math.min(taxableIncome, max) - min) * rate
  }
  return tax
}

// ── State tax tables ───────────────────────────────────────────────────────────

// Graduated-bracket states: CA, NY, NJ, MN, OR, VT, DC
// All others use flat effective rates

const CA_SINGLE: Bracket[] = [
  { min: 0,       max: 10_756,  rate: 0.01  },
  { min: 10_756,  max: 25_499,  rate: 0.02  },
  { min: 25_499,  max: 40_245,  rate: 0.04  },
  { min: 40_245,  max: 55_866,  rate: 0.06  },
  { min: 55_866,  max: 70_606,  rate: 0.08  },
  { min: 70_606,  max: 360_659, rate: 0.093 },
  { min: 360_659, max: 432_787, rate: 0.103 },
  { min: 432_787, max: 721_314, rate: 0.113 },
  { min: 721_314, max: 1_000_000, rate: 0.123 },
  { min: 1_000_000, max: Infinity, rate: 0.133 },
]
const CA_MFJ: Bracket[] = CA_SINGLE.map((b) => ({ ...b, min: b.min * 2, max: b.max === Infinity ? Infinity : b.max * 2 }))
const CA_STD_DEDUCTION = { single: 5_202, married_jointly: 10_404, head_of_household: 10_404 }

const NY_SINGLE: Bracket[] = [
  { min: 0,       max: 17_150,    rate: 0.04   },
  { min: 17_150,  max: 23_600,    rate: 0.045  },
  { min: 23_600,  max: 27_900,    rate: 0.0525 },
  { min: 27_900,  max: 161_550,   rate: 0.055  },
  { min: 161_550, max: 323_200,   rate: 0.06   },
  { min: 323_200, max: 2_155_350, rate: 0.0685 },
  { min: 2_155_350, max: 5_000_000, rate: 0.0965 },
  { min: 5_000_000, max: Infinity, rate: 0.109 },
]
const NY_MFJ: Bracket[] = [
  { min: 0,       max: 27_900,    rate: 0.04   },
  { min: 27_900,  max: 43_000,    rate: 0.045  },
  { min: 43_000,  max: 161_550,   rate: 0.0525 },
  { min: 161_550, max: 323_200,   rate: 0.059  },
  { min: 323_200, max: 2_155_350, rate: 0.0685 },
  { min: 2_155_350, max: 5_000_000, rate: 0.0965 },
  { min: 5_000_000, max: Infinity, rate: 0.109 },
]
const NY_STD_DEDUCTION = { single: 8_000, married_jointly: 16_050, head_of_household: 11_200 }

const NJ_SINGLE: Bracket[] = [
  { min: 0,       max: 20_000,  rate: 0.014  },
  { min: 20_000,  max: 35_000,  rate: 0.0175 },
  { min: 35_000,  max: 40_000,  rate: 0.035  },
  { min: 40_000,  max: 75_000,  rate: 0.05525 },
  { min: 75_000,  max: 500_000, rate: 0.0637 },
  { min: 500_000, max: 1_000_000, rate: 0.0897 },
  { min: 1_000_000, max: Infinity, rate: 0.1075 },
]
const NJ_MFJ: Bracket[] = [
  { min: 0,       max: 20_000,  rate: 0.014  },
  { min: 20_000,  max: 50_000,  rate: 0.0175 },
  { min: 50_000,  max: 70_000,  rate: 0.0245 },
  { min: 70_000,  max: 80_000,  rate: 0.035  },
  { min: 80_000,  max: 150_000, rate: 0.05525 },
  { min: 150_000, max: 500_000, rate: 0.0637 },
  { min: 500_000, max: 1_000_000, rate: 0.0897 },
  { min: 1_000_000, max: Infinity, rate: 0.1075 },
]

const MN_SINGLE: Bracket[] = [
  { min: 0,       max: 31_690,  rate: 0.0535 },
  { min: 31_690,  max: 104_090, rate: 0.068  },
  { min: 104_090, max: 193_240, rate: 0.0785 },
  { min: 193_240, max: Infinity, rate: 0.0985 },
]
const MN_MFJ: Bracket[] = [
  { min: 0,       max: 46_330,  rate: 0.0535 },
  { min: 46_330,  max: 184_040, rate: 0.068  },
  { min: 184_040, max: 304_970, rate: 0.0785 },
  { min: 304_970, max: Infinity, rate: 0.0985 },
]

const OR_SINGLE: Bracket[] = [
  { min: 0,       max: 18_400,  rate: 0.0475 },
  { min: 18_400,  max: 46_200,  rate: 0.0675 },
  { min: 46_200,  max: 250_000, rate: 0.0875 },
  { min: 250_000, max: Infinity, rate: 0.099  },
]
const OR_MFJ: Bracket[] = [
  { min: 0,       max: 36_800,  rate: 0.0475 },
  { min: 36_800,  max: 92_400,  rate: 0.0675 },
  { min: 92_400,  max: 500_000, rate: 0.0875 },
  { min: 500_000, max: Infinity, rate: 0.099  },
]
const OR_STD_DEDUCTION = { single: 2_420, married_jointly: 4_840, head_of_household: 2_420 }

const VT_SINGLE: Bracket[] = [
  { min: 0,       max: 45_400,  rate: 0.0335 },
  { min: 45_400,  max: 110_050, rate: 0.066  },
  { min: 110_050, max: 229_550, rate: 0.076  },
  { min: 229_550, max: Infinity, rate: 0.0875 },
]
const VT_MFJ: Bracket[] = [
  { min: 0,       max: 75_850,  rate: 0.0335 },
  { min: 75_850,  max: 183_400, rate: 0.066  },
  { min: 183_400, max: 279_450, rate: 0.076  },
  { min: 279_450, max: Infinity, rate: 0.0875 },
]

const DC_BRACKETS: Bracket[] = [
  { min: 0,       max: 10_000,  rate: 0.04   },
  { min: 10_000,  max: 40_000,  rate: 0.06   },
  { min: 40_000,  max: 60_000,  rate: 0.065  },
  { min: 60_000,  max: 350_000, rate: 0.085  },
  { min: 350_000, max: 1_000_000, rate: 0.0925 },
  { min: 1_000_000, max: Infinity, rate: 0.1075 },
]
const DC_STD_DEDUCTION = { single: 5_400, married_jointly: 10_800, head_of_household: 5_400 }

// Flat-rate states (effective rate, approximate 2025)
const STATE_FLAT_RATES: Record<string, number> = {
  AL: 0.050, AK: 0, AZ: 0.025, AR: 0.047, CO: 0.044, CT: 0.065,
  DE: 0.060, FL: 0, GA: 0.0549, HI: 0.080, ID: 0.058, IL: 0.0495,
  IN: 0.0305, IA: 0.057, KS: 0.057, KY: 0.040, LA: 0.030, ME: 0.0715,
  MD: 0.0475, MA: 0.050, MI: 0.0425, MS: 0.047, MO: 0.0495, MT: 0.059,
  NE: 0.0584, NV: 0, NH: 0, NM: 0.059, NC: 0.0475, ND: 0.025,
  OH: 0.035, OK: 0.0475, PA: 0.0307, RI: 0.0599, SC: 0.070, SD: 0,
  TN: 0, TX: 0, UT: 0.0465, VA: 0.0575, WA: 0, WV: 0.0512,
  WI: 0.0765, WY: 0,
}

// Local taxes by city (annual, applied after no standard deduction)
const LOCAL_TAX_RATES: Record<string, number> = {
  "new york":     0.03876,
  "nyc":          0.03876,
  "philadelphia": 0.0375,
  "detroit":      0.024,
  "columbus":     0.025,
  "cleveland":    0.025,
  "cincinnati":   0.018,
  "toledo":       0.0225,
  "pittsburgh":   0.03,
  "baltimore":    0.032, // city piggyback
  "kansas city":  0.01,
  "st. louis":    0.01,
}

function getLocalRate(city: string): number {
  const normalized = city.toLowerCase().trim()
  return LOCAL_TAX_RATES[normalized] ?? 0
}

function calcStateTax(taxableIncome: number, stateCode: string, filingStatus: FilingStatus): number {
  if (taxableIncome <= 0) return 0
  const s = stateCode.toUpperCase()
  const mfj = filingStatus === "married_jointly"
  const hoh = filingStatus === "head_of_household"

  if (s === "CA") {
    const std = mfj ? CA_STD_DEDUCTION.married_jointly : hoh ? CA_STD_DEDUCTION.head_of_household : CA_STD_DEDUCTION.single
    const brackets = mfj ? CA_MFJ : CA_SINGLE
    return calcBracketTax(Math.max(0, taxableIncome - std), brackets)
  }
  if (s === "NY") {
    const std = mfj ? NY_STD_DEDUCTION.married_jointly : hoh ? NY_STD_DEDUCTION.head_of_household : NY_STD_DEDUCTION.single
    const brackets = mfj ? NY_MFJ : NY_SINGLE
    return calcBracketTax(Math.max(0, taxableIncome - std), brackets)
  }
  if (s === "NJ") {
    const brackets = mfj ? NJ_MFJ : NJ_SINGLE
    return calcBracketTax(taxableIncome, brackets) // NJ has no standard deduction
  }
  if (s === "MN") {
    const brackets = mfj ? MN_MFJ : MN_SINGLE
    return calcBracketTax(taxableIncome, brackets)
  }
  if (s === "OR") {
    const std = mfj ? OR_STD_DEDUCTION.married_jointly : OR_STD_DEDUCTION.single
    const brackets = mfj ? OR_MFJ : OR_SINGLE
    return calcBracketTax(Math.max(0, taxableIncome - std), brackets)
  }
  if (s === "VT") {
    const brackets = mfj ? VT_MFJ : VT_SINGLE
    return calcBracketTax(taxableIncome, brackets)
  }
  if (s === "DC") {
    const std = mfj ? DC_STD_DEDUCTION.married_jointly : DC_STD_DEDUCTION.single
    return calcBracketTax(Math.max(0, taxableIncome - std), DC_BRACKETS)
  }

  const rate = STATE_FLAT_RATES[s] ?? 0
  return taxableIncome * rate
}

// ── FICA ──────────────────────────────────────────────────────────────────────

const SS_WAGE_BASE_2025 = 176_100
const SS_RATE = 0.062
const MEDICARE_RATE = 0.0145
const ADDITIONAL_MEDICARE_RATE = 0.009
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE = 200_000
const ADDITIONAL_MEDICARE_THRESHOLD_MFJ = 250_000

function calcFica(annualSalary: number, filingStatus: FilingStatus): number {
  const ss = Math.min(annualSalary, SS_WAGE_BASE_2025) * SS_RATE
  const medicare = annualSalary * MEDICARE_RATE
  const threshold = filingStatus === "married_jointly"
    ? ADDITIONAL_MEDICARE_THRESHOLD_MFJ
    : ADDITIONAL_MEDICARE_THRESHOLD_SINGLE
  const additionalMedicare = Math.max(0, annualSalary - threshold) * ADDITIONAL_MEDICARE_RATE
  return ss + medicare + additionalMedicare
}

// ── Main export ───────────────────────────────────────────────────────────────

export function calculateTax(args: {
  annualSalary: number
  filingStatus: FilingStatus
  stateCode: string
  city?: string
  /** Pre-tax 401k annual contribution — reduces federal + state taxable income */
  preTax401kAnnual?: number
}): TaxResult {
  const { annualSalary, filingStatus, stateCode, city = "", preTax401kAnnual = 0 } = args
  if (annualSalary <= 0) {
    return { federalTax: 0, stateTax: 0, localTax: 0, fica: 0, totalTax: 0, effectiveRate: 0, monthlyGross: 0, monthlyNet: 0, annualNet: 0 }
  }

  // Federal: salary minus standard deduction AND pre-tax 401k
  const fedStdDed = FEDERAL_STANDARD_DEDUCTION[filingStatus]
  const federalTaxable = Math.max(0, annualSalary - preTax401kAnnual - fedStdDed)
  const federalTax = calcBracketTax(federalTaxable, FEDERAL_BRACKETS[filingStatus])

  // State: salary minus pre-tax 401k (state std deduction applied inside)
  const stateTaxable = Math.max(0, annualSalary - preTax401kAnnual)
  const stateTax = calcStateTax(stateTaxable, stateCode, filingStatus)

  // Local: applied to gross (no deductions typically)
  const localRate = getLocalRate(city)
  const localTax = annualSalary * localRate

  // FICA: applied to full salary (401k does not reduce SS/Medicare)
  const fica = calcFica(annualSalary, filingStatus)

  const totalTax = federalTax + stateTax + localTax + fica
  const effectiveRate = totalTax / annualSalary
  const annualNet = annualSalary - totalTax
  const monthlyGross = annualSalary / 12
  const monthlyNet = annualNet / 12

  return {
    federalTax: Math.round(federalTax),
    stateTax: Math.round(stateTax),
    localTax: Math.round(localTax),
    fica: Math.round(fica),
    totalTax: Math.round(totalTax),
    effectiveRate: Math.round(effectiveRate * 10_000) / 100,
    monthlyGross: Math.round(monthlyGross),
    monthlyNet: Math.round(monthlyNet),
    annualNet: Math.round(annualNet),
  }
}
