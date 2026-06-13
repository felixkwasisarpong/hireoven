/**
 * Immigration marketplace — Stripe Connect payment layer.
 *
 * Turns a matched service request into a destination charge: the user pays the
 * quoted price, the vetted partner (a Stripe Connect account) receives the net,
 * and Hireoven keeps its take-rate as the application fee. This module is the
 * pure, testable core — fee math + the Checkout Session params. The API calls
 * Stripe; the webhook records the result.
 */
import type { Quote } from "./services"

/** Just the priced fields we need — works with a full Quote or a stored snapshot. */
export type PricedBooking = Pick<Quote, "price" | "platformFee">

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/** Hireoven's cut on a booking, in cents — the Stripe application fee. */
export function applicationFeeCents(quote: PricedBooking): number {
  return dollarsToCents(quote.platformFee)
}

export type ServiceCheckoutInput = {
  quote: PricedBooking
  offeringName: string
  /** The partner's Stripe Connect account id (acct_…). */
  partnerStripeAccountId: string
  requestId: string
  userId: string
  customerEmail: string | null
  successUrl: string
  cancelUrl: string
}

/**
 * Build the Stripe Checkout params for a marketplace destination charge.
 * Returned as a plain object (typed against Stripe's SessionCreateParams at the
 * call site) so this stays a pure, dependency-free unit.
 */
export function buildServiceCheckoutParams(input: ServiceCheckoutInput) {
  const amount = dollarsToCents(input.quote.price)
  const fee = applicationFeeCents(input.quote)

  return {
    mode: "payment" as const,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: input.offeringName,
            description: "Immigration service booking via Hireoven",
          },
        },
      },
    ],
    payment_intent_data: {
      // Hireoven's take-rate, routed to the platform; the rest settles to the
      // partner's connected account.
      application_fee_amount: fee,
      transfer_data: { destination: input.partnerStripeAccountId },
      metadata: { type: "immigration_service", userId: input.userId, requestId: input.requestId },
    },
    metadata: { type: "immigration_service", userId: input.userId, requestId: input.requestId },
  }
}
