/**
 * Phase 2 measurement harness: fill real ATS forms end-to-end, never submit.
 *
 * Phase 1 (scripts/dry-run-apply.ts) proved forms LOAD and can be read. It did
 * not prove the field mapping actually populates them, which is the difference
 * between "we can reach the form" and "we can apply". This runs the real
 * production fill path — generateFillScript from lib/autofill — against live
 * postings and measures what percentage of fields genuinely take a value.
 *
 * It also measures true LLM cost rather than projecting it: every free-text
 * question the deterministic pass leaves empty is answered with a real Haiku
 * call using production's prompt shape, so the reported cost-per-application
 * comes from actual token counts, and the prompt-cache hit rate is observed
 * rather than assumed.
 *
 *   npx tsx scripts/dry-fill-apply.ts --limit 25
 *   npx tsx scripts/dry-fill-apply.ts --limit 25 --no-ai      # skip LLM spend
 *
 * Requires the prod DB tunnel: ./scripts/db-tunnel.sh --daemon
 *
 * SAFETY. This types into forms, so unlike Phase 1 it carries real risk, and
 * submission is blocked three ways:
 *
 *   1. Network. Once a form is found the router ARMS, and from then until the
 *      page closes every non-GET request is aborted. A submission physically
 *      cannot leave the browser. It stays disarmed during load so that
 *      GraphQL-rendered ATS (Ashby) still render — the reason Phase 1 could not
 *      block at this layer for the whole page lifetime.
 *   2. In-page. form.submit() is stubbed and submit events are cancelled in the
 *      capture phase, before any site handler sees them.
 *   3. Behavioural. Nothing matching submit/send/finish is ever clicked; the
 *      only click is an apply-CTA allowlist that reveals the form.
 *
 * The profile is synthetic (clearly-fake name, example.com email, 555 number),
 * so even a total failure of all three guards could not submit a real person's
 * application.
 */

import { chromium, type Browser, type Page } from "playwright"
import { Pool } from "pg"
import Anthropic from "@anthropic-ai/sdk"
import { writeFileSync, appendFileSync } from "node:fs"
import { classifyApplyMethod } from "../lib/jobs/apply-method"
import { generateFillScript } from "../lib/autofill"
import type { AutofillProfile } from "../types"

/** --no-combo runs the pre-combobox baseline on the same fixed job set. */
const COMBOS_ENABLED = !process.argv.includes("--no-combo")

const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 2_500

/** Deliberately synthetic. Nothing here identifies a real person. */
const TEST_PROFILE = {
  first_name: "Testy",
  last_name: "McTestface",
  email: "testy.mctestface@example.com",
  phone: "5555550123",
  linkedin_url: "https://www.linkedin.com/in/example-test-profile",
  github_url: "https://github.com/example-test-profile",
  portfolio_url: "https://example.com",
  address_line1: "1 Example Street",
  city: "Austin",
  state: "TX",
  zip_code: "73301",
  country: "United States",
  years_of_experience: 6,
  salary_expectation_min: 150000,
  salary_expectation_max: 180000,
  earliest_start_date: "2026-10-01",
  willing_to_relocate: "Yes",
  highest_degree: "Bachelor's Degree",
  field_of_study: "Computer Science",
  university: "University of Example",
  graduation_year: 2019,
  gpa: "3.7",
  authorized_to_work: true,
  requires_sponsorship: false,
  sponsorship_statement: "",
  work_authorization: "US Citizen",
  auto_fill_diversity: false,
  custom_answers: [],
} as unknown as AutofillProfile

const RESUME_CONTEXT = `Senior Software Engineer with 6 years building backend services.
- Payments platform team: led migration of a monolith to event-driven services, cut p99 latency 40%.
- Built an internal data pipeline processing 2M events/day in TypeScript and Postgres.
Skills: TypeScript, Node.js, Postgres, AWS, Docker, React.
Education: BS Computer Science, University of Example, 2019.`

const ANSWER_INSTRUCTIONS = `You help a job applicant answer application-form questions. Answer as the applicant, first person. Match the answer length to the question. Return ONLY the answer text — no preamble, no quotes, no explanation.
- Yes/No → just "Yes" or "No".
- Numeric → the number with a unit.
- Open-ended → 2-4 sentences grounded in the résumé.
Never fabricate an employer, credential, or metric not in the résumé.`

type UnfilledField = { sel: string | null; kind: string; label: string }

type InspectResult = {
  fieldsVisible: number
  requiredTotal: number
  requiredFilled: number
  unfilledRequired: UnfilledField[]
  withValue: number
  emptyQuestions: string[]
  formDetected: boolean
  blockedSubmits: number
}

type Candidate = {
  id: string; title: string | null; apply_url: string
  ats_type: string | null; company_name: string | null
}

type FillOutcome = {
  jobId: string; applyUrl: string; ats: string; company: string | null
  formReached: boolean; blocked: boolean
  fieldsVisible: number
  filled: number; skipped: number; errors: number
  /** fields that hold a value after the fill, counted from the DOM itself */
  verifiedFilled: number
  fillRate: number
  /** required-field coverage — the metric that decides if a form could submit */
  requiredTotal: number
  requiredFilled: number
  requiredRate: number
  aiQuestions: number
  /** answers the model produced that were successfully injected into the form */
  aiWrittenBack: number
  /** comboboxes driven to a selection */
  combosFilled: number
  /** EEO comboboxes set to an explicit decline option */
  eeoDeclined: number
  /** required fields still empty after both passes, by kind — the real gap */
  residual: UnfilledField[]
  aiInputTokens: number; aiOutputTokens: number
  aiCacheReadTokens: number; aiCacheWriteTokens: number
  aiCostUsd: number
  submitAttemptsBlocked: number
  durationMs: number
  error: string | null
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function atsOf(url: string): string {
  const h = url.split("/")[2] ?? ""
  for (const k of ["smartrecruiters", "lever", "greenhouse", "ashby", "workable",
                   "applytojob", "breezy", "bamboohr", "recruitee"]) {
    if (h.includes(k)) return k === "applytojob" ? "jazzhr" : k
  }
  return h
}

const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
const NEVER_CLICK = /submit|send|finish|complete|confirm|agree|accept/i
const CAPTCHA_FRAME = /captcha-delivery\.com|hcaptcha\.com|recaptcha\/api2|challenges\.cloudflare\.com|perimeterx|px-cloud|arkoselabs/i

async function installGuards(page: Page, state: { armed: boolean; blocked: number }) {
  await page.addInitScript(() => {
    // @ts-expect-error counter read back later
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

const INSPECT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
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
  // Required fields are the only denominator that answers "could this be
  // submitted". Counting every visible input scores page search boxes and the
  // EEO selects the profile deliberately declines as failures, which understated
  // Greenhouse at 40% on a form where one non-application search box was the
  // ONLY thing left blank.
  const req = (el) => el.hasAttribute("required") || el.getAttribute("aria-required") === "true" ||
    !!(el.closest(".field, .form-group, [data-field]") || {}).querySelector?.("[aria-required=true]");
  const required = ctrls.filter(req);
  const withValue = ctrls.filter((el) => (el.value||"").trim().length > 0);
  const requiredFilled = required.filter((el) => (el.value||"").trim().length > 0);
  const emptyFreeText = ctrls.filter((el) =>
    (el.value||"").trim().length === 0 &&
    (el.tagName.toLowerCase() === "textarea" || labelFor(el).length > 40));
  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type")||"").toLowerCase();
    const role = el.getAttribute("role")||"";
    if (tag === "select") return "select";
    if (role === "combobox" || el.getAttribute("aria-autocomplete")) return "combobox";
    if (type === "radio" || type === "checkbox") return type;
    if (tag === "textarea") return "textarea";
    return "text";
  };
  const unfilledRequired = required
    .filter((el) => (el.value||"").trim().length === 0)
    .map((el) => {
      // A positional index goes stale the moment React re-renders after the
      // first write, which is why most injections silently missed. id and name
      // survive re-render; anything without either is skipped rather than
      // guessed at.
      const id = el.getAttribute("id"), nm = el.getAttribute("name");
      const sel = id ? "#" + (window.CSS && CSS.escape ? CSS.escape(id) : id)
                : nm ? el.tagName.toLowerCase() + '[name="' + nm.replace(/"/g, '\\"') + '"]'
                : null;
      return { sel: sel, kind: kindOf(el), label: labelFor(el).slice(0, 70) };
    });
  return {
    fieldsVisible: ctrls.length,
    requiredTotal: required.length,
    requiredFilled: requiredFilled.length,
    unfilledRequired: unfilledRequired,
    withValue: withValue.length,
    emptyQuestions: emptyFreeText.map(labelFor).filter((t) => t.length > 3).slice(0, 12),
    formDetected: ctrls.length >= 3,
    blockedSubmits: window.__blockedSubmits || 0
  };
})()`

/**
 * Write an answer into a control the way React expects.
 *
 * Assigning .value directly is invisible to React — its synthetic event system
 * never sees the change and the state reverts on the next render. The native
 * prototype setter plus input/change events is what the production fill script
 * uses, and it is the difference between a field that looks filled and one that
 * submits filled.
 */
/**
 * Build a self-contained expression that writes one answer into one control.
 *
 * The values are inlined as JSON rather than passed as evaluate() arguments,
 * because a STRING passed to page.evaluate is evaluated as an expression and any
 * argument is ignored — the function was simply never called, so every write
 * silently reported false. A string is still required here: tsx compiles real
 * functions with an esbuild `__name` helper that does not exist in the page.
 *
 * Assigning .value directly is invisible to React, whose synthetic event system
 * never sees it and reverts on the next render, so this goes through the native
 * prototype setter and then dispatches input/change — the same approach the
 * production fill script uses.
 */
function writeAnswerExpr(selector: string, value: string): string {
  return `(() => {
  const SEL = ${JSON.stringify(selector)}, VALUE = ${JSON.stringify(value)};
  const el = document.querySelector(SEL);
  if (!el) return false;
  const proto = el.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  if (d && d.set) d.set.call(el, VALUE); else el.value = VALUE;
  ["input","change","blur"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  return (el.value||"").trim().length > 0;
})()`
}

/**
 * Drive a react-select / typeahead combobox.
 *
 * Ported from the extension's fillAshbyTypeahead. These controls hold no value
 * to assign — a plain value-set registers no selection — so the only thing that
 * works is focus, open the menu, type a query, wait for the listbox to populate,
 * then click the matching option. They were 28 of the residual required fields,
 * concentrated in Greenhouse's Education block (School / Degree / Discipline).
 *
 * Values come from the profile by label. An unrecognised required combobox is
 * deliberately left alone rather than given the first available option: guessing
 * an answer to an unknown question is how a form gets submitted saying something
 * untrue, and leaving it in the residual keeps the measurement honest.
 */
function fillComboboxExpr(selector: string, value: string): string {
  return `(async () => {
  const SEL = ${JSON.stringify(selector)}, VALUE = ${JSON.stringify(value)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const el = document.querySelector(SEL);
  if (!el) return false;
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const setVal = (input, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (d && d.set) d.set.call(input, v); else input.value = v;
    ["input", "change"].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
  };
  const collect = () => Array.from(document.querySelectorAll(
    '[role="option"], [class*="option" i], [class*="menuItem" i], li[role]'
  )).filter((n) => vis(n) && norm(n.textContent).length > 0);
  try {
    el.focus();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
    const first = (VALUE.split(",")[0] || VALUE).trim();
    for (const q of [VALUE, first]) {
      setVal(el, q);
      let opts = [];
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) { opts = collect(); if (opts.length) break; await sleep(150); }
      if (!opts.length) continue;
      const m = opts.find((o) => norm(o.textContent).toLowerCase().includes(first.toLowerCase())) || opts[0];
      m.scrollIntoView({ block: "center" });
      m.click();
      await sleep(250);
      if (norm(el.value).length > 0) return true;
    }
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    await sleep(200);
    return norm(el.value).length > 0;
  } catch (e) { return false; }
})()`
}

/**
 * Read the option list a combobox offers, without choosing anything.
 *
 * Selecting requires knowing what is on offer: these are not typeaheads to be
 * matched against a profile value but closed questions — Yes/No screening,
 * multiple-choice culture-fit, and EEO self-identification — where the answer
 * must be one of the listed options.
 */
function readOptionsExpr(selector: string): string {
  return `(async () => {
  const SEL = ${JSON.stringify(selector)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const el = document.querySelector(SEL);
  if (!el) return [];
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  // react-select ignores a mousedown on the inner input — the menu opens from
  // the control wrapper. Clicking the input left aria-expanded="false" and the
  // option nodes present-but-hidden, so every read returned an empty list.
  const opener = (n) => n.closest('[class*="control" i]') || n.parentElement || n;
  const openMenu = async (n) => {
    const t = opener(n);
    t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    t.click();
    n.focus();
    for (let i = 0; i < 12; i++) {
      if (n.getAttribute("aria-expanded") === "true") return true;
      await sleep(120);
    }
    return n.getAttribute("aria-expanded") === "true";
  };
  try {
    await openMenu(el);
    for (let i = 0; i < 12; i++) {
      const opts = Array.from(document.querySelectorAll(
        '[role="option"], [class*="option" i], [class*="menuItem" i], li[role]'
      )).filter((n) => vis(n) && norm(n.textContent).length > 0);
      if (opts.length) return opts.map((o) => norm(o.textContent)).slice(0, 25);
      await sleep(150);
    }
    return [];
  } catch (e) { return []; }
})()`
}

/** Click the option whose text matches, then confirm the control took a value. */
function pickOptionExpr(selector: string, optionText: string): string {
  return `(async () => {
  const SEL = ${JSON.stringify(selector)}, WANT = ${JSON.stringify(optionText)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const el = document.querySelector(SEL);
  if (!el) return false;
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  // react-select ignores a mousedown on the inner input — the menu opens from
  // the control wrapper. Clicking the input left aria-expanded="false" and the
  // option nodes present-but-hidden, so every read returned an empty list.
  const opener = (n) => n.closest('[class*="control" i]') || n.parentElement || n;
  const openMenu = async (n) => {
    const t = opener(n);
    t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    t.click();
    n.focus();
    for (let i = 0; i < 12; i++) {
      if (n.getAttribute("aria-expanded") === "true") return true;
      await sleep(120);
    }
    return n.getAttribute("aria-expanded") === "true";
  };
  try {
    await openMenu(el);
    let opts = [];
    for (let i = 0; i < 12; i++) {
      opts = Array.from(document.querySelectorAll(
        '[role="option"], [class*="option" i], [class*="menuItem" i], li[role]'
      )).filter((n) => vis(n) && norm(n.textContent).length > 0);
      if (opts.length) break;
      await sleep(150);
    }
    if (!opts.length) return false;
    const want = WANT.toLowerCase();
    const m = opts.find((o) => norm(o.textContent).toLowerCase() === want)
           || opts.find((o) => norm(o.textContent).toLowerCase().includes(want))
           || opts.find((o) => want.includes(norm(o.textContent).toLowerCase()));
    if (!m) return false;
    m.scrollIntoView({ block: "center" });
    m.click();
    await sleep(250);
    return norm(el.value).length > 0 || el.getAttribute("aria-expanded") === "false";
  } catch (e) { return false; }
})()`
}

/** EEO questions must never be answered from the résumé — they get the explicit
 *  decline option. Leaving them blank is not equivalent: when the field is
 *  required, a blank one blocks submission outright. */
const EEO_LABEL = /gender|race|ethnic|hispanic|latino|veteran|disab|self.?identif/i
const DECLINE_OPTION = /decline|prefer not|do not wish|don'?t wish|not to answer|not to say|choose not/i

function pickDeclineOption(options: string[]): string | null {
  return options.find((o) => DECLINE_OPTION.test(o)) ?? null
}

/** Profile value for a combobox, by its label. Null means "do not guess". */
function comboValueFor(label: string): string | null {
  const l = label.toLowerCase()
  if (/\blocation\b|\bcity\b|\baddress\b|\bresidence\b|where are you based/.test(l)) return "Austin, TX"
  if (/\bcountry\b/.test(l)) return "United States"
  if (/\bschool\b|universit|college|institution/.test(l)) return "University of Example"
  if (/\bdegree\b|qualification/.test(l)) return "Bachelor's Degree"
  if (/discipline|field of study|\bmajor\b|concentration/.test(l)) return "Computer Science"
  if (/\bstate\b|province/.test(l)) return "Texas"
  return null
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

async function answerQuestions(
  anthropic: Anthropic, questions: string[], jobTitle: string, company: string,
) {
  let inTok = 0, outTok = 0, cacheRead = 0, cacheWrite = 0
  const answers: (string | null)[] = []
  for (const q of questions) {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      // Same layout as production: frozen instructions + per-user grounding
      // behind one breakpoint, volatile question in `messages`. Running it this
      // way is what makes the observed cache hit rate meaningful.
      system: [
        { type: "text", text: ANSWER_INSTRUCTIONS },
        { type: "text", text: `APPLICANT RÉSUMÉ:\n${RESUME_CONTEXT}`,
          cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `Applying for: ${jobTitle} at ${company}\n\nQuestion: "${q}"\n\nWrite the answer.` }],
    }).catch(() => null)
    if (!msg) { answers.push(null); continue }
    answers.push(
      msg.content.filter((b): b is { type: "text"; text: string; citations: never } => b.type === "text")
        .map((b) => b.text).join("").trim().replace(/^["']|["']$/g, "") || null,
    )
    inTok += msg.usage?.input_tokens ?? 0
    outTok += msg.usage?.output_tokens ?? 0
    cacheRead += msg.usage?.cache_read_input_tokens ?? 0
    cacheWrite += msg.usage?.cache_creation_input_tokens ?? 0
  }
  // Haiku 4.5: $1/M in, $5/M out; cache read 0.1x, cache write 1.25x of input.
  const cost = inTok / 1e6 * 1 + outTok / 1e6 * 5 + cacheRead / 1e6 * 0.1 + cacheWrite / 1e6 * 1.25
  return { inTok, outTok, cacheRead, cacheWrite, cost, answers }
}

/**
 * Choose one of a combobox's own options for a closed question.
 *
 * The option list is passed in and the model is told to return one verbatim, so
 * it cannot answer with something the form will not accept. A refusal to match
 * is returned as null and left in the residual rather than forced.
 */
async function chooseOption(
  anthropic: Anthropic, question: string, options: string[],
): Promise<string | null> {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 60,
    system: `Answer an application form question by selecting exactly one option.
Reply with the option text VERBATIM and nothing else.
Ground the answer in the applicant profile. If none is truthful, reply NONE.`,
    messages: [{
      role: "user",
      content: `Applicant: ${RESUME_CONTEXT}\nAge 18+: yes. US work authorization: yes, no sponsorship needed.\n\nQuestion: ${question}\nOptions:\n${options.map((o) => `- ${o}`).join("\n")}`,
    }],
  }).catch(() => null)
  if (!msg) return null
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim()
  if (!text || /^none$/i.test(text)) return null
  return options.find((o) => o.toLowerCase() === text.toLowerCase()) ?? text
}

async function fillOne(
  browser: Browser, job: Candidate, anthropic: Anthropic | null,
): Promise<FillOutcome> {
  const started = Date.now()
  const ats = atsOf(job.apply_url)
  const o: FillOutcome = {
    jobId: job.id, applyUrl: job.apply_url, ats, company: job.company_name,
    formReached: false, blocked: false, fieldsVisible: 0,
    filled: 0, skipped: 0, errors: 0, verifiedFilled: 0, fillRate: 0,
    requiredTotal: 0, requiredFilled: 0, requiredRate: 0,
    aiQuestions: 0, aiWrittenBack: 0, combosFilled: 0, eeoDeclined: 0, residual: [],
    aiInputTokens: 0, aiOutputTokens: 0,
    aiCacheReadTokens: 0, aiCacheWriteTokens: 0, aiCostUsd: 0,
    submitAttemptsBlocked: 0, durationMs: 0, error: null,
  }

  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }, locale: "en-US",
  })
  const state = { armed: false, blocked: 0 }

  try {
    const page = await ctx.newPage()
    await installGuards(page, state)
    await page.goto(job.apply_url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    await page.waitForTimeout(SETTLE_MS)

    let info = await page.evaluate(INSPECT) as InspectResult
    if (!info.formDetected) {
      await revealForm(page)
      info = await page.evaluate(INSPECT) as InspectResult
    }

    if (CAPTCHA_FRAME.test(page.frames().map((f) => f.url()).join(" ")) && !info.formDetected) {
      o.blocked = true
      return o
    }
    if (!info.formDetected) return o

    o.formReached = true
    o.fieldsVisible = info.fieldsVisible

    // ── ARM the network blocker. Nothing may POST from here on. ──────────────
    state.armed = true

    const { script } = generateFillScript(TEST_PROFILE, ats)
    const res = await page.evaluate(script) as { filled: string[]; skipped: string[]; errors: string[] }
    o.filled = res?.filled?.length ?? 0
    o.skipped = res?.skipped?.length ?? 0
    o.errors = res?.errors?.length ?? 0

    await page.waitForTimeout(600)
    const after = await page.evaluate(INSPECT) as InspectResult
    o.verifiedFilled = after.withValue
    o.fillRate = o.fieldsVisible ? o.verifiedFilled / o.fieldsVisible : 0
    o.requiredTotal = after.requiredTotal
    o.requiredFilled = after.requiredFilled
    o.requiredRate = after.requiredTotal ? after.requiredFilled / after.requiredTotal : 1
    o.aiQuestions = after.emptyQuestions.length
    o.submitAttemptsBlocked = (after.blockedSubmits ?? 0) + state.blocked

    // ── Answer the required free-text gaps and WRITE THEM BACK ───────────────
    // Generating answers without injecting them made the previous run report a
    // floor rather than a result: every AI-answerable question counted as
    // unfilled. Only text and textarea are handled — selects and comboboxes need
    // option matching, which is deliberately left to show up in the residual.
    const unfilled = after.unfilledRequired as UnfilledField[]
    const answerable = unfilled.filter((f) => (f.kind === "text" || f.kind === "textarea") && f.sel)

    // Text answers and combobox selection run independently. Nesting the
    // combobox pass inside the text pass meant a form whose only gaps were
    // dropdowns never had them touched, which is why combosFilled stayed at
    // zero through three different attempts at the mechanism itself.
    if (anthropic && answerable.length) {
      const a = await answerQuestions(
        anthropic, answerable.map((f) => f.label),
        job.title ?? "this role", job.company_name ?? "the company",
      )
      o.aiInputTokens = a.inTok; o.aiOutputTokens = a.outTok
      o.aiCacheReadTokens = a.cacheRead; o.aiCacheWriteTokens = a.cacheWrite
      o.aiCostUsd = a.cost
      for (let i = 0; i < answerable.length; i++) {
        const ans = a.answers[i]
        const sel = answerable[i].sel
        if (!ans || !sel) continue
        const ok = await page.evaluate(writeAnswerExpr(sel, ans)).catch(() => false)
        if (ok) o.aiWrittenBack++
      }
      await page.waitForTimeout(400)
    }

    const combos = COMBOS_ENABLED ? unfilled.filter((f) => f.kind === "combobox" && f.sel) : []
    for (const c of combos) {
      // Profile-backed typeahead first (location, school, degree).
      const v = comboValueFor(c.label)
      if (v) {
        const ok = await page.evaluate(fillComboboxExpr(c.sel!, v)).catch(() => false)
        if (ok) { o.combosFilled++; continue }
      }
      // Otherwise it is a closed question — read what it offers before choosing.
      const options = await page.evaluate(readOptionsExpr(c.sel!)).catch(() => []) as string[]
      if (!options.length) continue

      let choice: string | null = null
      if (EEO_LABEL.test(c.label)) {
        choice = pickDeclineOption(options)
        if (choice) o.eeoDeclined++
      } else if (anthropic) {
        choice = await chooseOption(anthropic, c.label, options)
      }
      if (!choice) continue
      const ok = await page.evaluate(pickOptionExpr(c.sel!, choice)).catch(() => false)
      if (ok) o.combosFilled++
    }
    if (combos.length) await page.waitForTimeout(400)

    const final = await page.evaluate(INSPECT) as InspectResult
    o.requiredFilled = final.requiredFilled
    o.requiredRate = final.requiredTotal ? final.requiredFilled / final.requiredTotal : 1
    o.residual = final.unfilledRequired
  } catch (err) {
    o.error = err instanceof Error ? err.message.slice(0, 180) : String(err)
  } finally {
    o.durationMs = Date.now() - started
    await ctx.close().catch(() => {})
  }
  return o
}

async function main() {
  const limit = Number.parseInt(arg("limit", "25"), 10)
  const concurrency = Number.parseInt(arg("concurrency", "3"), 10)
  const out = arg("out", "dry-fill-report.jsonl")
  const useAi = !process.argv.includes("--no-ai") && !!process.env.ANTHROPIC_API_KEY

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL not set (needs the db tunnel up)")

  const pool = new Pool({ connectionString, max: 4 })
  const { rows } = await pool.query<Candidate>(
    `SELECT j.id, j.title, j.apply_url, c.ats_type, c.name AS company_name
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.first_detected_at > now() - interval '14 days'
        AND j.is_active AND j.apply_url IS NOT NULL
        -- SmartRecruiters is excluded: Phase 1 measured it 100% DataDome-blocked.
        AND j.apply_url ~* '(greenhouse|lever\\.co|ashbyhq|applytojob|bamboohr)'
      -- Deterministic ordering, not random(): each run must hit the SAME
      -- postings or a before/after comparison measures sample variation rather
      -- than the change under test.
      ORDER BY md5(j.id::text) LIMIT $1`,
    [limit * 2],
  )
  const candidates = rows
    .filter((r) => classifyApplyMethod(r.apply_url, r.ats_type) === "tier1_fillable")
    .slice(0, limit)

  console.log(`[dry-fill] ${candidates.length} candidates`)
  console.log(`[dry-fill] synthetic profile; submits blocked at network + in-page layers`)
  console.log(`[dry-fill] real LLM calls: ${useAi ? "ON" : "off"}\n`)

  writeFileSync(out, "")
  const browser = await chromium.launch({ headless: true })
  const anthropic = useAi ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }) : null
  const results: FillOutcome[] = []

  let cursor = 0
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < candidates.length) {
      const job = candidates[cursor++]
      const r = await fillOne(browser, job, anthropic)
      results.push(r)
      appendFileSync(out, JSON.stringify(r) + "\n")
      const tag = r.blocked ? "BLOCKED" : r.formReached ? `req ${(r.requiredRate * 100).toFixed(0)}%` : "no-form"
      console.log(`[${results.length}/${candidates.length}] ${r.ats.padEnd(11)} ${tag.padEnd(12)} ` +
        `${r.requiredFilled}/${r.requiredTotal} req  q=${r.aiQuestions} ${(r.company ?? "").slice(0, 20)}`)
    }
  }))

  await browser.close()
  await pool.end()

  const reached = results.filter((r) => r.formReached)
  const n = reached.length || 1
  const meanFill = reached.reduce((a, r) => a + r.fillRate, 0) / n
  const meanReq = reached.reduce((a, r) => a + r.requiredRate, 0) / n
  const fullyCovered = reached.filter((r) => r.requiredRate >= 1).length
  const totalCost = results.reduce((a, r) => a + r.aiCostUsd, 0)
  const totalCacheRead = results.reduce((a, r) => a + r.aiCacheReadTokens, 0)
  const totalIn = results.reduce((a, r) => a + r.aiInputTokens, 0)

  const byAts = new Map<string, { n: number; fill: number }>()
  for (const r of reached) {
    const e = byAts.get(r.ats) ?? { n: 0, fill: 0 }
    e.n++; e.fill += r.requiredRate; byAts.set(r.ats, e)
  }

  console.log("\n──────── dry-fill summary ────────")
  console.log(`probed              ${results.length}`)
  console.log(`form reached        ${reached.length}`)
  console.log(`required coverage   ${(meanReq * 100).toFixed(1)}%   <-- can we actually apply`)
  console.log(`all required filled ${fullyCovered}/${reached.length} forms`)
  console.log(`(all visible fields ${(meanFill * 100).toFixed(1)}% — includes search boxes / declined EEO)`)
  for (const [a, e] of [...byAts].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${a.padEnd(12)} n=${String(e.n).padStart(2)}  ${((e.fill / e.n) * 100).toFixed(0)}%`)
  }
  const kinds = new Map<string, number>()
  for (const r of reached) for (const f of r.residual) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1)
  console.log(`answers written back ${results.reduce((a, r) => a + r.aiWrittenBack, 0)}`)
  console.log(`comboboxes filled   ${results.reduce((a, r) => a + r.combosFilled, 0)}`)
  console.log(`  EEO declined      ${results.reduce((a, r) => a + r.eeoDeclined, 0)}`)
  console.log(`residual gap by kind (required fields still empty):`)
  for (const [k, c] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${c}`)
  if (useAi) {
    console.log(`measured AI cost    $${totalCost.toFixed(5)} across ${reached.length} applications`)
    console.log(`  per application   $${(totalCost / n).toFixed(5)}`)
    console.log(`  cache read tokens ${totalCacheRead} (vs ${totalIn} uncached input)`)
  }
  console.log(`submit attempts     ${results.reduce((a, r) => a + r.submitAttemptsBlocked, 0)} (all blocked)`)
  console.log(`report              ${out}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
