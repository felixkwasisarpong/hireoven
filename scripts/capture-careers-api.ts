/**
 * Capture the real JSON job-search API a careers site calls, by loading it in a
 * browser and logging the XHR/fetch JSON responses. Reusable for reverse-
 * engineering the top-firm custom adapters (Microsoft/Google/Meta/Tesla/Netflix)
 * whose private API endpoints aren't guessable.
 *
 *   npx tsx scripts/capture-careers-api.ts "https://jobs.careers.microsoft.com/global/en/search"
 */

const TARGET = process.argv[2]
if (!TARGET) { console.error("usage: tsx scripts/capture-careers-api.ts <careers-search-url>"); process.exit(1) }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const JOBISH = /job|title|requisition|posting|position|opening|vacanc|result/i

async function main() {
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()

  const seen = new Set<string>()
  page.on("response", async (resp) => {
    try {
      const ct = (resp.headers()["content-type"] ?? "").toLowerCase()
      if (!ct.includes("json")) return
      const url = resp.url()
      const key = url.split("?")[0]
      if (seen.has(key)) return
      const body = await resp.text().catch(() => "")
      if (body.length < 150 || !JOBISH.test(body)) return
      seen.add(key)
      console.log("\n──────────────────────────────────────────")
      console.log("API:", url)
      console.log("status:", resp.status(), "| ct:", ct, "| bytes:", body.length)
      console.log("body head:", body.slice(0, 280).replace(/\s+/g, " "))
    } catch { /* ignore */ }
  })

  console.log(`loading ${TARGET} ...`)
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {})
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {})
  // Some sites lazy-load results on scroll/interaction.
  await page.mouse.wheel(0, 2000).catch(() => {})
  await page.waitForTimeout(5_000)

  await ctx.close().catch(() => {}); await browser.close().catch(() => {})
  if (seen.size === 0) console.log("\n(no job-ish JSON API observed — site may render server-side or gate XHR)")
}

main().catch((e) => { console.error(e); process.exit(1) })
