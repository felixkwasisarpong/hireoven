import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const apiHits: {status:number,url:string,body:string}[] = []
  
  page.on('response', async resp => {
    const url = resp.url()
    if(!url.match(/\.(js|css|woff2?|png|jpg|gif|svg|ico)(\?.*)?$/)) {
      try {
        const b = await resp.text()
        if(b.includes('R156554') || (b.length < 30000 && b.includes('"title"') && b.includes('"location"') && b[0] === '{')) {
          apiHits.push({status:resp.status(), url:url.slice(0,150), body:b.slice(0,600)})
        }
      } catch {}
    }
  })
  
  await page.goto('https://careers.bakerhughes.com/global/en/search-results', {waitUntil:'load', timeout:40000})
  await page.waitForTimeout(4000)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3000)
  
  // Try offset URL
  await page.goto('https://careers.bakerhughes.com/global/en/search-results?from=10&start=10', {waitUntil:'load', timeout:30000})
  await page.waitForTimeout(3000)
  const links2 = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/en/job/"]')).map((a) => (a as HTMLAnchorElement).href)
  )
  console.log('Offset page job links:', links2.slice(0,5))
  const total = await page.evaluate(() => document.querySelector('[data-ph-at-id="jobs-count"]')?.textContent?.trim())
  console.log('Total jobs text:', total)
  
  console.log('\nAPI hits:', apiHits.length)
  apiHits.forEach(h => { console.log(h.status, h.url); console.log(h.body) })
  
  await browser.close()
}
main().catch(console.error)
