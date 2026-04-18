import { createAdminClient } from "@/lib/supabase/admin"
import type { ApiUsageInsert } from "@/types"

export async function logApiUsage(entry: ApiUsageInsert) {
  try {
    const supabase = createAdminClient()
    await (supabase.from("api_usage") as any).insert(entry as any)
  } catch (error) {
    console.error("Failed to log api_usage", error)
  }
}
