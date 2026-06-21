import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractCompanyDomains, fetchPortfolioDomains } from "./vc-portfolios"

test("extractCompanyDomains: normalizes, dedupes, drops own + social hosts", () => {
  const html = `
    <a href="https://www.Acme.com/">Acme</a>
    <a href="https://acme.com/about">Acme again</a>
    <a href="https://globex.io">Globex</a>
    <a href="https://twitter.com/fund">Twitter</a>
    <a href="https://www.linkedin.com/company/fund">LinkedIn</a>
    <a href="https://x.com/fund">X</a>
    <a href="https://crunchbase.com/org/acme">CB</a>
    <a href="https://github.com/acme">GH</a>
    <a href="https://thefund.com/team">Own page</a>
    <a href="/relative/path">Relative</a>
    <a href="#anchor">Anchor</a>
    <a href="mailto:hi@thefund.com">Mail</a>
  `
  const domains = extractCompanyDomains(html, "thefund.com")
  assert.deepEqual(domains, ["acme.com", "globex.io"])
})

test("extractCompanyDomains: excludes the VC's own domain and subdomains", () => {
  const html = `
    <a href="https://thefund.com/portfolio">Portfolio</a>
    <a href="https://blog.thefund.com/post">Blog</a>
    <a href="https://realcompany.com">Real</a>
  `
  assert.deepEqual(extractCompanyDomains(html, "www.thefund.com"), ["realcompany.com"])
})

test("extractCompanyDomains: drops social subdomains and asset hosts", () => {
  const html = `
    <a href="https://business.facebook.com/fund">FB business</a>
    <a href="https://cdn.cloudfront.net/logo.png">asset</a>
    <a href="https://stripe.com">Stripe</a>
  `
  assert.deepEqual(extractCompanyDomains(html), ["stripe.com"])
})

test("fetchPortfolioDomains: returns parsed domains via injected fetchImpl", async () => {
  const html =
    '<a href="https://acme.com">Acme</a><a href="https://globex.io">Globex</a>'
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as Response) as unknown as typeof fetch

  const domains = await fetchPortfolioDomains(
    { name: "Test Fund", url: "https://thefund.com/portfolio/" },
    { fetchImpl }
  )
  assert.deepEqual(domains.sort(), ["acme.com", "globex.io"])
})

test("fetchPortfolioDomains: returns [] on non-2xx", async () => {
  const fetchImpl = (async () =>
    ({ ok: false, status: 503 }) as unknown as Response) as unknown as typeof fetch
  const domains = await fetchPortfolioDomains(
    { name: "Test Fund", url: "https://thefund.com/portfolio/" },
    { fetchImpl }
  )
  assert.deepEqual(domains, [])
})

test("fetchPortfolioDomains: returns [] when fetch throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down")
  }) as unknown as typeof fetch
  const domains = await fetchPortfolioDomains(
    { name: "Test Fund", url: "https://thefund.com/portfolio/" },
    { fetchImpl }
  )
  assert.deepEqual(domains, [])
})
