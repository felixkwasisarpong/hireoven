import { resolveDirectAtsUrl, type RenderHtml } from "@/lib/companies/ats-url-resolver"
import type { Browser } from "playwright"

process.on("uncaughtException", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("uncaughtException:", err)
})
process.on("unhandledRejection", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("unhandledRejection:", err)
})

const SAMPLES = [
  { name: "Affirm", url: "https://www.affirm.com/careers", ats: "greenhouse" },
  { name: "Anthropic", url: "https://www.anthropic.com/careers", ats: "greenhouse" },
  { name: "Anduril", url: "https://www.anduril.com/careers/", ats: "greenhouse" },
  { name: "Aflac", url: "https://careers.aflac.com", ats: "workday" },
  { name: "Akamai", url: "https://www.akamai.com/careers", ats: "workday" },
  { name: "Adyen", url: "https://www.adyen.com/careers", ats: "smartrecruiters" },
]

async function main() {
  console.log(`Launching Playwright...`)
  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({ headless: true })
  const render: RenderHtml = async (url: string) => {
    let context, page
    try {
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
      })
      page = await context.newPage()
      await page.route("**/*", (route) => {
        const t = route.request().resourceType()
        if (t === "image" || t === "media" || t === "font") return route.abort()
        return route.continue()
      })
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 18_000 })
      try { await page.waitForLoadState("networkidle", { timeout: 4000 }) } catch {}
      return await page.content()
    } catch (e) {
      console.log(`  render error for ${url}: ${(e as Error).message}`)
      return null
    } finally {
      try { await page?.close() } catch {}
      try { await context?.close() } catch {}
    }
  }

  for (const s of SAMPLES) {
    const t0 = Date.now()
    const result = await resolveDirectAtsUrl(s.url, {
      atsType: s.ats,
      companyName: s.name,
      renderHtml: render,
    })
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    if (result) {
      console.log(`✅ ${s.name.padEnd(15)} (${elapsed}s) → [${result.provider}] ${result.directUrl}`)
    } else {
      console.log(`❌ ${s.name.padEnd(15)} (${elapsed}s) → unresolved`)
    }
  }

  await browser.close()
  process.exit(0)
}

main()
