import { strict as assert } from "node:assert"
import { test } from "node:test"
import { parseBuiltinCompanies, builtinPageHasCompanies } from "./parser"

const SAMPLE = `
<div class="company-card">
  <a href="/company/halter" target="_blank" class="company-card-overlay" data-track-id="profile" aria-label="View Halter company profile"></a>
  <a href="/company/halter" target="_blank" data-track-id="logo"></a>
</div>
<div class="company-card">
  <a href="/company/bae-systems" target="_blank" class="company-card-overlay" aria-label="View BAE Systems, Inc. company profile"></a>
</div>
<div class="company-card">
  <a href="/company/tapestry" class="company-card-overlay" aria-label="View Tapestry &amp; Coach company profile"></a>
</div>
`

test("parseBuiltinCompanies: extracts slug + name, deduped", () => {
  const got = parseBuiltinCompanies(SAMPLE)
  assert.deepEqual(got, [
    { slug: "halter", name: "Halter" },
    { slug: "bae-systems", name: "BAE Systems, Inc." },
    { slug: "tapestry", name: "Tapestry & Coach" }, // entity decoded
  ])
})

test("parseBuiltinCompanies: empty / non-listing HTML yields nothing", () => {
  assert.deepEqual(parseBuiltinCompanies(""), [])
  assert.deepEqual(parseBuiltinCompanies("<html><body>no companies</body></html>"), [])
})

test("builtinPageHasCompanies: detects end-of-pagination", () => {
  assert.equal(builtinPageHasCompanies(SAMPLE), true)
  assert.equal(builtinPageHasCompanies("<html>nothing here</html>"), false)
})
