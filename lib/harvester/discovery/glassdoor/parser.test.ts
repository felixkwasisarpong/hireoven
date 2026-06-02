import fs from "node:fs"
import path from "node:path"
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { parseGlassdoorCompanyCandidates } from "./parser"

test("parseGlassdoorCompanyCandidates extracts company names only from fixture HTML", () => {
  const html = fs.readFileSync(
    path.join(process.cwd(), "lib/harvester/discovery/glassdoor/__fixtures__/company-search.html"),
    "utf8"
  )
  const candidates = parseGlassdoorCompanyCandidates({
    html,
    sourceUrl: "https://www.glassdoor.com/Explore/browse-companies.htm?keyword=software",
    sectorKeyword: "software",
    locationKeyword: "United States",
  })

  assert.deepEqual(
    candidates.map((candidate) => candidate.companyNameNormalized).sort(),
    ["databricks", "openai", "palo alto networks", "snowflake", "stripe"]
  )
  assert.equal(candidates[0].sourceName, "glassdoor")
  assert.equal(candidates[0].discoveredSectorKeyword, "software")
  assert.equal(candidates[0].discoveredLocationKeyword, "United States")
  assert.ok(candidates.every((candidate) => !/review|salary|job/i.test(candidate.companyNameRaw)))
})
