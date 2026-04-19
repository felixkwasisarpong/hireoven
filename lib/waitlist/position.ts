import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types"

/** 1-based position: earlier joiners get lower numbers. */
export async function getWaitlistPosition(
  supabase: SupabaseClient<Database>,
  joinedAt: string
) {
  const { count, error } = await supabase
    .from("waitlist")
    .select("*", { count: "exact", head: true })
    .lte("joined_at", joinedAt)

  if (error) throw error
  return count ?? 1
}
