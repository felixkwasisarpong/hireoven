/**
 * Create the LAUNCH promo code in Stripe: 20% off, first month only (duration=once).
 *
 * Runs against whatever account STRIPE_SECRET_KEY points at — set the LIVE key to
 * create the live launch coupon. Idempotent: if a LAUNCH promotion code already
 * exists it prints it and exits without creating a duplicate.
 *
 * "Pro Max monthly only" is NOT enforced by the coupon (Pro Max monthly & yearly
 * share one Stripe product, and applies_to isn't honored on this API version) — it
 * lives in the checkout route (RESTRICTED_PROMO_CODES in lib/pricing.ts). This
 * script still scopes applies_to to the Pro Max product as a best-effort guard so
 * the code can't discount the Pro plan.
 *
 *   npx tsx scripts/create-launch-promo.ts             # dry run — creates nothing
 *   npx tsx scripts/create-launch-promo.ts --execute   # create (uses current STRIPE_SECRET_KEY)
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/create-launch-promo.ts --execute   # live
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import Stripe from "stripe"

const execute = process.argv.includes("--execute")
const CODE = "LAUNCH"
const PERCENT_OFF = 20

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
  const mode = key.startsWith("sk_live") ? "LIVE" : key.startsWith("sk_test") ? "TEST" : "UNKNOWN"
  const stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" })

  // Passing params-only retrieves the account the key belongs to; the SDK types
  // insist on a string id, so cast the call (used only to confirm the target).
  const acct = await (stripe.accounts.retrieve as (p: unknown) => Promise<Stripe.Account>)({})
  console.log(`Account: ${acct.id} | mode: ${mode} | execute: ${execute}`)

  // Resolve the Pro Max product from the configured monthly price (mode-correct —
  // product IDs differ between test and live).
  const monthlyPriceId = process.env.STRIPE_PRICE_PRO_MAX_MONTHLY
  let proMaxProduct: string | undefined
  if (monthlyPriceId) {
    const price = await stripe.prices.retrieve(monthlyPriceId, { expand: ["product"] })
    proMaxProduct = typeof price.product === "string" ? price.product : price.product.id
    console.log(`Pro Max product: ${proMaxProduct} (from ${monthlyPriceId})`)
  } else {
    console.log("WARN: STRIPE_PRICE_PRO_MAX_MONTHLY not set — coupon won't be product-scoped")
  }

  // Idempotency: bail if LAUNCH already exists in this account/mode.
  const existing = await stripe.promotionCodes.list({
    code: CODE,
    limit: 1,
    expand: ["data.promotion.coupon"],
  })
  if (existing.data[0]) {
    const p = existing.data[0] as unknown as { id: string; promotion?: { coupon?: Stripe.Coupon } }
    const c = p.promotion?.coupon
    console.log(`LAUNCH already exists: ${p.id} (coupon ${c?.id}, ${c?.percent_off}% ${c?.duration}) — nothing to do`)
    return
  }

  if (!execute) {
    console.log("\nDRY RUN — would create:")
    console.log(`  coupon: ${PERCENT_OFF}% off, duration=once${proMaxProduct ? `, applies_to=${proMaxProduct}` : ""}`)
    console.log(`  promotion code: ${CODE}`)
    console.log("\nRe-run with --execute to create.")
    return
  }

  const coupon = await stripe.coupons.create(
    {
      percent_off: PERCENT_OFF,
      duration: "once",
      name: "Launch — 20% off first month (Pro Max)",
      ...(proMaxProduct ? { applies_to: { products: [proMaxProduct] } } : {}),
    },
    { idempotencyKey: `launch-coupon-20off-once-${mode.toLowerCase()}-v1` },
  )
  console.log(`Created coupon: ${coupon.id}`)

  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: CODE,
    active: true,
  } as unknown as Stripe.PromotionCodeCreateParams)
  console.log(`Created promotion code: ${promo.id} (${promo.code})`)
  console.log(`\nDone. If you ever want auto-attach: STRIPE_LAUNCH_PROMOTION_CODE_ID=${promo.id}`)
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e)
  process.exit(1)
})
