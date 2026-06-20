import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  })

  // Goldman Sachs — capture Apollo GraphQL API call
  {
    const page = await context.newPage()
    const gqlCalls: string[] = []
    const gqlBodies: string[] = []
    page.on("request", req => {
      const u = req.url()
      if (/higher\.gs\.com/.test(u) && !/\.(js|css|png|jpg|gif|ico|woff)/.test(u)) {
        gqlCalls.push(u.slice(0, 150))
        try { const b = req.postData(); if (b) gqlBodies.push(b.slice(0,200)) } catch{}
      }
    })
    page.on("response", async res => {
      const u = res.url()
      if (/higher\.gs\.com/.test(u) && !/\.(js|css|png|jpg|gif|ico)/.test(u)) {
        try {
          const ct = res.headers()["content-type"] || ""
          if (ct.includes("json")) {
            const body = await res.text()
            gqlBodies.push("RESPONSE: " + body.slice(0, 300))
          }
        } catch {}
      }
    })
    await page.goto("https://higher.gs.com/results?page=1", { waitUntil: "networkidle", timeout: 25000 }).catch(()=>{})
    await page.waitForTimeout(4000)
    console.log("=== GS API calls ===")
    gqlCalls.forEach(u => console.log(" REQ:", u))
    gqlBodies.slice(0,5).forEach(b => console.log(" DATA:", b))
    await page.close()
  }

  // Varo — extended wait + intercept all fetch/XHR
  {
    const page = await context.newPage()
    const allReqs: string[] = []
    page.on("request", req => allReqs.push(`[${req.method()}] ${req.url().slice(0,120)}`))
    await page.goto("https://www.varo.com/careers", { waitUntil: "networkidle", timeout: 25000 }).catch(()=>{})
    await page.waitForTimeout(6000)
    // Scroll to trigger lazy load
    await page.evaluate(() => window.scrollBy(0, 1000))
    await page.waitForTimeout(3000)
    const jobReqs = allReqs.filter(u => /job|career|position|opening|ats|greenhouse|lever|ashby|workday|icims/i.test(u))
    console.log("\n=== Varo all job-related requests ===")
    jobReqs.forEach(u => console.log(" ", u))
    if (!jobReqs.length) {
      console.log("No job requests — dumping all XHR/fetch:")
      allReqs.filter(u => u.startsWith("[POST]") || (u.startsWith("[GET]") && /api|json|data/i.test(u))).slice(0,10).forEach(u=>console.log(" ",u))
    }
    await page.close()
  }

  // Rippling open-roles page
  {
    const page = await context.newPage()
    const reqs: string[] = []
    page.on("request", req => reqs.push(`[${req.method()}] ${req.url().slice(0,130)}`))
    await page.goto("https://www.rippling.com/careers/open-roles", { waitUntil: "networkidle", timeout: 30000 }).catch(()=>{})
    await page.waitForTimeout(4000)
    const jobReqs = reqs.filter(u => /api|job|career|position|ats|icims|greenhouse|lever|ashby/i.test(u))
    console.log("\n=== Rippling open-roles requests ===")
    jobReqs.slice(0,10).forEach(u=>console.log(" ",u))
    const links: string[] = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a:any) => a.href as string)
        .filter(h => /job|career|position|role|opening/i.test(h))
        .slice(0, 6)
    )
    console.log("Job links:", links)
    await page.close()
  }

  await browser.close()
}

main().catch(console.error)
