const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.CRAWLER_PLAYWRIGHT_TIMEOUT_MS ?? "15000",
  10
)
const MAX_PER_RUN = Number.parseInt(process.env.CRAWLER_PLAYWRIGHT_MAX_PER_RUN ?? "3", 10)

let usedThisRun = 0

export function shouldUsePlaywrightFallback(reason: string | null | undefined) {
  if (process.env.CRAWLER_PLAYWRIGHT_ENABLED !== "true") return false
  if (usedThisRun >= Math.max(0, MAX_PER_RUN)) return false
  const normalized = (reason ?? "").toLowerCase()
  return (
    normalized.includes("403") ||
    normalized.includes("406") ||
    normalized.includes("blocked") ||
    normalized.includes("not_acceptable") ||
    normalized.includes("invalid_html") ||
    normalized.includes("empty")
  )
}

export async function renderCareersHtmlWithPlaywright(
  url: string,
  reason: string | null | undefined
): Promise<string | null> {
  if (!shouldUsePlaywrightFallback(reason)) return null
  usedThisRun += 1

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
    })
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
    })
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: Math.max(5000, DEFAULT_TIMEOUT_MS),
    })
    return await page.content()
  } catch {
    return null
  } finally {
    await browser.close()
  }
}
