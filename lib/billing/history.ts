import { getPostgresPool } from "@/lib/postgres/server"

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

  const sub = rowResult.rows[0]
  if (!sub?.stripe_customer_id || !process.env.STRIPE_SECRET_KEY) {
    return {
      history: [],
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
    history,
    summary: {
      nextRenewalAt,
      nextAmountCents,
      currency,
    },
  }
}
