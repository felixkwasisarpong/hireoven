import { createAdminClient } from "@/lib/supabase/admin"
import type { WebPushSubscription } from "@/types"

function normalizeSubscription(
  subscription: PushSubscription | WebPushSubscription
): WebPushSubscription {
  const rawValue =
    typeof (subscription as PushSubscription).toJSON === "function"
      ? (subscription as PushSubscription).toJSON()
      : subscription
  const value = rawValue as Partial<WebPushSubscription> | null

  if (
    !value ||
    typeof value.endpoint !== "string" ||
    !value.keys?.auth ||
    !value.keys?.p256dh
  ) {
    throw new Error("Invalid push subscription payload")
  }

  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: {
      auth: value.keys.auth,
      p256dh: value.keys.p256dh,
    },
  }
}

export async function savePushSubscription(
  userId: string,
  subscription: PushSubscription | WebPushSubscription
): Promise<void> {
  const supabase = createAdminClient()
  const normalized = normalizeSubscription(subscription)

  const { data: existing } = await ((supabase.from("push_subscriptions") as any)
    .select("id")
    .eq("user_id", userId)
    .contains("subscription", { endpoint: normalized.endpoint })
    .maybeSingle())

  if (existing?.id) {
    const { error } = await ((supabase.from("push_subscriptions") as any)
      .update({ subscription: normalized } as any)
      .eq("id", existing.id))

    if (error) throw error
    return
  }

  const { error } = await ((supabase.from("push_subscriptions") as any)
    .insert({
      user_id: userId,
      subscription: normalized,
    } as any))

  if (error) throw error
}

export async function getUserSubscriptions(
  userId: string
): Promise<WebPushSubscription[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("subscription")
    .eq("user_id", userId)

  if (error) throw error

  return ((data ?? []) as Array<{ subscription: WebPushSubscription | null }>)
    .map((row) => row.subscription)
    .filter((value): value is WebPushSubscription => Boolean(value))
}

export async function removeSubscription(
  subscriptionEndpoint: string
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await ((supabase.from("push_subscriptions") as any)
    .delete()
    .contains("subscription", { endpoint: subscriptionEndpoint }))

  if (error) throw error
}
