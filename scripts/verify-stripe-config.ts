/**
 * Sanity check that all Stripe IDs referenced by .env.local actually exist
 * in the connected Stripe account and are usable for checkout.
 *
 *   npx tsx scripts/verify-stripe-config.ts
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import Stripe from "stripe"

const PRICE_VARS = [
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_PRO_MAX_MONTHLY",
  "STRIPE_PRICE_PRO_MAX_YEARLY",
] as const

const OPTIONAL_PROMO_VARS = [
  "STRIPE_STUDENT_PROMOTION_CODE_ID",
] as const

function fmt(amountCents: number | null | undefined, currency: string | null | undefined) {
  if (typeof amountCents !== "number") return "?"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "USD").toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amountCents / 100)
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error("STRIPE_SECRET_KEY missing")
  const stripe = new Stripe(secret, { apiVersion: "2026-03-25.dahlia" })

  console.log(`Mode: ${secret.startsWith("sk_test_") ? "TEST" : "LIVE"}\n`)

  console.log("=== Prices ===")
  let priceErrors = 0
  for (const v of PRICE_VARS) {
    const id = process.env[v]
    if (!id) {
      console.log(`✗ ${v}: not set`)
      priceErrors++
      continue
    }
    try {
      const price = await stripe.prices.retrieve(id)
      const interval = price.recurring?.interval ?? "—"
      const intervalCount = price.recurring?.interval_count ?? 1
      console.log(
        `${price.active ? "✓" : "✗"} ${v}: ${id}` +
        `  ${fmt(price.unit_amount, price.currency)} / ${intervalCount} ${interval}` +
        `${price.active ? "" : " [INACTIVE]"}`
      )
      if (!price.active) priceErrors++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`✗ ${v}: ${id} → ${msg}`)
      priceErrors++
    }
  }

  console.log("\n=== Promotion codes ===")
  let promoErrors = 0
  for (const v of OPTIONAL_PROMO_VARS) {
    const id = process.env[v]
    if (!id) {
      console.log(`- ${v}: not set (optional)`)
      continue
    }
    try {
      const promo = await stripe.promotionCodes.retrieve(id, {
        expand: ["promotion.coupon"],
      })
      const coupon = typeof promo.promotion.coupon === "object" ? promo.promotion.coupon : null
      const discount = coupon?.percent_off != null
        ? `${coupon.percent_off}% off`
        : coupon?.amount_off != null
          ? `${fmt(coupon.amount_off, coupon.currency)} off`
          : "?"
      const duration = coupon?.duration === "repeating" && coupon.duration_in_months
        ? `repeating ${coupon.duration_in_months} months`
        : coupon?.duration ?? "?"
      console.log(
        `${promo.active && coupon?.valid ? "✓" : "✗"} ${v}: ${id}` +
        `  code=${promo.code}  ${discount}  ${duration}` +
        `${promo.active ? "" : " [INACTIVE]"}`
      )
      if (!promo.active || !coupon?.valid) promoErrors++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`✗ ${v}: ${id} → ${msg}`)
      promoErrors++
    }
  }

  console.log("\n=== Webhook endpoints ===")
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 10 })
    if (endpoints.data.length === 0) {
      console.log("- No webhook endpoints configured. Use `stripe listen` for local dev or add a")
      console.log("  prod endpoint pointing to /api/stripe/webhook with the events:")
      console.log("    checkout.session.completed, customer.subscription.updated, customer.subscription.deleted")
    } else {
      for (const ep of endpoints.data) {
        console.log(`${ep.status === "enabled" ? "✓" : "✗"} ${ep.url}  events=${ep.enabled_events.length}`)
      }
    }
  } catch (err) {
    console.log("? Could not list webhook endpoints:", err instanceof Error ? err.message : err)
  }

  const exitCode = priceErrors + promoErrors > 0 ? 1 : 0
  console.log(`\nResult: ${exitCode === 0 ? "OK" : `${priceErrors + promoErrors} issues`}`)
  process.exit(exitCode)
}

main().catch((err) => {
  console.error("Verify failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
