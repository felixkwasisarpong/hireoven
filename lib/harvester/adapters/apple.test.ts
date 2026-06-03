import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractAppleDescriptionFromText } from "./apple"

test("apple: extractAppleDescriptionFromText anchors after posted header and removes footer text", () => {
  const bodyText = `
Open Menu Close Menu
Apple
Back to search results
Software Engineer, Apple Services
Austin, Texas, United States
Submit Resume
Summary
Posted: June 2, 2026
This role builds reliable services for customer-facing products. You will partner with product, design, and operations teams to ship maintainable systems.

You should bring practical experience with distributed systems, observability, incident response, and clear technical communication.

Minimum Qualifications
5+ years of software engineering experience.
Experience with TypeScript, backend services, cloud infrastructure, and production debugging.

Preferred Qualifications
Ability to mentor engineers, simplify ambiguous requirements, and improve service quality over time.
Apple Footer
Privacy Policy
`

  const description = extractAppleDescriptionFromText(bodyText)

  assert.ok(description)
  assert.match(description, /^This role builds reliable services/)
  assert.match(description, /Minimum Qualifications/)
  assert.doesNotMatch(description, /Open Menu Close Menu/)
  assert.doesNotMatch(description, /Apple Footer/)
})

test("apple: extractAppleDescriptionFromText rejects short page chrome", () => {
  assert.equal(
    extractAppleDescriptionFromText("Back to search results\nPosted: June 2, 2026\nTiny."),
    null
  )
})
