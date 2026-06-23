/**
 * Idempotently create / locate the Pro and Pro Max subscription prices (and
 * their products) in Stripe and print the IDs for .env.local.
 *
 *   npx tsx scripts/seed-stripe-prices.ts
 *
 * Amounts come straight from lib/pricing.ts (getPlanAmountCents), which the
 * subscription snapshot validates against — so the seeded prices must match.
 * Products are identified by metadata.hireoven_plan, so re-running is safe.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import Stripe from "stripe"

// Mirror lib/pricing.ts PLAN_DATA → getPlanAmountCents (monthly*100, yearlyBilled*100).
const PLAN_PRICES = [
  {
    plan: "pro",
    name: "Hireoven Pro",
    description: "Everything you need to land the job — unlimited match scores, resume tools, and Apex AI.",
    monthlyCents: 1900,
    yearlyCents: 14900,
    monthlyEnv: "STRIPE_PRICE_PRO_MONTHLY",
    yearlyEnv: "STRIPE_PRICE_PRO_YEARLY",
  },
  {
    plan: "pro_max",
    name: "Hireoven Pro Max",
    description: "Apex strategy, generous monthly quotas, and 1 live voice interview / 28 days.",
    monthlyCents: 2900,
    yearlyCents: 22900,
    monthlyEnv: "STRIPE_PRICE_PRO_MAX_MONTHLY",
    yearlyEnv: "STRIPE_PRICE_PRO_MAX_YEARLY",
  },
] as const

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
  const envLines: string[] = []

  for (const spec of PLAN_PRICES) {
    // ── Product ──────────────────────────────────────────────────────────────
    let product = await findProductByPlan(stripe, spec.plan)
    if (!product) {
      product = await stripe.products.create({
        name: spec.name,
        description: spec.description,
        metadata: { hireoven_plan: spec.plan },
      })
      console.log(`+ Created product ${spec.plan}: ${product.id}`)
    } else {
      console.log(`✓ Product ${spec.plan} already exists: ${product.id}`)
    }

    // ── Prices ───────────────────────────────────────────────────────────────
    let monthly = await findPrice(stripe, product.id, spec.monthlyCents, "month", currency)
    if (!monthly) {
      monthly = await stripe.prices.create({
        product: product.id,
        unit_amount: spec.monthlyCents,
        currency,
        recurring: { interval: "month" },
        nickname: `${spec.name} monthly`,
        metadata: { hireoven_plan: spec.plan, interval: "monthly" },
      })
      console.log(`+ Created ${spec.plan} monthly: ${monthly.id}`)
    } else {
      console.log(`✓ ${spec.plan} monthly already exists: ${monthly.id}`)
    }

    let yearly = await findPrice(stripe, product.id, spec.yearlyCents, "year", currency)
    if (!yearly) {
      yearly = await stripe.prices.create({
        product: product.id,
        unit_amount: spec.yearlyCents,
        currency,
        recurring: { interval: "year" },
        nickname: `${spec.name} yearly`,
        metadata: { hireoven_plan: spec.plan, interval: "yearly" },
      })
      console.log(`+ Created ${spec.plan} yearly: ${yearly.id}`)
    } else {
      console.log(`✓ ${spec.plan} yearly already exists: ${yearly.id}`)
    }

    envLines.push(`${spec.monthlyEnv}=${monthly.id}`, `${spec.yearlyEnv}=${yearly.id}`)
  }

  console.log("\n=== Summary (paste into .env.local) ===")
  for (const line of envLines) console.log(line)
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
