import { strict as assert } from "node:assert"
import { test } from "node:test"
import { googleAdapter, parseAnchors, parseLocations } from "./google"

// Mirrors the real results-page markup: each card renders a heading
// "{title} <icon>corporate_fare</> Google <icon>place</> {location}" followed by
// a "Learn more" anchor carrying the id/slug + full title in its aria-label.
const FIXTURE = `
<li>
  <div class="hdg"><span>Business and Marketing Data Scientist, Applied Machine Learning</span>
    <i>corporate_fare</i><span>Google</span><i>place</i><span>New York, NY, USA; Mountain View, CA, USA</span>
  </div>
  <a class="WpHeLc" href="jobs/results/97146474826998470-business-and-marketing-data-scientist-applied-machine-learning?location=United+States" aria-label="Learn more about Business and Marketing Data Scientist, Applied Machine Learning"></a>
</li>
<li>
  <div class="hdg"><span>Director, Strategic Sourcing &amp; Ops</span>
    <i>corporate_fare</i><span>Google</span><i>place</i><span>Sunnyvale, CA, USA</span>
  </div>
  <a class="WpHeLc" href="jobs/results/139706431044494022-director-strategic-sourcing?location=United+States" aria-label="Learn more about Director, Strategic Sourcing &amp; Ops"></a>
</li>
`

test("google: detectFromUrl matches google careers, rejects others", () => {
  assert.deepEqual(
    googleAdapter.detectFromUrl("https://www.google.com/about/careers/applications/jobs/results/"),
    { slug: "google" }
  )
  assert.deepEqual(
    googleAdapter.detectFromUrl("https://careers.google.com/jobs/results/123"),
    { slug: "google" }
  )
  assert.equal(googleAdapter.detectFromUrl("https://www.google.com/search?q=x"), null)
  assert.equal(googleAdapter.detectFromUrl("https://careers.microsoft.com/"), null)
})

test("google: parseAnchors extracts id + slug + decoded title", () => {
  const cards = parseAnchors(FIXTURE)
  assert.equal(cards.length, 2)
  assert.equal(cards[0].id, "97146474826998470")
  assert.equal(cards[0].slug, "business-and-marketing-data-scientist-applied-machine-learning")
  assert.equal(cards[0].title, "Business and Marketing Data Scientist, Applied Machine Learning")
  // HTML entity in the title is decoded.
  assert.equal(cards[1].title, "Director, Strategic Sourcing & Ops")
})

test("google: parseLocations maps title→first location", () => {
  const map = parseLocations(FIXTURE)
  // Look them up the way the adapter does (normalized 40-char key); the first of
  // the semicolon-separated locations is kept.
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
  assert.equal(map.get(key("Business and Marketing Data Scientist, Applied Machine Learning")), "New York, NY, USA")
  assert.equal(map.get(key("Director, Strategic Sourcing & Ops")), "Sunnyvale, CA, USA")
})

test("google: adapter metadata", () => {
  assert.equal(googleAdapter.name, "google")
})
