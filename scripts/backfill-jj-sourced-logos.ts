/**
 * One-off: resolve real domains + logos for the placeholder companies created
 * by reattribute-jackjill-jobs.ts (domain like `jj-*.sourced`, no logo).
 *
 * For each, guess candidate domains from the name and accept one only when BOTH
 * signals agree: logo.dev returns a real-sized image (>= MIN_LOGO_BYTES, i.e.
 * not its tiny generated monogram) AND the site's <title> contains the company
 * name token. Confident matches set logo_url (and the real domain); the rest
 * stay placeholders and are reported.
 *
 *   npx tsx scripts/backfill-jj-sourced-logos.ts            # dry-run
 *   npx tsx scripts/backfill-jj-sourced-logos.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())
const execute = process.argv.includes("--execute")

const TOKEN = "pk_MACdTFH8R7amdP1xzJHfow"
const MIN_LOGO_BYTES = 5000
const TLDS = ["com", "ai", "io", "co"]

type Comp = { id: string; name: string; domain: string }

function baseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/\b(inc|llc|corp|corporation|ltd|limited|co|the|group|technologies|technology|labs|systems)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim()
}
function nameToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean)[0] ?? ""
}
function candidates(name: string): string[] {
  const slug = baseSlug(name)
  if (!slug || slug.length < 2) return []
  const hasAi = /\bai\b/i.test(name)
  const out = new Set<string>()
  for (const tld of TLDS) out.add(`${slug}.${tld}`)
  if (hasAi) out.add(`${slug}ai.com`)
  return [...out]
}

async function logoBytes(domain: string): Promise<number> {
  try {
    const r = await fetch(`https://img.logo.dev/${domain}?token=${TOKEN}&size=256&format=png`)
    if (!r.ok) return 0
    const buf = await r.arrayBuffer()
    return buf.byteLength
  } catch {
    return 0
  }
}
async function titleMatches(domain: string, token: string): Promise<boolean> {
  if (!token) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(`https://${domain}`, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; HireovenLogoBot/1.0)" },
    })
    clearTimeout(t)
    if (!r.ok) return false
    const html = (await r.text()).slice(0, 20000)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toLowerCase()
    return title.includes(token)
  } catch {
    return false
  }
}

async function main() {
  console.log(`[jj-logos] mode=${execute ? "execute" : "dry-run"}`)
  const pool = getPostgresPool()
  const { rows } = await pool.query<Comp>(
    `SELECT id, name, domain FROM companies WHERE domain LIKE 'jj-%.sourced' AND COALESCE(NULLIF(logo_url,''),'')=''`
  )
  console.log(`[jj-logos] ${rows.length} placeholder companies`)

  // Pre-load existing domains so we don't collide when setting the real domain.
  const { rows: existing } = await pool.query<{ domain: string }>(`SELECT domain FROM companies`)
  const taken = new Set(existing.map((e) => e.domain.toLowerCase()))

  const limiter = pLimit(6)
  let matched = 0
  const unmatched: string[] = []

  await Promise.all(
    rows.map((c) =>
      limiter(async () => {
        const token = nameToken(c.name)
        for (const dom of candidates(c.name)) {
          const bytes = await logoBytes(dom)
          if (bytes < MIN_LOGO_BYTES) continue
          if (!(await titleMatches(dom, token))) continue
          // confident match
          const logoUrl = `https://img.logo.dev/${dom}?token=${TOKEN}&size=256&format=png`
          const canTakeDomain = !taken.has(dom.toLowerCase())
          if (execute) {
            if (canTakeDomain) {
              await pool.query(`UPDATE companies SET domain=$1, logo_url=$2 WHERE id=$3`, [dom, logoUrl, c.id])
              taken.add(dom.toLowerCase())
            } else {
              await pool.query(`UPDATE companies SET logo_url=$1 WHERE id=$2`, [logoUrl, c.id])
            }
          }
          matched++
          console.log(`  ✓ ${c.name} -> ${dom}${canTakeDomain ? "" : " (logo only, domain taken)"}`)
          return
        }
        unmatched.push(c.name)
      })
    )
  )

  console.log(`[jj-logos] matched=${matched} unmatched=${unmatched.length}`)
  console.log(`[jj-logos] unmatched: ${unmatched.join(" | ")}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
