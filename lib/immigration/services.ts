/**
 * Immigration services marketplace — catalog + quote math.
 *
 * Hireoven owns the visa niche on the software side but stops at intel. This is
 * the services layer: brokered immigration help (attorney consults, H-1B/green-
 * card document prep, RFE support) delivered by vetted partners, with a platform
 * take-rate on every booking. This module is the pure, testable core: the
 * offering catalog and the quote/fee math. The API persists leads; partners
 * fulfil.
 */

export type ServiceCategory = "consult" | "petition" | "document_prep" | "assessment"

export type ServiceOffering = {
  id: string
  name: string
  category: ServiceCategory
  /** What the user gets, one line. */
  summary: string
  /** Partner-set base price in USD. */
  basePrice: number
  /** Hireoven's take-rate on the partner price (0..1). */
  platformFeeRate: number
  /** Typical turnaround, shown to set expectations. */
  turnaround: string
}

/** The services Hireoven brokers. Conservative, visa-relevant, high willingness-to-pay. */
export const SERVICE_OFFERINGS: ServiceOffering[] = [
  {
    id: "attorney_consult_30",
    name: "30-minute attorney consult",
    category: "consult",
    summary: "Talk through your visa situation 1:1 with a licensed immigration attorney.",
    basePrice: 150,
    platformFeeRate: 0.2,
    turnaround: "Scheduled within 3 business days",
  },
  {
    id: "h1b_transfer_review",
    name: "H-1B transfer review",
    category: "petition",
    summary: "An attorney reviews your H-1B transfer before you file, flagging risks.",
    basePrice: 400,
    platformFeeRate: 0.18,
    turnaround: "5–7 business days",
  },
  {
    id: "green_card_strategy",
    name: "Green-card strategy session",
    category: "consult",
    summary: "Map your PERM / EB-2 / EB-3 path and timeline with a specialist.",
    basePrice: 300,
    platformFeeRate: 0.18,
    turnaround: "Scheduled within 5 business days",
  },
  {
    id: "o1_assessment",
    name: "O-1 eligibility assessment",
    category: "assessment",
    summary: "Find out whether your profile can support an O-1 extraordinary-ability petition.",
    basePrice: 250,
    platformFeeRate: 0.18,
    turnaround: "5 business days",
  },
  {
    id: "rfe_response",
    name: "RFE response support",
    category: "petition",
    summary: "Attorney-guided response to a USCIS Request for Evidence.",
    basePrice: 900,
    platformFeeRate: 0.15,
    turnaround: "Prioritized — within RFE deadline",
  },
  {
    id: "document_prep",
    name: "Petition document prep package",
    category: "document_prep",
    summary: "Hands-on prep of your supporting documents and exhibits.",
    basePrice: 600,
    platformFeeRate: 0.15,
    turnaround: "7–10 business days",
  },
]

/** Rush handling adds this fraction to the base price. */
export const RUSH_SURCHARGE_RATE = 0.25

export type Quote = {
  offeringId: string
  basePrice: number
  rushSurcharge: number
  /** What the user pays. */
  price: number
  platformFeeRate: number
  /** Hireoven's revenue on this booking. */
  platformFee: number
  /** What the partner nets. */
  providerNet: number
}

export function getOffering(id: string): ServiceOffering | undefined {
  return SERVICE_OFFERINGS.find((o) => o.id === id)
}

/**
 * Quote a booking. The listed price is what the user pays; Hireoven's fee is
 * taken from the partner's side (a marketplace take-rate), so the user sees one
 * clean number and the partner nets the remainder.
 */
export function computeQuote(offering: ServiceOffering, opts: { rush?: boolean } = {}): Quote {
  const rushSurcharge = opts.rush ? Math.round(offering.basePrice * RUSH_SURCHARGE_RATE) : 0
  const price = offering.basePrice + rushSurcharge
  const platformFee = Math.round(price * offering.platformFeeRate)
  return {
    offeringId: offering.id,
    basePrice: offering.basePrice,
    rushSurcharge,
    price,
    platformFeeRate: offering.platformFeeRate,
    platformFee,
    providerNet: price - platformFee,
  }
}

export function quoteById(offeringId: string, opts: { rush?: boolean } = {}): Quote | null {
  const offering = getOffering(offeringId)
  return offering ? computeQuote(offering, opts) : null
}
