/**
 * One-shot Stripe seed for promotion codes used by Hireoven billing.
 *
 *   npx tsx scripts/seed-stripe-promos.ts
 *
 * Idempotent: looks up existing coupons/promotion codes by a stable metadata
 * key before creating, so it's safe to re-run. Tags everything with
 *   metadata.hireoven_purpose = student | launch
 * for easy filtering in the Stripe dashboard.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import Stripe from "stripe"

const PURPOSES = {
  STUDENT: "student",
  LAUNCH: "launch",
} as const

const COUPONS = [
  {
    purpose: PURPOSES.STUDENT,
    name: "Student (verified .edu) — 30% off Pro",
    percent_off: 30,
    duration: "forever" as const,
  },
  {
    purpose: PURPOSES.LAUNCH,
    name: "Launch — 50% off first 3 months",
    percent_off: 50,
    duration: "repeating" as const,
    duration_in_months: 3,
  },
]

const PROMOTION_CODES = [
  { purpose: PURPOSES.STUDENT, code: "STUDENT30" },
  { purpose: PURPOSES.LAUNCH, code: "LAUNCH50" },
]

async function findCouponByPurpose(stripe: Stripe, purpose: string): Promise<Stripe.Coupon | null> {
  // List + filter (Stripe doesn't support search-by-metadata on coupons).
  // Cap at first 100 — plenty for a fresh sandbox.
  const list = await stripe.coupons.list({ limit: 100 })
  return list.data.find((c) => c.metadata?.hireoven_purpose === purpose && c.valid) ?? null
}

async function findPromoCode(stripe: Stripe, code: string): Promise<Stripe.PromotionCode | null> {
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
  return list.data[0] ?? null
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error("STRIPE_SECRET_KEY missing from env.")
  if (!secret.startsWith("sk_test_")) {
    console.warn("⚠  STRIPE_SECRET_KEY is not a test key. Aborting.")
    process.exit(1)
  }

  const stripe = new Stripe(secret, { apiVersion: "2026-03-25.dahlia" })

  // Ping the API to confirm the key works. Coupons.list is cheap + read-only.
  await stripe.coupons.list({ limit: 1 })
  console.log(`✓ Connected to Stripe (test mode)`)

  // ── Coupons ────────────────────────────────────────────────────────────────
  const couponIds: Record<string, string> = {}
  for (const spec of COUPONS) {
    const existing = await findCouponByPurpose(stripe, spec.purpose)
    if (existing) {
      console.log(`✓ Coupon already exists for purpose=${spec.purpose}: ${existing.id} (${existing.name})`)
      couponIds[spec.purpose] = existing.id
      continue
    }

    const coupon = await stripe.coupons.create({
      name: spec.name,
      percent_off: spec.percent_off,
      duration: spec.duration,
      ...(spec.duration === "repeating" ? { duration_in_months: spec.duration_in_months } : {}),
      metadata: { hireoven_purpose: spec.purpose },
    })
    console.log(`+ Created coupon for purpose=${spec.purpose}: ${coupon.id}`)
    couponIds[spec.purpose] = coupon.id
  }

  // ── Promotion codes ────────────────────────────────────────────────────────
  const promoIds: Record<string, string> = {}
  for (const spec of PROMOTION_CODES) {
    const existing = await findPromoCode(stripe, spec.code)
    if (existing) {
      console.log(`✓ Promotion code ${spec.code} already exists: ${existing.id}`)
      promoIds[spec.purpose] = existing.id
      continue
    }

    const couponId = couponIds[spec.purpose]
    if (!couponId) throw new Error(`No coupon for purpose=${spec.purpose}`)

    const promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: spec.code,
      metadata: { hireoven_purpose: spec.purpose },
    })
    console.log(`+ Created promotion code ${spec.code}: ${promo.id}`)
    promoIds[spec.purpose] = promo.id
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Summary ===")
  console.log(`STUDENT coupon:            ${couponIds[PURPOSES.STUDENT]}`)
  console.log(`STUDENT promotion_code id: ${promoIds[PURPOSES.STUDENT]}`)
  console.log(`LAUNCH  coupon:            ${couponIds[PURPOSES.LAUNCH]}`)
  console.log(`LAUNCH  promotion_code id: ${promoIds[PURPOSES.LAUNCH]}`)

  console.log("\nAdd this to .env.local (only the student id is read by the app):")
  console.log(`STRIPE_STUDENT_PROMOTION_CODE_ID=${promoIds[PURPOSES.STUDENT]}`)
}

main().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
