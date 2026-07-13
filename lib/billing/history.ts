import { getPostgresPool } from "@/lib/postgres/server"
import { FEATURE_PACKS, isPackKey } from "@/lib/billing/packs"

type SubscriptionStripeRow = {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export type BillingHistoryItem = {
  id: string
  createdAt: string | null
  description: string
  amountCents: number
  currency: string
  status: string
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
}

export type BillingHistorySnapshot = {
  history: BillingHistoryItem[]
  summary: {
    nextRenewalAt: string | null
    nextAmountCents: number | null
    currency: string | null
  }
}

function fromUnixSeconds(value: number | null | undefined): string | null {
  if (typeof value !== "number") return null
  return new Date(value * 1000).toISOString()
}

function normalizeCurrency(code: string | null | undefined): string {
  if (!code || typeof code !== "string") return "USD"
  return code.toUpperCase()
}

/**
 * One-time purchases (interview credit packs, feature credit packs) don't
 * produce Stripe invoices, so the invoice list alone shows subscribers-only
 * history. Merge in the DB-side purchase records so every charge a user made
 * appears in one ledger.
 */
async function getOneTimePurchaseHistory(userId: string): Promise<BillingHistoryItem[]> {
  const pool = getPostgresPool()
  const [creditTxns, packs] = await Promise.all([
    pool.query<{ id: string; amount: number; reason: string; created_at: string; stripe_payment_intent_id: string | null }>(
      `SELECT id, amount, reason, created_at, stripe_payment_intent_id
       FROM interview_credit_transactions
       WHERE user_id = $1 AND reason IN ('purchase', 'stripe_refund')
       ORDER BY created_at DESC
       LIMIT 12`,
      [userId],
    ),
    pool.query<{ id: string; pack_key: string; credits_granted: number; amount_cents: number | null; created_at: string; refunded_at: string | null }>(
      `SELECT id, pack_key, credits_granted, amount_cents, created_at, refunded_at
       FROM feature_credit_packs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [userId],
    ),
  ])

  // Interview credit purchase price isn't stored locally — resolve it from the
  // payment intent when possible (bounded: ≤12 lookups).
  const piAmounts = new Map<string, { amount: number; currency: string }>()
  if (process.env.STRIPE_SECRET_KEY) {
    const Stripe = (await import("stripe")).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })
    const ids = [...new Set(creditTxns.rows.map((r) => r.stripe_payment_intent_id).filter((v): v is string => Boolean(v)))]
    const results = await Promise.allSettled(ids.map((id) => stripe.paymentIntents.retrieve(id)))
    results.forEach((res, i) => {
      if (res.status === "fulfilled") {
        piAmounts.set(ids[i], { amount: res.value.amount, currency: normalizeCurrency(res.value.currency) })
      }
    })
  }

  const creditItems: BillingHistoryItem[] = creditTxns.rows.map((row) => {
    const pi = row.stripe_payment_intent_id ? piAmounts.get(row.stripe_payment_intent_id) : undefined
    const isRefund = row.reason === "stripe_refund"
    return {
      id: `credit-${row.id}`,
      createdAt: new Date(row.created_at).toISOString(),
      description: isRefund
        ? `Refund — ${Math.abs(row.amount)} live interview credit${Math.abs(row.amount) === 1 ? "" : "s"}`
        : `${row.amount} live interview credit${row.amount === 1 ? "" : "s"}`,
      amountCents: pi ? (isRefund ? -pi.amount : pi.amount) : 0,
      currency: pi?.currency ?? "USD",
      status: isRefund ? "refunded" : "paid",
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    }
  })

  const packItems: BillingHistoryItem[] = packs.rows.map((row) => ({
    id: `pack-${row.id}`,
    createdAt: new Date(row.created_at).toISOString(),
    description: isPackKey(row.pack_key)
      ? `Credit pack: ${FEATURE_PACKS[row.pack_key].label}`
      : `Credit pack (${row.credits_granted} credits)`,
    amountCents: row.amount_cents ?? 0,
    currency: "USD",
    status: row.refunded_at ? "refunded" : "paid",
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
  }))

  return [...creditItems, ...packItems]
}

function sortHistoryDesc(items: BillingHistoryItem[]): BillingHistoryItem[] {
  return items
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 20)
}

export async function getBillingHistoryByUserId(userId: string): Promise<BillingHistorySnapshot> {
  const pool = getPostgresPool()
  const rowResult = await pool.query<SubscriptionStripeRow>(
    `SELECT stripe_customer_id, stripe_subscription_id
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId],
  )

  const oneTimeItems = await getOneTimePurchaseHistory(userId).catch(() => [] as BillingHistoryItem[])

  const sub = rowResult.rows[0]
  if (!sub?.stripe_customer_id || !process.env.STRIPE_SECRET_KEY) {
    return {
      history: sortHistoryDesc(oneTimeItems),
      summary: {
        nextRenewalAt: null,
        nextAmountCents: null,
        currency: null,
      },
    }
  }

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  const [invoiceListResult, upcomingResult, stripeSubResult] = await Promise.allSettled([
    stripe.invoices.list({
      customer: sub.stripe_customer_id,
      limit: 12,
    }),
    stripe.invoices.createPreview({
      customer: sub.stripe_customer_id,
    }),
    sub.stripe_subscription_id
      ? stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      : Promise.resolve(null),
  ])

  const history: BillingHistoryItem[] =
    invoiceListResult.status === "fulfilled"
      ? invoiceListResult.value.data.map((invoice) => {
          const amountCents =
            typeof invoice.amount_paid === "number" && invoice.amount_paid > 0
              ? invoice.amount_paid
              : typeof invoice.amount_due === "number" && invoice.amount_due > 0
                ? invoice.amount_due
                : typeof invoice.total === "number"
                  ? invoice.total
                  : 0

          return {
            id: invoice.id,
            createdAt: fromUnixSeconds(invoice.created),
            description:
              invoice.lines?.data?.[0]?.description ??
              invoice.description ??
              "Subscription invoice",
            amountCents,
            currency: normalizeCurrency(invoice.currency),
            status: invoice.status ?? "unknown",
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            invoicePdfUrl: invoice.invoice_pdf ?? null,
          }
        })
      : []

  let nextRenewalAt: string | null = null
  let nextAmountCents: number | null = null
  let currency: string | null = null

  if (upcomingResult.status === "fulfilled") {
    nextRenewalAt = fromUnixSeconds(upcomingResult.value.period_end)
    nextAmountCents =
      typeof upcomingResult.value.amount_due === "number"
        ? upcomingResult.value.amount_due
        : typeof upcomingResult.value.total === "number"
          ? upcomingResult.value.total
          : null
    currency = normalizeCurrency(upcomingResult.value.currency)
  }

  if (!nextRenewalAt && stripeSubResult.status === "fulfilled" && stripeSubResult.value) {
    const subscription = stripeSubResult.value as any
    nextRenewalAt = fromUnixSeconds(
      subscription.current_period_end ??
      subscription.items?.data?.[0]?.current_period_end ??
      null
    )
  }

  if (nextAmountCents === null && stripeSubResult.status === "fulfilled" && stripeSubResult.value) {
    const amount = stripeSubResult.value.items?.data?.[0]?.price?.unit_amount
    if (typeof amount === "number") nextAmountCents = amount
    if (!currency) currency = normalizeCurrency(stripeSubResult.value.items?.data?.[0]?.price?.currency)
  }

  return {
    history: sortHistoryDesc([...history, ...oneTimeItems]),
    summary: {
      nextRenewalAt,
      nextAmountCents,
      currency,
    },
  }
}
