import assert from "node:assert/strict"
import test from "node:test"
import { subscriptionIdFromInvoice } from "./fulfillment"

test("finds the subscription on an invoice in the shape Stripe sends today", () => {
  // API 2026-03-25.dahlia: `subscription` is gone from the invoice.
  const invoice = {
    id: "in_1",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_live" } },
  }
  assert.equal(subscriptionIdFromInvoice(invoice), "sub_live")
})

test("still finds it on a replayed invoice from an older API version", () => {
  assert.equal(subscriptionIdFromInvoice({ id: "in_2", subscription: "sub_old" }), "sub_old")
  assert.equal(subscriptionIdFromInvoice({ id: "in_3", subscription: { id: "sub_expanded" } }), "sub_expanded")
})

test("falls back to the line item, and gives up honestly on a one-off invoice", () => {
  const viaLine = {
    id: "in_4",
    lines: { data: [{ parent: { subscription_item_details: { subscription: "sub_line" } } }] },
  }
  assert.equal(subscriptionIdFromInvoice(viaLine), "sub_line")
  assert.equal(subscriptionIdFromInvoice({ id: "in_5" }), null)
  assert.equal(subscriptionIdFromInvoice(null), null)
})
