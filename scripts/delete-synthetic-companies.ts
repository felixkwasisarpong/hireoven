import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"

loadEnvConfig(process.cwd())

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const syntheticFilter = "name.ilike.Hireoven Seed Company %,domain.like.%.example.com"

  const { count: beforeCount, error: beforeError } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .or(syntheticFilter)

  if (beforeError) throw beforeError

  const { error: deleteError } = await supabase
    .from("companies")
    .delete()
    .or(syntheticFilter)

  if (deleteError) throw deleteError

  const { count: afterCount, error: afterError } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .or(syntheticFilter)

  if (afterError) throw afterError

  console.log(
    JSON.stringify({
      deleted: Math.max(0, (beforeCount ?? 0) - (afterCount ?? 0)),
      remainingSynthetic: afterCount ?? 0,
    })
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
