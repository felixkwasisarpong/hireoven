import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanJobDescription,
  extractJobDescriptionFromHtml,
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
