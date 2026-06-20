import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  
  await page.goto('https://careers.bakerhughes.com/global/en/search-results', {waitUntil:'networkidle', timeout:40000})
  await page.waitForTimeout(4000)
  
  // Get total job count from page
  const totalText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'))
    return els.filter(el => /\d+\s*(job|result|position)/i.test(el.textContent || '') && el.children.length === 0)
              .map(el => el.textContent?.trim())
              .filter(t => t && t.length < 100)
              .slice(0, 10)
  })
  console.log('Total job texts:', totalText)
  
  // Get all job links from page  
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/en/job/"]')).map((a) => (a as HTMLAnchorElement).href)
  )
  console.log('Job links on page 1:', links.length, links.slice(0,3))
  
  // Try to find total via window variables
  const windowVars = await page.evaluate(() => {
    const win = window as any
    const keys = Object.keys(win).filter(k => /job|total|count|phenom|ph/i.test(k))
    return keys.map(k => ({ key: k, val: JSON.stringify(win[k])?.slice(0, 100) }))
  })
  console.log('Window vars:', windowVars.slice(0,10))
  
  // Look at the HTML for total count
  const html = await page.content()
  const totalMatch = html.match(/(\d{3,5})\s*(?:jobs|results|positions)/i)
  console.log('Total from HTML:', totalMatch?.[0])
  
  // Try direct Solr/Elasticsearch endpoint
  const solrResp = await page.evaluate(async () => {
    const r = await fetch('https://content-us.phenompeople.com/api/BAHUGLOBAL/getjobsV2?searchText=&locale=en_global&siteType=external&deviceType=desktop&from=0&size=20', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ searchText: '', locale: 'en_global', siteType: 'external', from: 0, size: 20 })
    })
    return { status: r.status, body: await r.text().then(t => t.slice(0, 400)) }
  }).catch(() => null)
  console.log('\nSolr/V2 attempt:', JSON.stringify(solrResp))
  
  await browser.close()
}
main().catch(console.error)
