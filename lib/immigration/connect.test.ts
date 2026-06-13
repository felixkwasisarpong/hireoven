import test from "node:test"
import assert from "node:assert/strict"
import { dollarsToCents, applicationFeeCents, buildServiceCheckoutParams } from "@/lib/immigration/connect"
import { computeQuote, getOffering } from "@/lib/immigration/services"

const quote = computeQuote(getOffering("attorney_consult_30")!) // price 150, fee 30, net 120

test("dollarsToCents rounds to whole cents", () => {
  assert.equal(dollarsToCents(150), 15000)
  assert.equal(dollarsToCents(188), 18800)
  assert.equal(dollarsToCents(99.995), 10000)
})

test("application fee equals the platform take-rate in cents", () => {
  assert.equal(applicationFeeCents(quote), 3000) // $30
})

test("checkout params encode a destination charge with the fee and metadata", () => {
  const p = buildServiceCheckoutParams({
    quote,
    offeringName: "30-minute attorney consult",
    partnerStripeAccountId: "acct_123",
    requestId: "req_1",
    userId: "user_1",
    customerEmail: "a@b.com",
    successUrl: "https://x/success",
    cancelUrl: "https://x/cancel",
  })
  assert.equal(p.mode, "payment")
  assert.equal(p.line_items[0].price_data.unit_amount, 15000)
  assert.equal(p.payment_intent_data.application_fee_amount, 3000)
  assert.equal(p.payment_intent_data.transfer_data.destination, "acct_123")
  assert.equal(p.payment_intent_data.metadata.type, "immigration_service")
  assert.equal(p.payment_intent_data.metadata.requestId, "req_1")
  assert.equal(p.metadata.requestId, "req_1")
  assert.equal(p.customer_email, "a@b.com")
})

test("omits customer_email when none is provided", () => {
  const p = buildServiceCheckoutParams({
    quote,
    offeringName: "x",
    partnerStripeAccountId: "acct_1",
    requestId: "r",
    userId: "u",
    customerEmail: null,
    successUrl: "s",
    cancelUrl: "c",
  })
  assert.equal("customer_email" in p, false)
})
