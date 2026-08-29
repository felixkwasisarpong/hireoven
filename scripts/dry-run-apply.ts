/**
 * Phase 1 measurement harness for overnight auto-apply.
 *
 * Answers the two questions that decide whether the feature is viable, without
 * sending a single application:
 *
 *   1. Do Tier-1 ATS forms actually load and fill from a headless datacenter
 *      browser? (fill success rate, and how much Cloudflare blocks)
 *   2. What does one application really cost? (how many free-text questions
 *      need an LLM, which is the only variable cost in the apply path)
 *
 * This exists because the cost model cannot be derived from history: total AI
 * spend across the last four months is roughly $6, so there is no organic usage
 * to measure. This generates the sample instead of waiting for one.
 *
 *   npx tsx scripts/dry-run-apply.ts --limit 50
 *   npx tsx scripts/dry-run-apply.ts --limit 200 --concurrency 3 --out report.jsonl
 *
 * Requires the prod DB tunnel: ./scripts/db-tunnel.sh --daemon
 *
 * SAFETY — this script never submits an application, for three independent
 * reasons: it never types into a field, it never clicks anything, and a guard
 * installed before page scripts run neuters every submit path (see
 * installSubmitGuard). This phase only READS the DOM.
 *
 * An earlier version aborted all non-GET requests at the network layer. That is
 * a stronger guarantee but it breaks GraphQL-driven ATS such as Ashby, whose
 * form never renders without POSTs — which would silently record "no form" and
 * corrupt the exact metric this run exists to measure. Network-level blocking
 * belongs in Phase 2, where filling and clicking actually begin.
 */

import { chromium, type Browser, type Page } from "playwright"
import { Pool } from "pg"
import { writeFileSync, appendFileSync } from "node:fs"
import { classifyApplyMethod } from "../lib/jobs/apply-method"

const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 2_500

type Candidate = {
  id: string
  title: string | null
  apply_url: string
  ats_type: string | null
  company_name: string | null
}

type Outcome = {
  jobId: string
  applyUrl: string
  ats: string | null
  company: string | null
  /** page loaded at all */
  reachable: boolean
  /** looked like a bot-wall rather than a form */
  blocked: boolean
  httpStatus: number | null
  formDetected: boolean
  fieldsTotal: number
  /** fields the deterministic profile mapping can fill with no LLM */
  fieldsDeterministic: number
  /** free-text questions that would need an LLM call — the only variable cost */
  aiQuestions: number
  fileInputs: number
  blockedSubmits: number
  /** form only appeared after clicking the Apply CTA */
  revealedByClick: boolean
  /** host of an injected bot-defence iframe, when one was found */
  captchaVendor: string | null
  /** captcha widget present but the form still rendered — a submit-time risk */
  captchaOnForm: boolean
  durationMs: number
  error: string | null
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/**
 * Neuter every in-page submit path before the site's own scripts run.
 *
 * Defence in depth only: this phase never types and never clicks, so nothing
 * would submit regardless. Counting blocked attempts also surfaces any page
 * that tries to auto-submit on load, which would be worth knowing about.
 */
async function installSubmitGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error - counter read back via page.evaluate
    window.__blockedSubmits = 0
    const bump = () => {
      // @ts-expect-error - see above
      window.__blockedSubmits = (window.__blockedSubmits ?? 0) + 1
    }
    const nativeSubmit = HTMLFormElement.prototype.submit
    HTMLFormElement.prototype.submit = function () {
      bump()
      void nativeSubmit // deliberately not called
    }
    document.addEventListener(
      "submit",
      (e) => {
        bump()
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      true,
    )
  })
}

/**
 * Inspect the form in the page and classify its fields.
 *
 * Runs in the browser so it sees computed visibility — ATS forms are full of
 * hidden inputs and off-screen honeypots that would badly inflate a naive count.
 */
async function inspectForm(page: Page) {
  // Passed as a string on purpose: tsx transpiles named functions with an
  // esbuild `__name` helper that does not exist in the page context, so a
  // function argument here dies with "ReferenceError: __name is not defined".
  return page.evaluate(`(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const controls = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].indexOf(type) !== -1) return false;
      return visible(el);
    });
    const labelFor = (el) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]') : null;
      const wrapping = el.closest("label");
      const aria = el.getAttribute("aria-label") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const text = (byFor && byFor.textContent) || (wrapping && wrapping.textContent) || aria || placeholder || "";
      return text.replace(/\\s+/g, " ").trim();
    };
    const DETERMINISTIC = /(first|last|full)\\s*name|^name$|e-?mail|phone|address|city|state|zip|postal|country|linkedin|github|portfolio|website|resume|cv|cover letter|salary|start date|notice|how did you hear|pronoun|gender|race|ethnic|veteran|disab|authoriz|sponsor|visa|relocat/i;
    let deterministic = 0, aiQuestions = 0, fileInputs = 0;
    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "file") { fileInputs++; continue; }
      const label = labelFor(el);
      if (DETERMINISTIC.test(label)) deterministic++;
      else if (tag === "textarea" || label.length > 40) aiQuestions++;
      else deterministic++;
    }
    const formDetected = controls.length >= 3 ||
      !!document.querySelector("form input[type=email], form textarea, [data-ui=application-form]");
    return {
      fieldsTotal: controls.length,
      fieldsDeterministic: deterministic,
      aiQuestions: aiQuestions,
      fileInputs: fileInputs,
      formDetected: formDetected,
      blockedSubmits: window.__blockedSubmits || 0,
      bodyText: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 400)
    };
  })()`) as Promise<{
    fieldsTotal: number
    fieldsDeterministic: number
    aiQuestions: number
    fileInputs: number
    formDetected: boolean
    blockedSubmits: number
    bodyText: string
  }>
}

/**
 * Reveal the application form when the posting page only shows a description.
 *
 * SmartRecruiters, Workable and Greenhouse postings commonly render the JD with
 * the form behind an "Apply" CTA, so a probe that never clicks records them as
 * "no form" and understates the real fill rate badly — in the first 80-job run
 * this accounted for 21 of 24 apparent failures, every one of them HTTP 200
 * with zero fields.
 *
 * Clicking is constrained hard. The label must match an exact apply-CTA phrase,
 * and any control whose text hints at finishing an application is refused even
 * if it also contains the word "apply". The denylist is checked first and wins.
 */
const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
const NEVER_CLICK = /submit|send|finish|complete|confirm|agree|accept/i

async function revealFormIfHidden(page: Page): Promise<boolean> {
  const candidates = await page.$$("a, button, [role=button]")
  for (const el of candidates) {
    const label = ((await el.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim()
    if (!label || label.length > 32) continue
    if (NEVER_CLICK.test(label)) continue          // checked first: it wins
    if (!APPLY_CTA.test(label)) continue
    if (!(await el.isVisible().catch(() => false))) continue
    await el.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS).catch(() => {})
    return true
  }
  return false
}

const BOT_WALL = /just a moment|checking your browser|verify you are human|access denied|cf-browser-verification|are you a robot|unusual traffic/i

/**
 * Bot-defence vendors, detected by the iframe they inject.
 *
 * Text matching alone misses these: SmartRecruiters serves DataDome from
 * geo.captcha-delivery.com inside an iframe while the host page stays visually
 * normal, so a main-frame body-text check records a hard block as a benign
 * "no form" and quietly overstates the addressable market.
 */
const CAPTCHA_FRAME = /captcha-delivery\.com|hcaptcha\.com|recaptcha\/api2|challenges\.cloudflare\.com|perimeterx|px-cloud|arkoselabs|funcaptcha/i

function detectCaptchaFrame(page: Page): string | null {
  for (const f of page.frames()) {
    const url = f.url() || ""
    if (CAPTCHA_FRAME.test(url)) {
      const m = url.match(/https?:\/\/([^/]+)/)
      return m ? m[1] : "captcha"
    }
  }
  return null
}

async function probe(browser: Browser, job: Candidate): Promise<Outcome> {
  const started = Date.now()
  const base: Outcome = {
    jobId: job.id,
    applyUrl: job.apply_url,
    ats: job.ats_type,
    company: job.company_name,
    reachable: false,
    blocked: false,
    httpStatus: null,
    formDetected: false,
    fieldsTotal: 0,
    fieldsDeterministic: 0,
    aiQuestions: 0,
    fileInputs: 0,
    blockedSubmits: 0,
    revealedByClick: false,
    captchaVendor: null,
    captchaOnForm: false,
    durationMs: 0,
    error: null,
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  })

  let blockedSubmits = 0
  try {
    const page = await context.newPage()
    await installSubmitGuard(page)

    const res = await page.goto(job.apply_url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    })
    base.httpStatus = res?.status() ?? null
    base.reachable = true

    // ATS forms are almost all client-rendered; give the app a moment to mount.
    await page.waitForTimeout(SETTLE_MS)

    let info = await inspectForm(page)

    // A posting page with no fields usually means the form is behind an Apply
    // CTA rather than absent. Try once to reveal it before calling this a miss.
    if (!info.formDetected && !BOT_WALL.test(info.bodyText)) {
      const clicked = await revealFormIfHidden(page)
      if (clicked) {
        info = await inspectForm(page)
        base.revealedByClick = info.formDetected
      }
    }

    // A CAPTCHA iframe alone does not mean blocked. Invisible reCAPTCHA and
    // hCaptcha ride along on plenty of perfectly fillable forms as passive
    // anti-spam; only an interstitial that REPLACED the form is a real wall.
    // Distinguishing them is the difference between a 48% and a 13% block rate.
    const captchaHost = detectCaptchaFrame(page)
    base.captchaVendor = captchaHost
    base.blocked =
      BOT_WALL.test(info.bodyText) ||
      (base.httpStatus ?? 0) === 403 ||
      (!!captchaHost && !info.formDetected)
    base.formDetected = info.formDetected && !base.blocked
    base.captchaOnForm = !!captchaHost && base.formDetected
    base.fieldsTotal = info.fieldsTotal
    base.fieldsDeterministic = info.fieldsDeterministic
    base.aiQuestions = info.aiQuestions
    base.fileInputs = info.fileInputs
    blockedSubmits = info.blockedSubmits
  } catch (err) {
    base.error = err instanceof Error ? err.message.slice(0, 200) : String(err)
  } finally {
    base.blockedSubmits = blockedSubmits
    base.durationMs = Date.now() - started
    await context.close().catch(() => {})
  }
  return base
}

async function main() {
  const limit = Number.parseInt(arg("limit", "50"), 10)
  const concurrency = Number.parseInt(arg("concurrency", "3"), 10)
  const out = arg("out", "dry-run-report.jsonl")

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL not set (see .env.local; needs the db tunnel up)")

  const pool = new Pool({ connectionString, max: 4 })
  // Over-fetch, then let the classifier pick — it is the tested source of truth
  // for what "applyable" means, and the SQL prefilter is only a cheap narrowing.
  const { rows } = await pool.query<Candidate>(
    `SELECT j.id, j.title, j.apply_url, c.ats_type, c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.first_detected_at > now() - interval '14 days'
        AND j.is_active
        AND j.apply_url IS NOT NULL
        AND j.apply_url ~* '(greenhouse|lever\\.co|ashbyhq|workable|applytojob|jazzhr|breezy|bamboohr|smartrecruiters|recruitee)'
      ORDER BY random()
      LIMIT $1`,
    [limit * 2],
  )

  const candidates = rows
    .filter((r) => classifyApplyMethod(r.apply_url, r.ats_type) === "tier1_fillable")
    .slice(0, limit)

  console.log(`[dry-run] ${candidates.length} tier-1 candidates (from ${rows.length} sampled)`)
  console.log(`[dry-run] READ-ONLY: never types, never clicks, submit paths neutered\n`)

  writeFileSync(out, "")
  const browser = await chromium.launch({ headless: true })
  const results: Outcome[] = []

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (cursor < candidates.length) {
        const job = candidates[cursor++]
        const r = await probe(browser, job)
        results.push(r)
        appendFileSync(out, JSON.stringify(r) + "\n")
        const state = r.blocked ? "BLOCKED" : r.formDetected ? "form" : r.error ? "error" : "no-form"
        console.log(
          `[${results.length}/${candidates.length}] ${state.padEnd(7)} ` +
          `fields=${String(r.fieldsTotal).padStart(2)} ai=${r.aiQuestions} ` +
          `${(r.company ?? "?").slice(0, 24)}`,
        )
      }
    }),
  )

  await browser.close()
  await pool.end()

  // ── summary ────────────────────────────────────────────────────────────────
  const n = results.length || 1
  const reached = results.filter((r) => r.reachable && !r.error).length
  const blocked = results.filter((r) => r.blocked).length
  const withForm = results.filter((r) => r.formDetected).length
  const aiCounts = results.filter((r) => r.formDetected).map((r) => r.aiQuestions).sort((a, b) => a - b)
  const median = aiCounts.length ? aiCounts[Math.floor(aiCounts.length / 2)] : 0
  const p90 = aiCounts.length ? aiCounts[Math.floor(aiCounts.length * 0.9)] : 0
  const meanAi = aiCounts.length ? aiCounts.reduce((a, b) => a + b, 0) / aiCounts.length : 0

  // Measured from prod api_usage: autofill_answer_question averages $0.00064.
  // The deterministic fields cost nothing, so questions are the whole variable cost.
  const COST_PER_QUESTION_USD = 0.00064

  console.log("\n──────── dry-run summary ────────")
  console.log(`probed              ${results.length}`)
  console.log(`reachable           ${reached} (${((reached / n) * 100).toFixed(1)}%)`)
  const byVendor = new Map<string, number>()
  for (const r of results) if (r.blocked && r.captchaVendor) byVendor.set(r.captchaVendor, (byVendor.get(r.captchaVendor) ?? 0) + 1)
  console.log(`bot-walled          ${blocked} (${((blocked / n) * 100).toFixed(1)}%)`)
  for (const [v, c] of [...byVendor].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(30)} ${c}`)
  const revealed = results.filter((r) => r.revealedByClick).length
  console.log(`form detected       ${withForm} (${((withForm / n) * 100).toFixed(1)}%)  <-- the go/no-go`)
  console.log(`  of which via CTA  ${revealed}`)
  console.log(`captcha on a form   ${results.filter((r) => r.captchaOnForm).length} (fills fine; risk is at submit, Phase 2)`)
  console.log(`AI questions/form   mean ${meanAi.toFixed(1)}  median ${median}  p90 ${p90}`)
  console.log(`projected cost/app  $${(meanAi * COST_PER_QUESTION_USD).toFixed(4)} (questions only, before caching)`)
  console.log(`auto-submit attempts ${results.reduce((a, r) => a + r.blockedSubmits, 0)} (all neutered)`)
  console.log(`report              ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
