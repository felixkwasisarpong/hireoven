import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanJobDescription,
  extractJobDescriptionFromHtml,
  fetchJobDescription,
  looksLikeBlockedOrErrorPage,
  parseJobDescriptionSections,
} from "@/lib/jobs/description"

const CHROME_PHRASES = [
  "Skip to main content",
  "Skip to content",
  "Sign in to create job alert",
  "Sign in to save",
  "Create job alert",
  "Create alert",
  "Get notified",
  "Apply now",
  "Save this job",
  "Share this job",
  "Back to results",
  "Back to search",
  "Related jobs",
  "Similar jobs",
  "Cookie policy",
  "Privacy policy",
]

function assertNoChrome(text: string | null, where: string) {
  if (!text) return
  for (const phrase of CHROME_PHRASES) {
    assert.equal(
      text.toLowerCase().includes(phrase.toLowerCase()),
      false,
      `${where}: contains chrome phrase "${phrase}"\n--- text ---\n${text}\n---`
    )
  }
}

test("cleanJobDescription strips line-level chrome from text input", () => {
  const input = [
    "Skip to main content",
    "Sign in",
    "Apply Now",
    "Save this job",
    "About the role",
    "We are building infrastructure for global hiring teams.",
    "Responsibilities:",
    "- Build and operate distributed services.",
    "- Partner with security to harden the platform.",
    "Requirements:",
    "- 5+ years of backend engineering experience.",
    "Cookie Policy",
    "Privacy Policy",
    "Back to results",
    "Related jobs",
  ].join("\n")

  const cleaned = cleanJobDescription(input)
  assert.ok(cleaned, "expected non-null cleaned description")
  assertNoChrome(cleaned, "cleanJobDescription text input")
  assert.ok(/distributed services/i.test(cleaned ?? ""))
  assert.ok(/5\+ years/i.test(cleaned ?? ""))
})

test("extractJobDescriptionFromHtml drops nav/footer/aside/auth chrome", () => {
  const html = `
<html>
  <head><title>Senior Engineer</title></head>
  <body>
    <header class="site-header">
      <nav><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/login">Sign in</a></nav>
    </header>
    <aside class="related-jobs">
      <h3>Related jobs</h3>
      <ul><li>Junior Engineer</li><li>Staff Engineer</li></ul>
    </aside>
    <div class="cookie-banner">We use cookies. Cookie Policy. Privacy Policy.</div>
    <div class="auth-prompt">Sign in to create job alert</div>
    <main>
      <h1>Senior Engineer</h1>
      <h2>About the role</h2>
      <p>Join our platform team building developer infrastructure for thousands of customers worldwide.</p>
      <h2>Responsibilities</h2>
      <ul>
        <li>Build and operate distributed backend services.</li>
        <li>Partner with product and security to harden the platform.</li>
      </ul>
      <h2>Requirements</h2>
      <ul>
        <li>6+ years of software engineering experience.</li>
        <li>Strong fluency in TypeScript or Go.</li>
      </ul>
    </main>
    <footer>
      <a>Apply now</a>
      <a>Save this job</a>
      <a>Share this job</a>
      <p>Cookie Policy &middot; Privacy Policy</p>
    </footer>
  </body>
</html>`

  const text = extractJobDescriptionFromHtml(html)
  assert.ok(text, "expected non-null text")
  assertNoChrome(text, "extractJobDescriptionFromHtml")
  assert.ok(/distributed backend services/i.test(text ?? ""))
  assert.ok(/6\+ years/i.test(text ?? ""))
})

test("extractJobDescriptionFromHtml drops Greenhouse-style chrome wrappers", () => {
  const html = `
<html><body>
  <div id="content">
    <div class="page-header">
      <a href="#">Skip to main content</a>
      <a href="/login">Sign in</a>
      <button>Apply now</button>
    </div>
    <h1>Backend Engineer</h1>
    <div class="job-description">
      <p>About the role: ship reliable APIs at scale to power our enterprise platform.</p>
      <p><strong>Responsibilities:</strong></p>
      <ul>
        <li>Design and build new backend services.</li>
        <li>Own deployment, monitoring, and on-call rotations.</li>
      </ul>
      <p><strong>Requirements:</strong></p>
      <ul>
        <li>4+ years of backend experience with Python or Go.</li>
        <li>Comfort with relational databases and distributed systems.</li>
      </ul>
    </div>
    <div class="cookie-banner">Cookie Policy &middot; Privacy Policy</div>
    <div class="related-jobs"><h3>Related jobs</h3></div>
  </div>
</body></html>`

  const text = extractJobDescriptionFromHtml(html, "greenhouse")
  assert.ok(text, "expected non-null text")
  assertNoChrome(text, "extractJobDescriptionFromHtml(greenhouse)")
  assert.ok(/backend services/i.test(text ?? ""))
})

test("parseJobDescriptionSections does not fragment a 'Category: values' skills list into fake headings", () => {
  // Real bug, found live in a Nike posting: "Languages:", "Frameworks:",
  // "Platforms:" etc. (plain category labels within a skills breakdown) each
  // got promoted to their own one-line "section", scattering the whole list
  // across unrelated buckets instead of staying together under its real
  // heading ("Preferred skills and experiences").
  const desc = [
    "We are looking for a senior engineer to join our growing platform team.",
    "",
    "Preferred skills and experiences:",
    "Leadership: Collaborative working style, excellent communication skills",
    "Languages: NodeJS, TypeScript, Python",
    "Frameworks: React, Express, NX monorepo",
    "Platforms: Docker, AWS, Azure",
  ].join("\n")

  const sections = parseJobDescriptionSections(desc)
  const headings = sections.map((s) => s.heading)
  assert.ok(headings.includes("Preferred skills and experiences"))
  assert.ok(!headings.includes("Leadership"), "'Leadership:' must not become its own heading")
  assert.ok(!headings.includes("Languages"), "'Languages:' must not become its own heading")
  assert.ok(!headings.includes("Frameworks"), "'Frameworks:' must not become its own heading")
  assert.ok(!headings.includes("Platforms"), "'Platforms:' must not become its own heading")
})

test("parseJobDescriptionSections does not promote chrome lines to headings", () => {
  const desc = [
    "SIGN IN",
    "MENU",
    "About the role",
    "We are building hiring infrastructure.",
    "Responsibilities",
    "- Build pipelines",
    "- Maintain services",
  ].join("\n")

  const sections = parseJobDescriptionSections(desc)
  const headings = sections.map((s) => s.heading?.toLowerCase() ?? "")
  assert.ok(!headings.includes("sign in"), "SIGN IN must not become a section heading")
  assert.ok(!headings.includes("menu"), "MENU must not become a section heading")
})

test("cleanJobDescription rejects content where most lines are chrome", () => {
  const mostlyChrome = [
    "Skip to main content",
    "Sign in",
    "Sign up",
    "Apply now",
    "Save this job",
    "Share this job",
    "Cookie policy",
    "Privacy policy",
    "Related jobs",
    "Similar jobs",
    "Back to results",
    "Get notified",
    "Create job alert",
    "Hello.",
  ].join("\n")

  const cleaned = cleanJobDescription(mostlyChrome)
  assert.equal(cleaned, null, "chrome-dominated input must be rejected")
})

test("fetchJobDescription prefers rich Lever HTML description over short plain field", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        descriptionPlain:
          "Founded in early 2021, Ibility is a Service-Disabled Veteran-Owned Small Business.",
        description: `
          <div>Founded in early 2021, Ibility is a Service-Disabled Veteran-Owned Small Business.</div>
          <div>
            <p><strong>Position Overview:</strong></p>
            <p>The Communications Products Specialist is a full-time position supporting a federal public health program focused on outreach, education, and stakeholder communications.</p>
            <p><strong>Key Responsibilities:</strong></p>
            <ul>
              <li>Develop healthcare-related promotional and educational materials.</li>
              <li>Create digital assets including graphics, infographics, and data visualizations.</li>
            </ul>
            <p><strong>Qualifications Required:</strong></p>
            <ul><li>Bachelor's degree in Communications, Public Health, Marketing, Graphic Design, English, or a closely related field.</li></ul>
          </div>
        `,
        lists: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch

  try {
    const description = await fetchJobDescription(
      "https://jobs.lever.co/ibility/d628175f-1f71-47b0-817c-b3ea55154c2c"
    )
    assert.ok(description, "expected Lever description")
    assert.match(description, /Position Overview/i)
    assert.match(description, /federal public health program/i)
    assert.match(description, /healthcare-related promotional/i)
    assert.match(description, /Bachelor's degree/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("looksLikeBlockedOrErrorPage flags short bot-wall/CDN error text", () => {
  assert.equal(
    looksLikeBlockedOrErrorPage(
      "Access Denied\nYou don't have permission to access \"http://www.infosys.com/404/\" on this server.\nReference #18.e50c0317\nhttps://errors.edgesuite.net/18.e50c0317"
    ),
    true
  )
  assert.equal(looksLikeBlockedOrErrorPage("Attention Required! | Cloudflare"), true)
  assert.equal(looksLikeBlockedOrErrorPage("Just a moment..."), true)
  assert.equal(looksLikeBlockedOrErrorPage(null), false)
  assert.equal(looksLikeBlockedOrErrorPage(""), false)
})

test("looksLikeBlockedOrErrorPage keeps real JDs that mention security terms", () => {
  const realJd =
    "We are hiring a Security Engineer. You will design systems that prevent access denied errors for customers, build captcha integrations, and harden APIs. " +
    "Responsibilities include: ".padEnd(1200, "x")
  assert.equal(looksLikeBlockedOrErrorPage(realJd), false)
})

// ── Breezy renders its UI strings as untranslated %TOKEN% placeholders ────────
// Every Breezy-sourced description carried them (16 of 16 in a recent sample),
// so the job page showed lines like "- %BUTTON_APPLY_USING_LINKED_IN%".

test("cleanJobDescription strips Breezy %PLACEHOLDER% chrome", () => {
  const raw = [
    "Dark Horse Tech",
    "Senior Subject Matter Expert - Analytics Navy FGEN",
    "- Norfolk, VA",
    "- %LABEL_POSITION_TYPE_FULL_TIME%",
    "- $120,000 - $135,000 / year",
    "- %BREADCRUMB_JOB_OPENINGS%",
    "- %BUTTON_APPLY_TO_POSITION%",
    "- %BUTTON_APPLY_USING_INDEED%",
    "- %BUTTON_APPLY_USING_LINKED_IN%",
    "The Senior Subject Matter Expert supports Navy surface ship analytics across",
    "the fleet, working with programme staff on requirements and sustainment.",
    "Experience in the United States Navy as a post-Major Command Commander afloat.",
    "Significant experience in Department of Defense major staffs, Echelon 2 or above.",
    "Recent experience analysing Navy Surface Ship Class requirements including",
    "manning, training, maintenance, equipping and life-cycle sustainment.",
    "%FOOTER_POWERED_BY% breezy",
  ].join("\n")

  const cleaned = cleanJobDescription(raw)
  assert.ok(cleaned, "description should survive cleaning")
  assert.equal((cleaned!.match(/%[A-Z0-9_]+%/g) ?? []).length, 0, "no placeholders should remain")
  // Trailing text after a token must not save the line from being stripped.
  assert.ok(!cleaned!.includes("breezy"), "footer line should be removed entirely")
  // Real content is preserved.
  assert.match(cleaned!, /Echelon 2/)
  assert.match(cleaned!, /life-cycle sustainment/)
  assert.match(cleaned!, /\$120,000/)
})

test("cleanJobDescription keeps lines that merely contain a percent sign", () => {
  const raw = [
    "We are hiring a Senior Data Analyst to join the platform team in Austin.",
    "Drive a 20% improvement in pipeline throughput across the reporting stack.",
    "Own dashboards used by 100% of the revenue organisation every single week.",
    "Partner with engineering on data quality, lineage and observability work.",
    "Five years of analytics experience with SQL, dbt and a warehouse platform.",
  ].join("\n")
  const cleaned = cleanJobDescription(raw)
  assert.ok(cleaned)
  assert.match(cleaned!, /20% improvement/)
  assert.match(cleaned!, /100% of the revenue/)
})
