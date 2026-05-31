/**
 * Idempotently create / locate Pro Max prices (and the underlying product)
 * in Stripe and print the IDs for .env.local. Skips Pro since those env vars
 * already point at valid prices.
 *
 *   npx tsx scripts/seed-stripe-prices.ts
 *
 * Identifies the product by metadata.hireoven_plan = pro_max so re-running
 * the script is safe.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import Stripe from "stripe"

const PRO_MAX_MONTHLY_CENTS = 2900
const PRO_MAX_YEARLY_CENTS = 22900

async function findProductByPlan(stripe: Stripe, plan: string): Promise<Stripe.Product | null> {
  const list = await stripe.products.list({ limit: 100, active: true })
  return list.data.find((p) => p.metadata?.hireoven_plan === plan) ?? null
}

async function findPrice(
  stripe: Stripe,
  productId: string,
  amountCents: number,
  interval: "month" | "year",
  currency: string
): Promise<Stripe.Price | null> {
  const list = await stripe.prices.list({ product: productId, limit: 100, active: true })
  return list.data.find(
    (p) =>
      p.unit_amount === amountCents &&
      p.recurring?.interval === interval &&
      p.currency === currency
  ) ?? null
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error("STRIPE_SECRET_KEY missing")
  if (!secret.startsWith("sk_test_")) {
    console.warn("⚠  Not a test key. Aborting.")
    process.exit(1)
  }

  const stripe = new Stripe(secret, { apiVersion: "2026-03-25.dahlia" })
  const currency = (process.env.STRIPE_CURRENCY ?? "usd").toLowerCase()

  // ── Product ────────────────────────────────────────────────────────────────
  let product = await findProductByPlan(stripe, "pro_max")
  if (!product) {
    product = await stripe.products.create({
      name: "Hireoven Pro Max",
      description: "Apex strategy, generous monthly quotas, and 1 live voice interview / 28 days.",
      metadata: { hireoven_plan: "pro_max" },
    })
    console.log(`+ Created product: ${product.id}`)
  } else {
    console.log(`✓ Product already exists: ${product.id}`)
  }

  // ── Prices ─────────────────────────────────────────────────────────────────
  let monthly = await findPrice(stripe, product.id, PRO_MAX_MONTHLY_CENTS, "month", currency)
  if (!monthly) {
    monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: PRO_MAX_MONTHLY_CENTS,
      currency,
      recurring: { interval: "month" },
      nickname: "Pro Max monthly",
      metadata: { hireoven_plan: "pro_max", interval: "monthly" },
    })
    console.log(`+ Created Pro Max monthly: ${monthly.id}`)
  } else {
    console.log(`✓ Pro Max monthly already exists: ${monthly.id}`)
  }

  let yearly = await findPrice(stripe, product.id, PRO_MAX_YEARLY_CENTS, "year", currency)
  if (!yearly) {
    yearly = await stripe.prices.create({
      product: product.id,
      unit_amount: PRO_MAX_YEARLY_CENTS,
      currency,
      recurring: { interval: "year" },
      nickname: "Pro Max yearly",
      metadata: { hireoven_plan: "pro_max", interval: "yearly" },
    })
    console.log(`+ Created Pro Max yearly: ${yearly.id}`)
  } else {
    console.log(`✓ Pro Max yearly already exists: ${yearly.id}`)
  }

  console.log("\n=== Summary ===")
  console.log(`STRIPE_PRICE_PRO_MAX_MONTHLY=${monthly.id}`)
  console.log(`STRIPE_PRICE_PRO_MAX_YEARLY=${yearly.id}`)
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
