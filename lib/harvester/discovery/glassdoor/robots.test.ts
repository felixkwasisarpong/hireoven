import { strict as assert } from "node:assert"
import { test } from "node:test"
import { checkRobotsAllowed, parseRobotsTxt } from "./robots"

test("parseRobotsTxt groups user agents and rules", () => {
  const groups = parseRobotsTxt(`
User-agent: *
Disallow: /private

User-agent: HireovenGlassdoorCompanyDiscoveryBot
Allow: /Explore/
Disallow: /
`)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].agents, ["*"])
  assert.equal(groups[1].rules.length, 2)
})

test("checkRobotsAllowed uses longest allow rule over broader disallow", () => {
  const robots = `
User-agent: *
Disallow: /
Allow: /Explore/
`
  const result = checkRobotsAllowed(
    robots,
    "https://www.glassdoor.com/Explore/browse-companies.htm?keyword=software",
    "HireovenGlassdoorCompanyDiscoveryBot/1.0"
  )
  assert.equal(result.allowed, true)
  assert.equal(result.reason, "allow:/Explore/")
})

test("checkRobotsAllowed disallows matching blocked paths", () => {
  const robots = `
User-agent: *
Allow: /
Disallow: /profile/login
`
  const result = checkRobotsAllowed(
    robots,
    "https://www.glassdoor.com/profile/login.htm",
    "HireovenGlassdoorCompanyDiscoveryBot/1.0"
  )
  assert.equal(result.allowed, false)
  assert.equal(result.reason, "disallow:/profile/login")
})

test("checkRobotsAllowed supports wildcard and end anchors", () => {
  const robots = `
User-agent: *
Disallow: /*/private$
`
  assert.equal(
    checkRobotsAllowed(robots, "https://www.glassdoor.com/a/private", "bot").allowed,
    false
  )
  assert.equal(
    checkRobotsAllowed(robots, "https://www.glassdoor.com/a/private/extra", "bot").allowed,
    true
  )
})
