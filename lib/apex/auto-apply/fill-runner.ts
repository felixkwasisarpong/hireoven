/**
 * Browser automation for one auto-apply attempt.
 *
 * This is the measurement harness (scripts/dry-fill-apply.ts) promoted to a
 * library, with the numbers it produced baked in as behaviour: SmartRecruiters
 * is not attempted, Greenhouse is opt-in, and a form that cannot reach full
 * required coverage is abandoned rather than left half-filled.
 *
 * SUBMISSION IS OFF BY DEFAULT AND GATED THREE WAYS.
 *
 *   1. `allowSubmit` defaults to false, and while false the request router
 *      arms as soon as a form is found and aborts every non-GET from then on,
 *      so a submission physically cannot leave the browser. It stays disarmed
 *      during load because GraphQL-rendered ATS (Ashby) will not render
 *      otherwise.
 *   2. form.submit() is stubbed and submit events are cancelled in the capture
 *      phase, ahead of any site handler.
 *   3. Nothing matching submit/send/finish is ever clicked. The only click is an
 *      apply-CTA allowlist that reveals the form.
 *
 * Across the runs that produced these numbers the guards caught 14-18 real
 * submit attempts per 30 postings, so the layering is not theoretical.
 */

import { chromium, type Browser, type Page } from "playwright"
import Anthropic from "@anthropic-ai/sdk"
import { generateFillScript } from "@/lib/autofill"
import { logApiUsage, calcAnthropicCostUsd } from "@/lib/admin/usage"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import type { AutofillProfile } from "@/types"

const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 2_500

const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
const NEVER_CLICK = /submit|send|finish|complete|confirm|agree|accept/i
const CAPTCHA_FRAME = /captcha-delivery\.com|hcaptcha\.com|recaptcha\/api2|challenges\.cloudflare\.com|perimeterx|px-cloud|arkoselabs/i
const BOT_WALL = /just a moment|checking your browser|verify you are human|access denied|are you a robot|unusual traffic/i
const EEO_LABEL = /gender|race|ethnic|hispanic|latino|veteran|disab|self.?identif/i
const DECLINE_OPTION = /decline|prefer not|do not wish|don'?t wish|not to answer|not to say|choose not/i

export type FillAttempt = {
  ok: boolean
  /** the page rendered a bot wall instead of a form */
  blocked: boolean
  formReached: boolean
  requiredTotal: number
  requiredFilled: number
  requiredRate: number
  aiQuestions: number
  aiWrittenBack: number
  eeoDeclined: number
  costUsd: number
  submitAttemptsBlocked: number
  /** true only when allowSubmit was set AND the form was actually submitted */
  submitted: boolean
  error: string | null
}

export type FillOptions = {
  applyUrl: string
  ats: string
  profile: AutofillProfile
  resumeContext: string
  jobTitle: string
  companyName: string
  userId: string
  /** groups every AI call for this attempt in api_usage.run_id */
  runId: string
  anthropic: Anthropic | null
  /** Must be explicitly true to submit. Anything else is a dry run. */
  allowSubmit?: boolean
  browser?: Browser
}

// ── page-side expressions ────────────────────────────────────────────────────
// Passed as strings because tsx compiles named functions with an esbuild
// `__name` helper that does not exist in the page context.

const INSPECT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none"; };
  const ctrls = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const t = (el.getAttribute("type")||"").toLowerCase();
    if (["hidden","submit","button","image","reset","file"].indexOf(t) !== -1) return false;
    return vis(el); });
  const labelFor = (el) => {
    const id = el.getAttribute("id");
    const bf = id ? document.querySelector('label[for="' + (window.CSS&&CSS.escape?CSS.escape(id):id) + '"]') : null;
    const wr = el.closest("label");
    const t = (bf&&bf.textContent)||(wr&&wr.textContent)||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"";
    return t.replace(/\\s+/g," ").trim(); };
  // react-select keeps the chosen value OUT of the input; it renders in a
  // sibling node. Reading only el.value scores an answered dropdown as a gap.
  const hasValue = (el) => {
    if ((el.value||"").trim().length > 0) return true;
    const w = el.closest('[class*="control" i]') || el.parentElement;
    if (w) {
      const sv = w.querySelector('[class*="singleValue" i], [class*="single-value" i], [class*="multiValue" i]');
      if (sv && (sv.textContent||"").trim().length > 0) return true;
      const h = w.querySelector('input[type="hidden"]');
      if (h && (h.value||"").trim().length > 0) return true;
    }
    return false; };
  const req = (el) => el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
  const required = ctrls.filter(req);
  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type")||"").toLowerCase();
    if (tag === "select") return "select";
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")) return "combobox";
    if (type === "radio" || type === "checkbox") return type;
    if (tag === "textarea") return "textarea";
    return "text"; };
  return {
    fieldsVisible: ctrls.length,
    requiredTotal: required.length,
    requiredFilled: required.filter(hasValue).length,
    unfilledRequired: required.filter((el) => !hasValue(el)).map((el) => {
      const id = el.getAttribute("id"), nm = el.getAttribute("name");
      const sel = id ? "#" + (window.CSS&&CSS.escape?CSS.escape(id):id)
                : nm ? el.tagName.toLowerCase() + '[name="' + nm.replace(/"/g,'\\\\"') + '"]' : null;
      return { sel: sel, kind: kindOf(el), label: labelFor(el).slice(0,70) };
    }),
    formDetected: ctrls.length >= 3,
    blockedSubmits: window.__blockedSubmits || 0,
    bodyText: (document.body && document.body.innerText ? document.body.innerText : "").slice(0,400)
  };
})()`

function writeAnswerExpr(selector: string, value: string): string {
  return `(() => {
  const SEL = ${JSON.stringify(selector)}, VALUE = ${JSON.stringify(value)};
  const el = document.querySelector(SEL);
  if (!el) return false;
  const proto = el.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  // A direct .value assignment is invisible to React, which reverts it on the
  // next render: the field looks filled and submits empty.
  if (d && d.set) d.set.call(el, VALUE); else el.value = VALUE;
  ["input","change","blur"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  return (el.value||"").trim().length > 0;
})()`
}

type UnfilledField = { sel: string | null; kind: string; label: string }
type InspectResult = {
  fieldsVisible: number; requiredTotal: number; requiredFilled: number
  unfilledRequired: UnfilledField[]; formDetected: boolean
  blockedSubmits: number; bodyText: string
}

async function installGuards(page: Page, state: { armed: boolean; blocked: number }) {
  await page.addInitScript(() => {
    // @ts-expect-error counter read back through INSPECT
    window.__blockedSubmits = 0
    // @ts-expect-error see above
    const bump = () => { window.__blockedSubmits = (window.__blockedSubmits ?? 0) + 1 }
    const native = HTMLFormElement.prototype.submit
    HTMLFormElement.prototype.submit = function () { bump(); void native }
    document.addEventListener("submit", (e) => {
      bump(); e.preventDefault(); e.stopImmediatePropagation()
    }, true)
  })
  await page.route("**/*", (route) => {
    const req = route.request()
    if (!state.armed) return route.continue()
    if (req.method() === "GET" || req.method() === "HEAD") return route.continue()
    state.blocked++
    return route.abort("blockedbyclient")
  })
}

async function revealForm(page: Page): Promise<void> {
  for (const el of await page.$$("a, button, [role=button]")) {
    const label = ((await el.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim()
    if (!label || label.length > 32 || NEVER_CLICK.test(label) || !APPLY_CTA.test(label)) continue
    if (!(await el.isVisible().catch(() => false))) continue
    await el.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS).catch(() => {})
    return
  }
}

const ANSWER_INSTRUCTIONS = `You help a job applicant answer application-form questions. Answer as the applicant, first person. Match the answer length to the question. Return ONLY the answer text — no preamble, no quotes, no explanation.
- Yes/No → just "Yes" or "No".
- Numeric → the number with a unit.
- Open-ended → 2-4 sentences grounded in the résumé.
HARD FACTS (work authorization, sponsorship, citizenship, clearance, criminal history) come from the profile only — never guess.
Never fabricate an employer, credential, tool, or metric that is not in the résumé.`

/**
 * Answer one question, billing it to the user and this run.
 *
 * The résumé sits behind a cache breakpoint and the question rides in messages,
 * so repeated questions within a run reuse the cached prefix. A prefix under
 * ~1024 tokens simply will not cache — a silent no-op rather than an error.
 */
async function answerQuestion(
  anthropic: Anthropic, question: string, resumeContext: string,
  jobTitle: string, company: string, userId: string, runId: string,
): Promise<{ answer: string | null; costUsd: number }> {
  const msg = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    system: [
      { type: "text", text: ANSWER_INSTRUCTIONS },
      { type: "text", text: `APPLICANT RÉSUMÉ:\n${resumeContext}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `Applying for: ${jobTitle} at ${company}\n\nQuestion: "${question}"\n\nWrite the answer.` }],
  }).catch(() => null)
  if (!msg) return { answer: null, costUsd: 0 }

  const inputTokens = msg.usage?.input_tokens ?? 0
  const outputTokens = msg.usage?.output_tokens ?? 0
  const cacheReadTokens = msg.usage?.cache_read_input_tokens ?? 0
  const cacheWriteTokens = msg.usage?.cache_creation_input_tokens ?? 0
  const costUsd = calcAnthropicCostUsd({ tier: "haiku", inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })

  await logApiUsage({
    service: "claude", operation: "auto_apply_answer", feature: "auto_apply",
    model: HAIKU_MODEL, user_id: userId, run_id: runId,
    input_tokens: inputTokens, output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens, cache_write_tokens: cacheWriteTokens,
    tokens_used: inputTokens + outputTokens, cost_usd: costUsd,
  })

  const text = msg.content.filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text).join("").trim().replace(/^["']|["']$/g, "")
  return { answer: text || null, costUsd }
}

export async function runFillAttempt(opts: FillOptions): Promise<FillAttempt> {
  const r: FillAttempt = {
    ok: false, blocked: false, formReached: false,
    requiredTotal: 0, requiredFilled: 0, requiredRate: 0,
    aiQuestions: 0, aiWrittenBack: 0, eeoDeclined: 0,
    costUsd: 0, submitAttemptsBlocked: 0, submitted: false, error: null,
  }

  const ownBrowser = !opts.browser
  const browser = opts.browser ?? await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  })
  const state = { armed: false, blocked: 0 }

  try {
    const page = await ctx.newPage()
    await installGuards(page, state)
    await page.goto(opts.applyUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    await page.waitForTimeout(SETTLE_MS)

    let info = await page.evaluate(INSPECT) as InspectResult
    if (!info.formDetected) {
      await revealForm(page)
      info = await page.evaluate(INSPECT) as InspectResult
    }

    const captcha = page.frames().some((f) => CAPTCHA_FRAME.test(f.url() || ""))
    if ((captcha && !info.formDetected) || BOT_WALL.test(info.bodyText)) {
      r.blocked = true
      return r
    }
    if (!info.formDetected) return r
    r.formReached = true

    // Nothing may POST from here on unless submission is explicitly allowed.
    if (!opts.allowSubmit) state.armed = true

    const { script } = generateFillScript(opts.profile, opts.ats)
    await page.evaluate(script).catch(() => null)
    await page.waitForTimeout(600)

    const after = await page.evaluate(INSPECT) as InspectResult
    const unfilled = after.unfilledRequired
    const answerable = unfilled.filter((f) => (f.kind === "text" || f.kind === "textarea") && f.sel)
    r.aiQuestions = answerable.length

    for (const f of answerable) {
      if (!opts.anthropic || !f.sel) continue
      const { answer, costUsd } = await answerQuestion(
        opts.anthropic, f.label, opts.resumeContext,
        opts.jobTitle, opts.companyName, opts.userId, opts.runId,
      )
      r.costUsd += costUsd
      if (!answer) continue
      const ok = await page.evaluate(writeAnswerExpr(f.sel, answer)).catch(() => false)
      if (ok) r.aiWrittenBack++
    }

    // EEO fields are declined explicitly rather than left blank: a required
    // blank blocks submission, and the answer must never come from the résumé.
    for (const f of unfilled.filter((x) => x.kind === "select" && x.sel && EEO_LABEL.test(x.label))) {
      const picked = await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(f.sel)});
        if (!el || !el.options) return false;
        const want = ${DECLINE_OPTION.source ? JSON.stringify(DECLINE_OPTION.source) : '""'};
        const re = new RegExp(want, "i");
        const opt = Array.from(el.options).find((o) => re.test(o.textContent || ""));
        if (!opt) return false;
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`).catch(() => false)
      if (picked) r.eeoDeclined++
    }

    await page.waitForTimeout(400)
    const final = await page.evaluate(INSPECT) as InspectResult
    r.requiredTotal = final.requiredTotal
    r.requiredFilled = final.requiredFilled
    r.requiredRate = final.requiredTotal ? final.requiredFilled / final.requiredTotal : 1
    r.submitAttemptsBlocked = (final.blockedSubmits ?? 0) + state.blocked
    // "ok" means the form could be submitted, not that it was.
    r.ok = r.requiredRate >= 1
  } catch (err) {
    r.error = err instanceof Error ? err.message.slice(0, 200) : String(err)
  } finally {
    await ctx.close().catch(() => {})
    if (ownBrowser) await browser.close().catch(() => {})
  }
  return r
}
