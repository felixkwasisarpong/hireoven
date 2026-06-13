import test from "node:test"
import assert from "node:assert/strict"
import {
  SERVICE_OFFERINGS,
  computeQuote,
  quoteById,
  getOffering,
  RUSH_SURCHARGE_RATE,
} from "@/lib/immigration/services"

test("every offering has a sane price and fee rate", () => {
  for (const o of SERVICE_OFFERINGS) {
    assert.ok(o.basePrice > 0, `${o.id} price`)
    assert.ok(o.platformFeeRate > 0 && o.platformFeeRate < 0.5, `${o.id} fee rate`)
    assert.ok(o.summary.length > 0)
  }
  // ids unique
  assert.equal(new Set(SERVICE_OFFERINGS.map((o) => o.id)).size, SERVICE_OFFERINGS.length)
})

test("computeQuote takes the fee from the provider side; user pays the base", () => {
  const offering = getOffering("attorney_consult_30")!
  const q = computeQuote(offering)
  assert.equal(q.price, 150)
  assert.equal(q.platformFee, 30) // 20% of 150
  assert.equal(q.providerNet, 120)
  assert.equal(q.platformFee + q.providerNet, q.price)
})

test("rush adds the surcharge to price and the fee scales with it", () => {
  const offering = getOffering("attorney_consult_30")!
  const q = computeQuote(offering, { rush: true })
  assert.equal(q.rushSurcharge, Math.round(150 * RUSH_SURCHARGE_RATE)) // 38
  assert.equal(q.price, 188)
  assert.equal(q.platformFee, Math.round(188 * 0.2)) // 38
})

test("quoteById returns null for an unknown offering", () => {
  assert.equal(quoteById("not_a_real_service"), null)
  assert.ok(quoteById("rfe_response"))
})
