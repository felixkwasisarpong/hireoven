/**
 * Opens a visible (headed) browser to Wellfound so you can solve the DataDome
 * CAPTCHA (and optionally log in), then saves the resulting browser storage
 * state to a JSON file you can pass back to the discover script.
 *
 * Usage:
 *   npx tsx scripts/capture-wellfound-session.ts
 *   npx tsx scripts/capture-wellfound-session.ts --out=./my-state.json
 *
 * After running, use the output file with:
 *   npm run discover:startup-directories:execute -- \
 *     --sources=wellfound --storage-state=./playwright-wellfound-state.json
 */

import path from "node:path"
import readline from "node:readline"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = args.find((v) => v.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1) return args[idx + 1]
  return undefined
}

const outPath = flag("out") || path.join(process.cwd(), "playwright-wellfound-state.json")
const WELLFOUND_URL = "https://wellfound.com/companies"

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

async function main() {
  const { chromium } = await import("playwright")

  console.log("\n── Wellfound session capture ────────────────────────────")
  console.log(`  output: ${outPath}`)
  console.log("─────────────────────────────────────────────────────────\n")

  // Use the real Chrome install (not Playwright's Chromium) so DataDome sees
  // a genuine browser fingerprint instead of an automation-flagged Chromium.
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  })

  const context = await browser.newContext({
    locale: "en-US",
    viewport: null,
  })

  // Remove the webdriver flag that DataDome checks for.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  })

  const page = await context.newPage()

  console.log(`Opening ${WELLFOUND_URL} …`)
  await page.goto(WELLFOUND_URL, { waitUntil: "domcontentloaded", timeout: 45_000 })

  console.log("\nThe browser is open. Do one of the following:")
  console.log("  1. Solve the CAPTCHA if DataDome shows a challenge")
  console.log("  2. Log in to Wellfound (optional, improves coverage)")
  console.log("  3. Browse around until the companies list loads normally")
  console.log("\nPress ENTER here when you're done and the page looks right.")

  await waitForEnter("\nReady? Press ENTER to save session and exit … ")

  await context.storageState({ path: outPath })
  console.log(`\nSession saved → ${outPath}`)
  console.log("\nNow run:")
  console.log(
    `  npm run discover:startup-directories:execute -- --sources=wellfound --storage-state=${outPath}\n`
  )

  await browser.close()
}

main().catch((error) => {
  console.error("[capture-wellfound-session] fatal:", error)
  process.exit(1)
})
