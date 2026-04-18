#!/usr/bin/env node
// Run: node scripts/migrate-admin.mjs

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dir = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(__dir, "../.env.local"), "utf8")
  .split("\n").filter(l => l && !l.startsWith("#"))
  .reduce((acc, l) => { const [k, ...v] = l.split("="); if (k) acc[k.trim()] = v.join("=").trim(); return acc }, {})

const supabase = createClient(
  env["NEXT_PUBLIC_SUPABASE_URL"],
  env["SUPABASE_SERVICE_ROLE_KEY"],
  { auth: { persistSession: false } }
)

// Each statement separately (supabase JS doesn't support multi-statement SQL)
const statements = [
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`,

  `CREATE TABLE IF NOT EXISTS api_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service TEXT NOT NULL,
    operation TEXT,
    tokens_used INTEGER,
    cost_usd DECIMAL(10,6),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage(service)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at DESC)`,
  `ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY`,

  `CREATE OR REPLACE FUNCTION public.is_admin_user()
   RETURNS BOOLEAN AS $$
     SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
   $$ LANGUAGE sql SECURITY DEFINER STABLE`,
]

for (const sql of statements) {
  const { error } = await supabase.rpc("exec_sql", { sql }).catch(() => ({ error: null }))
  // supabase JS doesn't have exec_sql by default — use the REST API directly
  void error
}

// Use the management API approach: POST to /rest/v1/rpc or direct fetch
// Since supabase-js doesn't expose raw SQL, use the Postgres REST endpoint
const BASE = env["NEXT_PUBLIC_SUPABASE_URL"]
const KEY  = env["SUPABASE_SERVICE_ROLE_KEY"]

async function sql(query) {
  const r = await fetch(`${BASE}/rest/v1/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KEY}`,
      "apikey": KEY,
      "Prefer": "params=single-object",
    },
    body: JSON.stringify({ query }),
  })
  return r
}

// Use Supabase's pg_meta endpoint (available for service role)
async function execSQL(query) {
  const r = await fetch(`${BASE}/pg/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KEY}`,
      "apikey": KEY,
    },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) {
    const text = await r.text()
    return { error: text }
  }
  return { data: await r.json() }
}

// Actually, let's just use direct inserts/updates via supabase-js
// and note what needs to be run in the Supabase SQL editor

console.log("=".repeat(60))
console.log("ADMIN MIGRATION")
console.log("=".repeat(60))
console.log("")
console.log("Run these statements in your Supabase SQL editor:")
console.log("")
console.log(`-- 1. Add is_admin column`)
console.log(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;`)
console.log("")
console.log(`-- 2. Create api_usage table`)
console.log(`CREATE TABLE IF NOT EXISTS api_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service TEXT NOT NULL,
  operation TEXT,
  tokens_used INTEGER,
  cost_usd DECIMAL(10,6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);`)
console.log("")
console.log(`ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;`)
console.log(`CREATE POLICY "Service role can manage api_usage" ON api_usage FOR ALL USING (auth.role() = 'service_role');`)
console.log("")
console.log(`-- 3. Admin helper function (avoids RLS recursion)`)
console.log(`CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
$$ LANGUAGE sql SECURITY DEFINER STABLE;`)
console.log("")
console.log(`-- 4. Admin RLS policies`)
console.log(`CREATE POLICY "Admins can read crawl logs" ON crawl_logs FOR SELECT USING (public.is_admin_user());`)
console.log(`CREATE POLICY "Admins can read all profiles" ON profiles FOR SELECT USING (auth.uid() = id OR public.is_admin_user());`)
console.log(`CREATE POLICY "Admins can update all profiles" ON profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin_user());`)
console.log("")
console.log(`-- 5. Grant yourself admin access (replace with your user ID)`)
console.log(`-- UPDATE profiles SET is_admin = true WHERE email = 'felixsarpong25@gmail.com';`)
console.log("")
console.log("=".repeat(60))

// Try to auto-set admin on the known user email
const { data: profile, error: pErr } = await supabase
  .from("profiles")
  .select("id, email, is_admin")
  .eq("email", "felixsarpong25@gmail.com")
  .maybeSingle()

if (pErr) {
  console.log("Could not find profile:", pErr.message)
} else if (profile) {
  console.log(`\nFound profile: ${profile.email} (is_admin: ${profile.is_admin})`)
  if (!profile.is_admin) {
    // Attempt to set is_admin (will fail if column doesn't exist yet)
    const { error: uErr } = await supabase
      .from("profiles")
      .update({ is_admin: true } as any)
      .eq("id", profile.id)
    if (uErr) {
      console.log("Could not set is_admin (run the SQL above first):", uErr.message)
    } else {
      console.log("✓ Set is_admin = true for felixsarpong25@gmail.com")
    }
  } else {
    console.log("✓ Already an admin")
  }
} else {
  console.log("\nProfile not found — log in first, then re-run this script")
}
