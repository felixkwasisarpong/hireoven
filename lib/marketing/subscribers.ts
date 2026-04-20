import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex")
}

export async function upsertMarketingSubscriber({
  email,
  fullName,
  source,
  metadata,
}: {
  email: string
  fullName?: string | null
  source?: string
  metadata?: Record<string, unknown>
}) {
  const supabase = createAdminClient()
  const normalizedEmail = normalizeEmail(email)

  const { data: existing } = await ((supabase.from("marketing_subscribers") as any)
    .select("id, email, unsubscribe_token")
    .eq("email", normalizedEmail)
    .maybeSingle())

  const token = existing?.unsubscribe_token ?? generateToken()
  const payload = {
    email: normalizedEmail,
    full_name: fullName ?? null,
    source: source ?? "app",
    subscribed_to_marketing: true,
    unsubscribed_at: null,
    unsubscribe_token: token,
    metadata: metadata ?? {},
  }

  await ((supabase.from("marketing_subscribers") as any).upsert(payload, {
    onConflict: "email",
  }))

  return { email: normalizedEmail, unsubscribeToken: token }
}

export async function unsubscribeMarketingByToken(token: string) {
  const supabase = createAdminClient()

  const { data: subscriber } = await ((supabase.from("marketing_subscribers") as any)
    .select("id, email")
    .eq("unsubscribe_token", token)
    .maybeSingle())

  if (!subscriber?.id) return null

  await ((supabase.from("marketing_subscribers") as any)
    .update({
      subscribed_to_marketing: false,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq("id", subscriber.id))

  return { id: subscriber.id, email: subscriber.email as string }
}

export function buildMarketingUnsubscribeUrl(token: string) {
  const site = getPublicSiteUrl()
  const url = new URL("/api/marketing/unsubscribe", site)
  url.searchParams.set("token", token)
  return url.toString()
}
