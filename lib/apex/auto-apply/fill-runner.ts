/**
 * Browser automation for one auto-apply attempt.
 *
 * This is the measurement harness (scripts/dry-fill-apply.ts) promoted to a
 * library, with the numbers it produced baked in as behaviour: SmartRecruiters
 * is not attempted, Greenhouse is opt-in, and a form that cannot reach full
 * required coverage is abandoned rather than left half-filled.
 *
 * SUBMISSION IS OFF BY DEFAULT AND GATED FOUR WAYS.
 *
 *   1. `allowSubmit` must be explicitly true. Anything else — including
 *      undefined — is a dry run.
 *   2. The form must be COMPLETE. submitForm is reached only when every
 *      required field is filled and nothing disqualified the form, so a
 *      partially filled application can never be sent.
 *   3. On a dry run the request router arms as soon as a form is found and
 *      aborts every non-GET, so a submission cannot leave the browser. It stays
 *      disarmed during load because GraphQL-rendered ATS (Ashby) will not
 *      render otherwise.
 *   4. Also on a dry run, form.submit() is stubbed and submit events are
 *      cancelled in the capture phase, ahead of any site handler. Both of these
 *      are installed ONLY when allowSubmit is false — left in place they would
 *      block a permitted submission too, which would look like a silent failure
 *      rather than a refusal.
 *
 * Outside submitForm nothing matching submit/send/finish is ever clicked; the
 * only click is an apply-CTA allowlist that reveals the form. Across the runs
 * that produced these numbers the dry-run guards caught 14-18 real submit
 * attempts per 30 postings, so the layering is not theoretical.
 */

import { chromium, type Browser, type Page } from "playwright"
import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"
import { writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateResumePDF } from "@/lib/resume/pdf-generator"
import { generateFillScript } from "@/lib/autofill"
import { logApiUsage, calcAnthropicCostUsd } from "@/lib/admin/usage"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import {
  isUsableAnswer,
  classifyWorkAuthQuestion,
  answerWorkAuth,
  identityAnswer,
  locationAnswer,
  usStateAliases,
  eeoAnswer,
} from "@/lib/autofill/answer-policy"
import { answerCommonQuestion } from "@/lib/autofill/common-answers"
import { computeYearsOfExperience } from "@/lib/autofill/resume-facts"
import {
  getScreeningAnswer,
  isSkippedQuestion,
  recordUnansweredQuestion,
} from "@/lib/autofill/screening-answers"
import type { AutofillProfile, Resume } from "@/types"

const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 2_500

const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
const NEVER_CLICK = /submit|send|finish|complete|confirm|agree|accept/i
const CAPTCHA_FRAME = /captcha-delivery\.com|hcaptcha\.com|recaptcha\/api2|challenges\.cloudflare\.com|perimeterx|px-cloud|arkoselabs/i
const BOT_WALL = /just a moment|checking your browser|verify you are human|access denied|are you a robot|unusual traffic/i
const EEO_LABEL = /gender|race|ethnic|hispanic|latino|veteran|disab|self.?identif/i
const DECLINE_OPTION = /decline|prefer not|do not wish|don'?t wish|not to answer|not to say|choose not|rather not|opt out|no response|not disclose|undisclosed|i do not want/i

/** Voluntary self-identification beyond the classic EEO set. */
const SELF_ID_LABEL = /\bpronouns?\b|sexual orientation|gender identity|\btransgender\b|hispanic|latin[xo]|race\/?ethnicity|protected veteran/i

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
  /** work-auth answers taken from the profile rather than a model */
  groundedAnswers: number
  /** model answers discarded for declining instead of answering */
  refusalsRejected: number
  /** required fields deliberately left blank for the human */
  leftForHuman: number
  /** answered from a screening answer the user gave earlier */
  screeningAnswers: number
  /** set when the form asks something we must not answer automatically */
  disqualified: string | null
  /** required fields still empty at the end, with why we could not fill them —
   *  the only way to tell a question we could not answer from a control we
   *  could not drive. */
  residual: Array<{ kind: string; label: string; hasSelector: boolean }>
  costUsd: number
  submitAttemptsBlocked: number
  /** the résumé PDF was attached to the form's file input */
  resumeAttached: boolean
  /** true only when allowSubmit was set AND the submission was confirmed */
  submitted: boolean
  /** what the submit attempt did, and the evidence for that verdict */
  submit: SubmitOutcome
  /** controls the form itself rejected at the moment we were ready to submit */
  formInvalid: Array<{ label: string; message: string }>
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
  /** Employment type, so "are you a full-time student" can flip on internships. */
  employmentType?: string | null
  /** Total years of experience, for level-based rate defaults. */
  yearsOfExperience?: number | null
  /** The résumé to attach. Without it an application goes out with no CV. */
  resume?: Resume | null
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
  // File inputs are INCLUDED. Excluding them meant a form with an empty résumé
  // slot scored 100% required coverage — the single most important field on an
  // application was outside the denominator, so the number was true and
  // meaningless at once.
  const ctrls = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const t = (el.getAttribute("type")||"").toLowerCase();
    if (["hidden","submit","button","image","reset"].indexOf(t) !== -1) return false;
    return vis(el); });
  const labelFor = (el) => {
    const id = el.getAttribute("id");
    const bf = id ? document.querySelector('label[for="' + (window.CSS&&CSS.escape?CSS.escape(id):id) + '"]') : null;
    const wr = el.closest("label");
    let t = (bf&&bf.textContent)||(wr&&wr.textContent)||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"";
    // Radio and checkbox groups carry the question on a fieldset legend or a
    // container heading, never on the input. Inspecting only the input left 40
    // of 86 unfilled required fields with NO label, so they could neither be
    // answered nor put to the user as a question.
    if (!t.trim()) {
      const lb = el.getAttribute("aria-labelledby");
      if (lb) t = lb.split(/\\s+/).map(function(i){ const n=document.getElementById(i); return n?n.textContent:""; }).join(" ");
    }
    if (!t.trim()) {
      const fs = el.closest("fieldset");
      const lg = fs && fs.querySelector("legend");
      if (lg) t = lg.textContent || "";
    }
    if (!t.trim()) {
      const box = el.closest('[class*="question" i], [class*="field" i], [class*="form-group" i], [role="group"]');
      const head = box && box.querySelector('label, legend, h1, h2, h3, h4, [class*="label" i]');
      if (head) t = head.textContent || "";
    }
    return t.replace(/\\s+/g," ").trim(); };
  // react-select keeps the chosen value OUT of the input; it renders in a
  // sibling node. Reading only el.value scores an answered dropdown as a gap.
  // Mirrors isSentinelValue in lib/autofill/answer-policy.ts: an untouched
  // JazzHR dropdown holds "resumator_no_selection", which is non-empty and was
  // therefore scored as answered. It is not an answer.
  const SENTINEL = /^[\\s\\u002d\\u2010-\\u2015]*(resumator_no_selection|no_selection|select|please\\s+select|select\\s+one|choose(\\s+one)?|none|n\\/?a)[\\s\\u002d\\u2010-\\u2015]*$/i;
  const hasValue = (el) => {
    if ((el.getAttribute("type")||"").toLowerCase() === "file") {
      return !!(el.files && el.files.length > 0);
    }
    const raw = (el.value||"").trim();
    if (raw.length > 0 && !SENTINEL.test(raw)) return true;
    const w = el.closest('[class*="control" i]') || el.parentElement;
    if (w) {
      const sv = w.querySelector('[class*="singleValue" i], [class*="single-value" i], [class*="multiValue" i]');
      const svt = sv ? (sv.textContent||"").trim() : "";
      if (svt && !SENTINEL.test(svt)) return true;
      const h = w.querySelector('input[type="hidden"]');
      const hv = h ? (h.value||"").trim() : "";
      if (hv && !SENTINEL.test(hv)) return true;
    }
    return false; };
  // JazzHR (and several others) mark a field required with an asterisk in the
  // label rather than the HTML attribute. Checking only the attribute found
  // ZERO required fields on those forms, which scored 0/0 as 100% coverage —
  // a form we had barely filled reported as fully complete.
  const req = (el) => {
    if (el.hasAttribute("required") || el.getAttribute("aria-required") === "true") return true;
    const l = labelFor(el);
    if (/[*✱]\\s*$/.test(l) || /[*✱]/.test(l)) return true;
    const w = el.closest('.field, .form-group, [class*="field" i], [class*="question" i]');
    if (w && /[*✱]/.test((w.querySelector("label")||{}).textContent || "")) return true;
    if (w && /\\brequired\\b/i.test(w.className || "")) return true;
    return false;
  };
  // react-select renders TWO controls per field: the visible combobox and a
  // hidden companion input with no label of its own. Counting both made one
  // question look like two unfilled requirements — 16 of Sony's 21 gaps were
  // this artifact, and no answer could ever clear them.
  const isSelectArtifact = (el) => {
    // Identified structurally, not by a missing label: improving label lookup
    // made the companion inherit the container's label, so "has no label" stopped
    // finding it. The companion is any control inside a select widget that is
    // not itself the combobox.
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")) return false;
    const box = el.closest('[class*="select" i], [class*="control" i], [class*="combobox" i]');
    if (!box) return false;
    const combo = box.querySelector('[role="combobox"], [aria-autocomplete]');
    return !!combo && combo !== el;
  };
  const required = ctrls.filter((el) => req(el) && !isSelectArtifact(el));
  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type")||"").toLowerCase();
    if (type === "file") return "file";
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
      // Last resort: stamp the element so it can be found again. A positional
      // path breaks as React re-renders; an attribute survives.
      let sel = id ? "#" + (window.CSS&&CSS.escape?CSS.escape(id):id)
              : nm ? el.tagName.toLowerCase() + '[name="' + nm.replace(/"/g,'\\\\"') + '"]' : null;
      if (!sel) {
        const stamp = "ho" + Math.abs(Array.from(labelFor(el)+el.tagName).reduce(function(a,c){return ((a<<5)-a+c.charCodeAt(0))|0;},0));
        el.setAttribute("data-ho-field", stamp);
        sel = '[data-ho-field="' + stamp + '"]';
      }
      return { sel: sel, kind: kindOf(el), label: labelFor(el).slice(0,90) };
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

async function installGuards(
  page: Page,
  state: { armed: boolean; blocked: number },
  allowSubmit: boolean,
) {
  // The in-page stub is installed ONLY for dry runs. Left in place it would
  // block a permitted submission too, which would present as a silent failure
  // rather than a refusal.
  if (!allowSubmit) await page.addInitScript(() => {
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

const ANSWER_INSTRUCTIONS = `You help a job applicant answer application-form questions. Answer as the applicant, first person. Match the answer length to the question. Return ONLY the answer text — no preamble, no quotes, no explanation. Your reply goes straight into the form, so never address the reader and never say the information is missing.
- Yes/No → just "Yes" or "No".
- Numeric → the number with a unit.
- Open-ended → 2-4 sentences grounded in the résumé.

BE CONFIDENT ABOUT WHAT THE RÉSUMÉ SUPPORTS. Do not undersell.
- If a question asks about a skill, tool, or kind of work in the SAME DOMAIN as
  the applicant's background, answer "Yes". A résumé listing backend services
  supports "REST APIs", "databases", "debugging"; an engineering résumé supports
  "Excel" and "documentation". Do not demand the exact word appear.
- For "N+ years" questions in the applicant's own field, compare N against the
  total years in DERIVED FACTS and answer Yes when it is met.
- Being literal about wording is a wrong answer, not a careful one: it rejects
  the applicant from roles they are qualified for.

BUT NEVER CLAIM WHAT IS NOT THERE. Answer "No" when the question asks about:
- A licence, certification, clearance or registration the résumé does not show
  (e.g. Licensed Physical Therapist, CPA, CDL, security clearance).
- A named employer, product, or credential the résumé does not name.
- A whole field the applicant has not worked in (real estate, bartending,
  nursing, payroll) — an unrelated domain is not an adjacent skill.
- A specific language they are not shown to speak.
These are checkable and a false answer can void an offer, so "No" is correct
even though it may lose the application.

HARD FACTS (work authorization, sponsorship, citizenship, criminal history) come
from the profile only — never guess.
If the question truly cannot be settled either way, reply exactly: UNKNOWN`

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

/**
 * Drive an ARIA / react-select combobox to a chosen option.
 *
 * Ported from chrome-extension/src/autofill/ashby-autofill.ts, which solved
 * this already. Two details make the difference between working and silently
 * doing nothing, and missing either produced a 0% success rate here:
 *
 *   Opening. A click is not enough. SmartRecruiters' spl-autocomplete and other
 *   ARIA comboboxes ignore pointer events entirely and only open on ArrowDown,
 *   so the sequence is pointer + mouse + click AND a keydown. Clicking the
 *   control wrapper alone left aria-expanded="false" and the option nodes
 *   present but hidden, which read as "no options".
 *
 *   Committing. Clicking the option WRAPPER never commits — the handlers sit on
 *   the deepest text-bearing leaf (an inner truncate/slot element), possibly
 *   across an open shadow root. Walking down to that leaf is what makes the
 *   selection stick.
 *
 * Success is aria-expanded returning to "false", or the control showing a
 * value: the menu staying open means nothing was taken.
 */
/** Read a combobox's options without choosing one, so the user can be shown
 *  exactly the choices the form offered. */
function readComboOptionsExpr(selector: string): string {
  return `(async () => {
  const SEL = ${JSON.stringify(selector)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const el = document.querySelector(SEL);
  if (!el) return [];
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  try {
    // Same sequence as selectComboOptionExpr. The reader previously used a
    // weaker one (no pointer events) and returned an empty list every time, so
    // no dropdown's choices ever reached the model or the user: 0 of 28
    // captured questions had options recorded.
    const fire = (n, type) => { try { n.dispatchEvent(new PointerEvent(type, { bubbles: true,
      cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 })); } catch (e) {} };
    // Close any menu left open by the previous control before opening this one
    // — see openCombo in selectComboOptionExpr for why this matters.
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const active = document.activeElement;
      if (active && active !== el && active.blur) active.blur();
    } catch (e) {}
    await sleep(180);
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    try { el.focus({ preventScroll: false }); } catch (e) {}
    fire(el, "pointerdown");
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 }));
    fire(el, "pointerup");
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, button: 0 }));
    if (el.click) el.click();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    for (let i = 0; i < 20; i++) {
      const opts = Array.from(document.querySelectorAll(
        '[role="option"], [class*="option" i], [class*="menuItem" i], li[role]'
      )).filter((n) => vis(n) && norm(n.textContent).length > 0);
      if (opts.length) return opts.map((o) => norm(o.textContent)).slice(0, 25);
      await sleep(140);
    }
    return [];
  } catch (e) { return []; }
})()`
}

function selectComboOptionExpr(selector: string, wanted: string): string {
  return `(async () => {
  const SEL = ${JSON.stringify(selector)}, WANT = ${JSON.stringify(wanted)}.toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const el = document.querySelector(SEL);
  if (!el) return false;
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };

  const firePointer = (n, type, c) => {
    try { n.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
      ...(c ? { clientX: c.x, clientY: c.y } : {}) })); } catch (e) {}
  };
  const openCombo = (n) => {
    // Close whatever is already open before opening this one. Forms carry
    // several of these in a row, and a menu left mounted from the previous
    // control swallows the next open: the first combobox on a page worked and
    // every one after it returned an empty option list, which read as "no
    // options" and skipped both the profile answer and the decline option.
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const active = document.activeElement;
      if (active && active !== n && active.blur) active.blur();
    } catch (e) {}
    // Scroll the CONTROL into view. Self-identification fields sit at the
    // bottom of long forms, and while off-screen their option nodes fail the
    // visibility filter.
    try { n.scrollIntoView({ block: "center" }); } catch (e) {}
    try { n.focus({ preventScroll: false }); } catch (e) {}
    firePointer(n, "pointerdown");
    n.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 }));
    firePointer(n, "pointerup");
    n.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, button: 0 }));
    if (n.click) n.click();
    // The one that actually opens ARIA comboboxes.
    n.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  };
  // Handlers live on the deepest text-bearing descendant, not the wrapper.
  const deepestLeaf = (n) => {
    let node = n;
    for (let d = 0; d < 14; d++) {
      const scope = node.shadowRoot || node;
      const kids = Array.from(scope.children || []);
      if (!kids.length) break;
      const next = kids.filter((k) => norm(k.textContent)).pop() || kids[kids.length - 1];
      if (!next || next === node) break;
      node = next;
    }
    return node;
  };
  const collect = () => Array.from(document.querySelectorAll(
    '[role="option"], [class*="option" i], [class*="menuItem" i], li[role]'
  )).filter((n) => vis(n) && norm(n.textContent).length > 0);

  try {
    openCombo(el);
    let opts = [];
    for (let i = 0; i < 20; i++) { opts = collect(); if (opts.length) break; await sleep(140); }
    if (!opts.length) return false;

    const exact = opts.find((o) => norm(o.textContent).toLowerCase() === WANT);
    const partial = opts.find((o) => norm(o.textContent).toLowerCase().indexOf(WANT) !== -1);
    const target = exact || partial;
    if (!target) return false;

    const leaf = deepestLeaf(target);
    const r = leaf.getBoundingClientRect();
    const c = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    target.scrollIntoView({ block: "center" });
    firePointer(leaf, "pointerdown", c);
    leaf.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0, clientX: c.x, clientY: c.y }));
    firePointer(leaf, "pointerup", c);
    leaf.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, button: 0, clientX: c.x, clientY: c.y }));
    leaf.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, button: 0, clientX: c.x, clientY: c.y }));
    await sleep(300);

    // A menu still open means nothing was committed.
    // Same sentinel filter as hasValue in INSPECT. A control still showing its
    // placeholder is NOT committed, and treating it as committed made a failed
    // selection report success and suppressed every fallback behind it.
    const SENT = /^[\\s\\u002d\\u2010-\\u2015]*(resumator_no_selection|no_selection|select|please\\s+select|select\\s+one|choose(\\s+one)?|none|n\\/?a)[\\s\\u002d\\u2010-\\u2015]*$/i;
    const committed = () => {
      const raw = norm(el.value);
      if (raw && !SENT.test(raw)) return true;
      const w = el.closest('[class*="control" i]') || el.parentElement;
      const sv = w && w.querySelector('[class*="singleValue" i], [class*="single-value" i]');
      const svt = sv ? norm(sv.textContent) : "";
      return !!(svt && !SENT.test(svt));
    };
    if (el.getAttribute("aria-expanded") !== "true" && committed()) return true;

    // Fallback: type to filter, then Enter. This needs no option list at all,
    // which matters because reading options proved unreliable when several
    // controls on one form are driven in sequence — the menu renders for the
    // first and comes back empty for the rest. Typing drives react-select
    // through its own keyboard path instead.
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      openMenu(el);
      if (setter && setter.set) setter.set.call(el, WANT); else el.value = WANT;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(500);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(350);
      if (committed()) return true;
      // Last resort: first highlighted option via the keyboard.
      openMenu(el);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await sleep(200);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(300);
    } catch (e) {}
    return committed();
  } catch (e) { return false; }
})()`
}

/**
 * Answer a closed question by picking one of the control's own options.
 *
 * Experience and skill questions — "4+ years of sales experience?", "level of
 * experience with Excel", "do you speak French and English?" — are answerable
 * from the résumé, but arrive as dropdowns. Without this they skipped the model
 * entirely and landed in the backlog to be put to the user, who would only be
 * re-reading their own résumé to answer.
 *
 * The option list is supplied and the model must reply with one verbatim, so it
 * cannot produce a value the form will not accept. It is told to answer NONE
 * rather than guess, because claiming experience the résumé does not support is
 * a lie on an application, and an unanswered field is merely incomplete.
 */
async function chooseFromOptions(
  anthropic: Anthropic, question: string, options: string[],
  resumeContext: string, userId: string, runId: string,
): Promise<string | null> {
  const msg = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 60,
    system: [
      { type: "text", text: `Answer one application-form question by selecting exactly one of the offered options.
Reply with the option text VERBATIM and nothing else.

Be confident about what the résumé supports: a skill, tool or kind of work in
the SAME DOMAIN as the applicant's background counts as Yes, and for "N+ years"
compare against the total in DERIVED FACTS. Being literal about wording rejects
an applicant from roles they are qualified for.

But never claim a licence, certification, named credential, specific language,
or experience in a field they have not worked in — those are checkable and a
false answer can void an offer. If no option is truthful, reply NONE.` },
      { type: "text", text: `APPLICANT RÉSUMÉ:\n${resumeContext}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `Question: ${question}\nOptions:\n${options.map((o) => `- ${o}`).join("\n")}` }],
  }).catch(() => null)
  if (!msg) return null

  const inputTokens = msg.usage?.input_tokens ?? 0
  const outputTokens = msg.usage?.output_tokens ?? 0
  const cacheReadTokens = msg.usage?.cache_read_input_tokens ?? 0
  const cacheWriteTokens = msg.usage?.cache_creation_input_tokens ?? 0
  await logApiUsage({
    service: "claude", operation: "auto_apply_choose_option", feature: "auto_apply",
    model: HAIKU_MODEL, user_id: userId, run_id: runId,
    input_tokens: inputTokens, output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens, cache_write_tokens: cacheWriteTokens,
    tokens_used: inputTokens + outputTokens,
    cost_usd: calcAnthropicCostUsd({ tier: "haiku", inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  })

  const text = msg.content.filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text).join("").trim()
  if (!text || /^none$/i.test(text) || !isUsableAnswer(text)) return null
  // Only accept something the control actually offers.
  return options.find((o) => o.toLowerCase() === text.toLowerCase())
      ?? options.find((o) => o.toLowerCase().includes(text.toLowerCase()))
      ?? null
}

/**
 * Ask the FORM whether it is complete, rather than trusting our own count.
 *
 * `requiredFilled/requiredTotal` only ever recorded what the filler believed it
 * had typed. On a BambooHR form that belief read 9/9 while the State dropdown
 * was empty, so the run clicked submit with total confidence into a validation
 * wall — twice, identically, because nothing ever read the page's answer.
 *
 * Constraint validation is the browser's own verdict and costs one evaluate().
 */
const FORM_VALIDITY = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const labelOf = (el) => {
    let t = "";
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = l.textContent || ""; }
    if (!t) { const l = el.closest("label"); if (l) t = l.textContent || ""; }
    if (!t) {
      const box = el.closest('[class*="field" i],[class*="form" i],[class*="question" i]');
      const h = box && box.querySelector("label,legend");
      if (h) t = h.textContent || "";
    }
    return (t || "").replace(/\s+/g, " ").trim().slice(0, 80);
  };
  // name before id. Design systems regenerate ids on re-render, so a selector
  // captured here stops resolving the moment the widget updates — the verify
  // step then reads null, calls a successful pick a failure, and the field is
  // reported unfilled while the form is actually complete.
  const sel = (el) => {
    const nm = el.getAttribute("name");
    if (nm) return el.tagName.toLowerCase() + '[name="' + CSS.escape(nm) + '"]';
    return el.id ? "#" + CSS.escape(el.id) : null;
  };

  const invalid = [];
  for (const el of Array.from(document.querySelectorAll("input, textarea, select"))) {
    if (el.disabled || (el.getAttribute("type") || "").toLowerCase() === "hidden") continue;
    // Not filtered by visibility alone: MUI-style widgets render the real
    // control in a popup and leave a hidden native element behind, and that
    // mirror is what the browser validates. Skipping it is why this gate passed
    // a BambooHR form whose State was empty.
    //
    // An invisible control with neither name nor id is a different animal —
    // framework scaffolding, like the bare file input behind a styled uploader
    // that stays "empty" while the résumé is attached and displayed. We cannot
    // name it, target it, or report it usefully, and treating it as a blocker
    // refuses forms that are in fact complete.
    if (!vis(el) && !sel(el)) continue;
    if (typeof el.checkValidity === "function" && el.checkValidity()) continue;
    invalid.push({
      label: labelOf(el),
      sel: sel(el),
      kind: el.tagName.toLowerCase() === "select" ? "select"
        : (el.getAttribute("type") || "text").toLowerCase(),
      message: (el.validationMessage || "").slice(0, 120),
    });
  }

  // Rendered messages catch what constraint validation cannot — BambooHR's
  // "Invalid website URL." lives on a type=text input that passes checkValidity.
  const RE = /required|please (make a selection|select|enter|complete|choose)|invalid|must be|cannot be blank|is not valid|enter a valid/i;
  const messages = [];
  for (const el of Array.from(document.querySelectorAll('[class*="error" i],[class*="invalid" i],[role="alert"],[aria-live]'))) {
    if (!vis(el)) continue;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t && t.length < 160 && RE.test(t) && messages.indexOf(t) === -1) messages.push(t);
  }
  return { invalid: invalid.slice(0, 25), messages: messages.slice(0, 10) };
})()`

/**
 * Clear optional URL fields holding something the site will reject.
 *
 * A junk value in "Website, Blog or Portfolio" — a field nobody required —
 * was enough for BambooHR to refuse the whole submission. An optional field we
 * cannot fill correctly is better left empty; a required one gets a scheme
 * prepended, which is the usual reason it was rejected.
 */
const SANITIZE_URL_FIELDS = `(() => {
  const URLISH = /website|portfolio|blog|url|link/i;
  const VALID = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
  const labelOf = (el) => {
    let t = "";
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = l.textContent || ""; }
    if (!t) { const l = el.closest("label"); if (l) t = l.textContent || ""; }
    if (!t) { const box = el.closest('[class*="field" i],[class*="form" i]'); const h = box && box.querySelector("label"); if (h) t = h.textContent || ""; }
    return (t || "").replace(/\s+/g, " ").trim();
  };
  const setValue = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (d && d.set) d.set.call(el, v); else el.value = v;
    ["input", "change", "blur"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  };
  let cleaned = 0, repaired = 0;
  for (const el of Array.from(document.querySelectorAll('input[type="text"], input[type="url"], input:not([type])'))) {
    const v = (el.value || "").trim();
    if (!v || VALID.test(v)) continue;
    const label = labelOf(el);
    if (!URLISH.test(label)) continue;
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true" || /[*✱]/.test(label);
    const withScheme = "https://" + v.replace(/^\/+/, "");
    if (VALID.test(withScheme)) { setValue(el, withScheme); repaired++; continue; }
    if (!required) { setValue(el, ""); cleaned++; }
  }
  return { cleaned, repaired };
})()`

/** Set a native <select> by matching option text, then fire change for React. */
function selectNativeOptionExpr(selector: string, wanted: string): string {
  return `(() => {
  const SEL = ${JSON.stringify(selector)}, WANT = ${JSON.stringify(wanted)}.toLowerCase();
  const el = document.querySelector(SEL);
  if (!el || !el.options) return false;
  const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const opts = Array.from(el.options).filter((o) => norm(o.textContent) && o.value !== "");
  const m = opts.find((o) => norm(o.textContent).toLowerCase() === WANT)
        || opts.find((o) => norm(o.textContent).toLowerCase().indexOf(WANT) !== -1)
        || opts.find((o) => WANT.indexOf(norm(o.textContent).toLowerCase()) !== -1);
  if (!m) return false;
  const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  if (d && d.set) d.set.call(el, m.value); else el.value = m.value;
  ["input","change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  return (el.value || "") === m.value;
})()`
}

/** Read a native select's options, so the model can be constrained to them. */
function readNativeOptionsExpr(selector: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el || !el.options) return [];
  return Array.from(el.options)
    .filter((o) => o.value !== "" && (o.textContent || "").trim())
    .map((o) => (o.textContent || "").replace(/\\s+/g, " ").trim())
    .slice(0, 30);
})()`
}

/**
 * Greenhouse names its fields semantically — gender, hispanic_ethnicity,
 * veteran_status, disability_status, candidate-location — so the id is a far
 * more reliable classifier than the visible label, which varies per company
 * ("Please identify your race", "Race/Ethnicity", "What is your race?") and
 * sometimes carries the widget's own error text.
 *
 * Returns a label-shaped string so the existing matchers work unchanged.
 */
function labelFromSelector(sel: string | null): string | null {
  if (!sel) return null
  const id = sel.replace(/^#/, "").replace(/^\[[a-z-]+="/i, "").replace(/"\]$/, "").toLowerCase()
  if (/hispanic|latin/.test(id)) return "Are you Hispanic/Latino?"
  if (/race|ethnic/.test(id)) return "Please identify your race/ethnicity"
  if (/veteran/.test(id)) return "Veteran status"
  if (/disab/.test(id)) return "Disability status"
  if (/gender/.test(id)) return "Gender"
  if (/pronoun/.test(id)) return "Pronouns"
  if (/orientation/.test(id)) return "Sexual orientation"
  if (/candidate-location|^location$|\blocation\b/.test(id)) return "Location (City)"
  return null
}

/** The real submit control, and text that never identifies one. */
const SUBMIT_LABEL = /^(submit|submit application|submit my application|send application|finish|complete application)$/i
const NOT_SUBMIT = /save|draft|cancel|back|previous|preview|upload|attach|add another|apply now/i

/**
 * Wording ATS confirmation pages actually use. Kept narrow enough that a job
 * description mentioning "thank you for your interest" cannot pass for a
 * receipt, since a false confirmation writes 'applied' for an application that
 * does not exist.
 */
const SUBMIT_CONFIRMED =
  /thank you for applying|thanks for applying|application (has been |was )?(received|submitted|sent)|we(?: have|'ve) received your application|received your application|successfully (applied|submitted)|application complete|submission (received|complete)/i

/**
 * The form refusing the submission in its own words. Deliberately phrased as
 * whole messages, so a job description mentioning "required experience" cannot
 * be mistaken for a validation failure.
 */
const SUBMIT_REJECTED =
  /please make a selection|please select|this field is required|is required\b|cannot be blank|invalid [a-z ]{0,20}(url|email|phone|date|format)|enter a valid|please correct|there (was|were) (an? )?error/i

/** How long to keep looking for a receipt before giving up on one. */
const CONFIRM_TIMEOUT_MS = 20_000
const CONFIRM_POLL_MS = 500

type FormValidity = {
  invalid: Array<{ label: string; sel: string | null; kind: string; message: string }>
  messages: string[]
}

export type SubmitOutcome = {
  /** a submit control was found, enabled, and clicked */
  clicked: boolean
  /** the page then proved the submission landed */
  confirmed: boolean
  /** the page said the form was wrong — a definite "nothing was sent" */
  rejected: boolean
  /** label of the control clicked, for diagnosing a wrong-button click */
  label: string | null
  urlBefore: string | null
  urlAfter: string | null
  /** trimmed page text after the click — the evidence behind the verdict */
  pageText: string | null
}

export const EMPTY_SUBMIT_OUTCOME: SubmitOutcome = {
  clicked: false, confirmed: false, rejected: false, label: null,
  urlBefore: null, urlAfter: null, pageText: null,
}

/**
 * Decide what a click actually achieved.
 *
 * Split out from the browser work so the verdict is testable: the first live
 * run recorded four completed applications as plain failures, and there was no
 * way to tell afterwards whether they had been sent.
 */
export function classifySubmitOutcome(input: {
  clicked: boolean
  urlBefore: string | null
  urlAfter: string | null
  pageText: string | null
}): "not_clicked" | "confirmed" | "rejected" | "unconfirmed" {
  if (!input.clicked) return "not_clicked"
  if (input.pageText && SUBMIT_CONFIRMED.test(input.pageText)) return "confirmed"
  // The page telling us a field is wrong is a definite answer: nothing was
  // sent. Filing that as "unconfirmed" wasted a real investigation working out
  // whether four applications existed, when the page had said so all along.
  if (input.pageText && SUBMIT_REJECTED.test(input.pageText)) return "rejected"
  // Those anchor submits carry href="#", so a click that merely failed
  // validation still moves the URL from ".../Role" to ".../Role#". Comparing
  // without the fragment keeps that from reading as a successful navigation.
  const doc = (u: string | null) => (u ?? "").split("#")[0]
  if (input.urlBefore && input.urlAfter && doc(input.urlAfter) !== doc(input.urlBefore)) {
    return "confirmed"
  }
  return "unconfirmed"
}

/**
 * Click submit, then confirm from the PAGE that it went through.
 *
 * Reached only when the caller passed allowSubmit AND every required field is
 * filled. Success is judged from the resulting page rather than from the click
 * not throwing: a click that silently fails validation would otherwise be
 * recorded as "applied", corrupting the ledger the caps are computed from and
 * telling the user an application exists when it does not.
 */
async function submitForm(page: Page): Promise<SubmitOutcome> {
  // Anchors count. JazzHR's submit is <a href="#" id="resumator-submit-resume">
  // inside the form, so a button-only query found nothing, returned false, and
  // every completed application was recorded as a dry run — the form was filled
  // perfectly and then simply abandoned.
  const urlBefore = page.url()
  const out: SubmitOutcome = { ...EMPTY_SUBMIT_OUTCOME, urlBefore }

  for (const el of await page.$$("button, input[type=submit], a, [role=button]")) {
    const label = (
      ((await el.textContent().catch(() => "")) ?? "") ||
      ((await el.getAttribute("value").catch(() => "")) ?? "")
    ).replace(/\s+/g, " ").trim()
    if (!label || label.length > 40) continue
    // Denylist first, so it wins over any allowlist match.
    if (NOT_SUBMIT.test(label) || !SUBMIT_LABEL.test(label)) continue
    if (!(await el.isVisible().catch(() => false))) continue
    if (!(await el.isEnabled().catch(() => false))) continue
    await el.click({ timeout: 10_000 }).catch(() => {})
    out.clicked = true
    out.label = label
    break
  }
  if (!out.clicked) return out

  // Poll rather than sleeping a fixed five seconds. The old wait returned a
  // verdict on whatever the page happened to be showing at 5.0s, which is
  // before some ATS have finished posting the application — a slow receipt was
  // indistinguishable from no receipt at all.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  for (;;) {
    out.urlAfter = page.url()
    out.pageText = await readPageText(page)
    const verdict = classifySubmitOutcome(out)
    // Stop on any definite answer. Waiting out the full timeout on a form that
    // has already said "please make a selection" just delays the run.
    if (verdict === "confirmed" || verdict === "rejected") break
    if (Date.now() >= deadline) break
    await page.waitForTimeout(CONFIRM_POLL_MS).catch(() => {})
  }

  const verdict = classifySubmitOutcome(out)
  out.confirmed = verdict === "confirmed"
  out.rejected = verdict === "rejected"
  return out
}

/** Body text after a submit click, trimmed to what fits in the ledger. */
async function readPageText(page: Page): Promise<string | null> {
  const text = await page.evaluate(
    `(document.body && document.body.innerText) ? document.body.innerText : ""`,
  ).catch(() => "")
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim()
  return trimmed ? trimmed.slice(0, 1000) : null
}


/**
 * Select a combobox option using Playwright's own input, not synthetic events.
 *
 * Everything else here dispatches events from inside the page, which React
 * accepts for value changes but which react-select's menu handling has resisted
 * across several attempts. Playwright clicks at the browser level, so the events
 * carry `isTrusted` and follow the real hit-testing path — the same thing a
 * person does. Tried first, with the in-page path kept as the fallback for
 * controls where a real click cannot land (covered, zero-size, or inside a
 * closed shadow root).
 */
/**
 * Read a widget's options by opening it, the way a person would.
 *
 * The in-page reader queries the element it is handed, which for a hidden
 * native mirror means one blank option and an empty list — so the field looked
 * unanswerable and was skipped without a single attempt.
 */
/** Resolve a known answer to the exact wording a menu uses. */
function matchOption(want: string, options: string[]): string | null {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase()
  for (const alias of usStateAliases(want)) {
    const hit = options.find((o) => norm(o) === norm(alias))
    if (hit) return hit
  }
  const loose = options.find(
    (o) => norm(o).includes(norm(want)) || norm(want).includes(norm(o)),
  )
  return loose ?? null
}

async function readComboOptionsNative(page: Page, selector: string): Promise<string[]> {
  try {
    const native = page.locator(selector).first()
    if (!(await native.count())) return []
    const visible = await native.isVisible().catch(() => false)
    const control = visible
      ? native
      : native.locator(
          'xpath=ancestor::*[contains(@class,"FormControl") or contains(@class,"field")][1]',
        ).locator('button, [role="combobox"], [class*="Toggle"]').first()
    if (!(await control.count().catch(() => 0))) return []

    await control.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {})
    await control.click({ timeout: 5_000 })
    await page.waitForTimeout(600)

    const options = page.locator('[role="option"], [class*="option" i]:visible')
    const count = Math.min(await options.count().catch(() => 0), 80)
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const text = ((await options.nth(i).textContent().catch(() => "")) ?? "")
        .replace(/\s+/g, " ").trim()
      // Nested nodes repeat the same label; the chooser wants a clean menu.
      if (text && text.length < 60 && !out.includes(text)) out.push(text)
    }
    // Leave nothing half-open for the next control to trip over.
    await page.keyboard.press("Escape").catch(() => {})
    await page.waitForTimeout(300)
    return out
  } catch {
    return []
  }
}

async function selectComboNative(
  page: Page, selector: string, wanted: string,
): Promise<boolean> {
  try {
    const native = page.locator(selector).first()
    if (!(await native.count())) return false

    // Click what a person clicks. Design systems like BambooHR's Fabric render
    // the real widget as a button and leave the <select> behind as a 0x0,
    // opacity-0 mirror — clicking that mirror opens nothing, so every option
    // read came back empty and the field was written off as unfillable. The
    // mirror is still what the browser validates, which is how a form could pass
    // checkValidity and then refuse the submission on the framework's own state.
    const visible = await native.isVisible().catch(() => false)
    const control = visible
      ? native
      : native.locator(
          'xpath=ancestor::*[contains(@class,"FormControl") or contains(@class,"field")][1]',
        ).locator('button, [role="combobox"], [class*="Toggle"]').first()
    if (!(await control.count().catch(() => 0))) return false

    await control.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {})
    await control.click({ timeout: 5_000 })
    await page.waitForTimeout(500)

    const want = wanted.toLowerCase()
    const options = page.locator('[role="option"], [class*="option" i]:visible')

    // Ask for the option by name first. Walking the list with a cap stopped
    // around "Arizona" on a state menu, so every state past it was unreachable,
    // and a virtualised list may not render the wanted row until it is asked for.
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const byName = options.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, "i") }).first()
    let target = (await byName.count().catch(() => 0)) ? byName : null

    if (!target) {
      const count = Math.min(await options.count().catch(() => 0), 40)
      let partial = -1
      for (let i = 0; i < count; i++) {
        const text = ((await options.nth(i).textContent().catch(() => "")) ?? "")
          .replace(/\s+/g, " ").trim().toLowerCase()
        if (!text) continue
        if (text === want) { partial = i; break }
        if (partial < 0 && (text.includes(want) || want.includes(text))) partial = i
      }
      if (partial >= 0) target = options.nth(partial)
    }

    if (!target) {
      // Leave nothing half-open for the next control to trip over.
      await page.keyboard.press("Escape").catch(() => {})
      return false
    }
    await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {})
    await target.click({ timeout: 5_000 })
    await page.waitForTimeout(400)

    return await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
      // Must match hasValue in INSPECT exactly, sentinel filter included.
      // Without it a control still showing its placeholder ("Select...") counted
      // as committed, so the selection reported success while coverage still saw
      // the field as empty — a field that was "handled" yet never filled, and
      // the fallbacks never ran because the first attempt claimed to work.
      const SENTINEL = /^[\\s\\u002d\\u2010-\\u2015]*(resumator_no_selection|no_selection|select|please\\s+select|select\\s+one|choose(\\s+one)?|none|n\\/?a)[\\s\\u002d\\u2010-\\u2015]*$/i;
      const raw = norm(el.value);
      if (raw && !SENTINEL.test(raw)) return true;
      const w = el.closest('[class*="control" i]') || el.parentElement;
      const sv = w && w.querySelector('[class*="singleValue" i], [class*="single-value" i]');
      const svt = sv ? norm(sv.textContent) : "";
      return !!(svt && !SENTINEL.test(svt));
    })()`).then(Boolean).catch(() => false)
  } catch {
    return false
  }
}

/** Résumé fields, as distinct from the other file inputs a form may offer. */
const RESUME_FIELD = /resume|résumé|\bcv\b|curriculum/i
/** Never attach the résumé to one of these. */
const NOT_RESUME = /cover letter|portfolio|transcript|certificate|photo|headshot|writing sample/i

/**
 * Attach the résumé to the form's file input.
 *
 * Without this an application goes out with a name, an email and no CV — not a
 * weak application but a discarded one, and it burns the posting, since you
 * cannot reapply to a job you have already applied to badly.
 *
 * The PDF is generated from the parsed résumé rather than pulled from object
 * storage, because the app-worker has no MinIO access. It is written to a temp
 * file because setInputFiles needs a path, and removed afterwards.
 */
async function attachResume(page: Page, resume: Resume): Promise<boolean> {
  let tmp: string | null = null
  try {
    const inputs = await page.$$('input[type="file"]')
    if (inputs.length === 0) return false

    // Pick the résumé input specifically. Attaching a CV to the cover-letter
    // slot is its own kind of wrong.
    let target = null
    for (const el of inputs) {
      const id = (await el.getAttribute("id").catch(() => "")) ?? ""
      const name = (await el.getAttribute("name").catch(() => "")) ?? ""
      const aria = (await el.getAttribute("aria-label").catch(() => "")) ?? ""
      const hay = `${id} ${name} ${aria}`
      if (NOT_RESUME.test(hay)) continue
      if (RESUME_FIELD.test(hay)) { target = el; break }
      if (!target) target = el   // fall back to the first non-excluded input
    }
    if (!target) return false

    const pdf = await generateResumePDF(resume)
    const path = join(tmpdir(), `ho-resume-${randomUUID()}.pdf`)
    tmp = path
    await writeFile(path, pdf)
    await target.setInputFiles(path, { timeout: 15_000 })
    await page.waitForTimeout(1_500)

    return await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('input[type="file"]'));
      return els.some((e) => e.files && e.files.length > 0);
    })()`).then(Boolean).catch(() => false)
  } catch {
    return false
  } finally {
    if (tmp) await unlink(tmp).catch(() => {})
  }
}

export async function runFillAttempt(opts: FillOptions): Promise<FillAttempt> {
  const r: FillAttempt = {
    ok: false, blocked: false, formReached: false,
    requiredTotal: 0, requiredFilled: 0, requiredRate: 0,
    aiQuestions: 0, aiWrittenBack: 0, eeoDeclined: 0,
    groundedAnswers: 0, refusalsRejected: 0, leftForHuman: 0, screeningAnswers: 0, disqualified: null, residual: [],
    costUsd: 0, submitAttemptsBlocked: 0, resumeAttached: false, submitted: false,
    submit: { ...EMPTY_SUBMIT_OUTCOME }, formInvalid: [], error: null,
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
    await installGuards(page, state, opts.allowSubmit === true)
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

    // Attach before measuring, so the résumé counts toward coverage like any
    // other required field.
    if (opts.resume) {
      r.resumeAttached = await attachResume(page, opts.resume)
    }

    const after = await page.evaluate(INSPECT) as InspectResult
    const unfilled = after.unfilledRequired

    // Abandon before spending anything if a REQUIRED field asks something the
    // user has declined to answer. The form can never be completed, so filling
    // the rest of it buys nothing — and with a nightly cap of five, the attempt
    // costs a real application rather than just a few seconds.
    for (const f of unfilled) {
      if (!f.label) continue
      if (await isSkippedQuestion({
        userId: opts.userId, question: f.label, company: opts.companyName,
      })) {
        r.disqualified = `requires a question you skipped: ${f.label.slice(0, 60)}`
        r.residual = unfilled.map((x) => ({ kind: x.kind, label: x.label, hasSelector: !!x.sel }))
        return r
      }
    }

    const answerable = unfilled.filter((f) => (f.kind === "text" || f.kind === "textarea") && f.sel)
    r.aiQuestions = answerable.length

    for (const f of answerable) {
      if (!f.sel) continue

      // Work authorization, sponsorship and immigration status are legal
      // declarations. They come from the profile or not at all — a model must
      // never be asked to infer them, and an ungrounded profile leaves the
      // field for the human rather than guessing.
      // Identity is a lookup, never an inference. Asking a model "what is your
      // name?" is how a refusal ended up in a Name field.
      const identity = identityAnswer(opts.profile, f.label)
      if (identity) {
        const ok = await page.evaluate(writeAnswerExpr(f.sel, identity)).catch(() => false)
        if (ok) r.groundedAnswers++
        else r.leftForHuman++
        continue
      }

      const authKind = classifyWorkAuthQuestion(f.label)
      if (authKind) {
        const grounded = answerWorkAuth(opts.profile, authKind)
        if (grounded) {
          const ok = await page.evaluate(writeAnswerExpr(f.sel, grounded.value)).catch(() => false)
          if (ok) r.groundedAnswers++
        } else {
          r.leftForHuman++
        }
        continue
      }

      // Location typeaheads look like plain text inputs but behave like
      // comboboxes: a typed value is not a selection, so the field reads empty
      // however correct the text is. Drive them through the menu instead.
      if (/\blocation\b|\bcity\b/i.test(f.label) && !/relocat/i.test(f.label)) {
        const loc = [opts.profile.city, opts.profile.state].filter(Boolean).join(", ")
        if (loc) {
          const ok = await selectComboNative(page, f.sel, loc)
            || await page.evaluate(selectComboOptionExpr(f.sel, loc)).catch(() => false)
            || await page.evaluate(writeAnswerExpr(f.sel, loc)).catch(() => false)
          if (ok) { r.groundedAnswers++; continue }
        }
      }

      // Rule-based answers: prior employment, how-did-you-hear, preferred
      // name, student status. Free, and they never reach the user as questions.
      const common = answerCommonQuestion(f.label, {
        profile: opts.profile, jobTitle: opts.jobTitle, employmentType: opts.employmentType,
        city: opts.profile.city, state: opts.profile.state,
        yearsOfExperience: opts.yearsOfExperience,
        salaryExpectationMin: opts.profile.salary_expectation_min,
      })
      if (common?.kind === "disqualify") {
        // Not a field we can fill — the whole form is handed back. Submitting
        // third parties' contact details without asking them is not ours to do.
        r.disqualified = common.reason
        break
      }
      if (common?.kind === "answer") {
        const ok = await page.evaluate(writeAnswerExpr(f.sel, common.value)).catch(() => false)
        if (ok) { r.groundedAnswers++; continue }
      }

      // A screening answer the user has already given beats anything a model
      // can infer, and costs nothing.
      const known = await getScreeningAnswer({
        userId: opts.userId, question: f.label, company: opts.companyName,
      })
      if (known) {
        const ok = await page.evaluate(writeAnswerExpr(f.sel, known)).catch(() => false)
        if (ok) { r.screeningAnswers++; continue }
      }

      if (!opts.anthropic) continue
      const { answer, costUsd } = await answerQuestion(
        opts.anthropic, f.label, opts.resumeContext,
        opts.jobTitle, opts.companyName, opts.userId, opts.runId,
      )
      r.costUsd += costUsd
      // A model that declines is talking to us, not to the employer. The audit
      // found "I cannot provide your name..." typed into a Name field; the
      // field is left blank instead.
      if (/^unknown$/i.test((answer ?? "").trim()) || !isUsableAnswer(answer)) {
        r.refusalsRejected++
        r.leftForHuman++
        // The model could not answer it either, so it goes on the list to ask
        // the user rather than being silently dropped.
        await recordUnansweredQuestion({
          userId: opts.userId, question: f.label, company: opts.companyName,
        })
        continue
      }
      const ok = await page.evaluate(writeAnswerExpr(f.sel, answer!)).catch(() => false)
      if (ok) r.aiWrittenBack++
    }

    // Required comboboxes: pick the option matching a grounded answer. Same
    // policy as text — identity and work authorization come from the profile,
    // never from a model.
    for (const raw of unfilled.filter((x) => x.kind === "combobox" && x.sel)) {
      // Prefer the id-derived label when the visible one does not classify:
      // Greenhouse's ids are stable where its labels are not.
      const byId = labelFromSelector(raw.sel)
      const f = byId && !EEO_LABEL.test(raw.label) && !SELF_ID_LABEL.test(raw.label)
        ? { ...raw, label: byId }
        : raw
      let want: string | null = identityAnswer(opts.profile, f.label)
      if (!want) {
        const kind = classifyWorkAuthQuestion(f.label)
        if (kind) want = answerWorkAuth(opts.profile, kind)?.value ?? null
      }
      if (!want) {
        const common = answerCommonQuestion(f.label, {
          profile: opts.profile, jobTitle: opts.jobTitle, employmentType: opts.employmentType,
          city: opts.profile.city, state: opts.profile.state,
          yearsOfExperience: opts.yearsOfExperience,
          salaryExpectationMin: opts.profile.salary_expectation_min,
        })
        if (common?.kind === "disqualify") { r.disqualified = common.reason; break }
        if (common?.kind === "answer") want = common.value
      }
      // EEO and self-identification: read what the control actually offers and
      // pick its own decline option. Guessing the wording ("Decline", "Prefer
      // not to say") failed against forms that say "I don't wish to answer" —
      // 20 of 25 remaining unfilled fields were this.
      if (!want && (EEO_LABEL.test(f.label) || SELF_ID_LABEL.test(f.label))) {
        const eeoOptions = await page.evaluate(readComboOptionsExpr(f.sel!)).catch(() => []) as string[]
        // The profile's own answer first — the user entered it deliberately, and
        // declining discards a choice they made. But the profile's wording rarely
        // matches the form's exactly ("Black or African American" against
        // "Black or African American (Not Hispanic or Latino)"), so match it
        // against the real options and fall back to declining when it does not
        // fit. Without the fallback a near-miss left the field empty, which is
        // worse than either answering or declining.
        const stated = eeoAnswer(opts.profile, f.label)
        const matched = stated
          ? eeoOptions.find((o) => o.toLowerCase() === stated.toLowerCase())
            ?? eeoOptions.find((o) => o.toLowerCase().includes(stated.toLowerCase()))
            ?? eeoOptions.find((o) => stated.toLowerCase().includes(o.toLowerCase()))
          : undefined
        const decline = eeoOptions.find((o) => DECLINE_OPTION.test(o))
        const choice = matched ?? decline
        if (choice) {
          const ok = await selectComboNative(page, f.sel!, choice)
            || await page.evaluate(selectComboOptionExpr(f.sel!, choice)).catch(() => false)
          if (ok) { if (matched) r.groundedAnswers++; else r.eeoDeclined++; continue }
        }
        want = choice ?? stated ?? "Decline"
      }
      if (!want) {
        const known = await getScreeningAnswer({
          userId: opts.userId, question: f.label, company: opts.companyName,
        })
        if (known) want = known
      }
      // Read the options once: the model needs them to choose, and the backlog
      // needs them to show the user the same choices the form offered.
      const options = !want
        ? await page.evaluate(readComboOptionsExpr(f.sel!)).catch(() => []) as string[]
        : []

      // Skill and experience questions are answerable from the résumé even
      // though they arrive as dropdowns.
      if (!want && opts.anthropic && options.length) {
        const picked = await chooseFromOptions(
          opts.anthropic, f.label, options, opts.resumeContext, opts.userId, opts.runId,
        )
        if (picked) {
          const ok = await selectComboNative(page, f.sel!, picked)
            || await page.evaluate(selectComboOptionExpr(f.sel!, picked)).catch(() => false)
          if (ok) { r.aiWrittenBack++; continue }
        }
      }

      if (!want) {
        await recordUnansweredQuestion({
          userId: opts.userId, question: f.label,
          company: opts.companyName, options,
        })
        r.leftForHuman++
        continue
      }
      const ok = await selectComboNative(page, f.sel!, want)
        || await page.evaluate(selectComboOptionExpr(f.sel!, want)).catch(() => false)
      if (ok) r.groundedAnswers++
      else r.leftForHuman++
    }

    // Native <select> controls were only ever handled for EEO decline, so 23 of
    // 85 unfilled required fields were dropdowns nobody drove — immigration
    // status, US residency, veteran and disability among them. They now go
    // through the same pipeline as everything else.
    for (const raw of unfilled.filter((x) => x.kind === "select" && x.sel)) {
      const byId = labelFromSelector(raw.sel)
      const f = byId && !EEO_LABEL.test(raw.label) && !SELF_ID_LABEL.test(raw.label)
        ? { ...raw, label: byId }
        : raw
      let want: string | null = identityAnswer(opts.profile, f.label)
      if (!want) {
        const kind = classifyWorkAuthQuestion(f.label)
        if (kind) want = answerWorkAuth(opts.profile, kind)?.value ?? null
      }
      if (!want) {
        const common = answerCommonQuestion(f.label, {
          profile: opts.profile, jobTitle: opts.jobTitle, employmentType: opts.employmentType,
          city: opts.profile.city, state: opts.profile.state,
          yearsOfExperience: opts.yearsOfExperience,
          salaryExpectationMin: opts.profile.salary_expectation_min,
        })
        if (common?.kind === "disqualify") { r.disqualified = common.reason; break }
        if (common?.kind === "answer") want = common.value
      }
      if (!want && (EEO_LABEL.test(f.label) || SELF_ID_LABEL.test(f.label))) {
        const eeoOptions = await page.evaluate(readNativeOptionsExpr(f.sel!)).catch(() => []) as string[]
        const stated = eeoAnswer(opts.profile, f.label)
        want = (stated
          ? eeoOptions.find((o) => o.toLowerCase() === stated.toLowerCase())
            ?? eeoOptions.find((o) => o.toLowerCase().includes(stated.toLowerCase()))
            ?? eeoOptions.find((o) => stated.toLowerCase().includes(o.toLowerCase()))
          : undefined)
          ?? eeoOptions.find((o) => DECLINE_OPTION.test(o))
          ?? "Decline"
      }
      if (!want) {
        want = await getScreeningAnswer({
          userId: opts.userId, question: f.label, company: opts.companyName,
        })
      }

      const options = await page.evaluate(readNativeOptionsExpr(f.sel!)).catch(() => []) as string[]
      if (!want && opts.anthropic && options.length) {
        want = await chooseFromOptions(
          opts.anthropic, f.label, options, opts.resumeContext, opts.userId, opts.runId,
        )
      }
      if (!want) {
        await recordUnansweredQuestion({
          userId: opts.userId, question: f.label, company: opts.companyName, options,
        })
        r.leftForHuman++
        continue
      }
      const ok = await page.evaluate(selectNativeOptionExpr(f.sel!, want)).catch(() => false)
      if (ok) r.groundedAnswers++
      else r.leftForHuman++
    }

    // A URL the site will reject blocks the whole submission, even in a field
    // nobody required. Clean those before asking the form for its verdict.
    await page.evaluate(SANITIZE_URL_FIELDS).catch(() => null)

    // Now ask the form. A dependent dropdown is the common case: BambooHR only
    // populates State once Country is set, and Country sits AFTER State in the
    // DOM, so the first pass fills a list that is still empty. One more pass,
    // driven by what the form says is wrong rather than by our own bookkeeping,
    // catches that and anything else the fill silently failed to commit.
    let validity = await page.evaluate(FORM_VALIDITY).catch(() => null) as FormValidity | null
    if (validity?.invalid.length) {
      for (const bad of validity.invalid) {
        if (!bad.sel || bad.kind !== "select") continue
        // An empty option list does not mean "no choices" — MUI and friends
        // render theirs only once the widget is opened, so the native element
        // holds a single blank option and every text-matching attempt fails.
        // Reading through the combobox path is what actually sees them.
        let options = await page.evaluate(readNativeOptionsExpr(bad.sel)).catch(() => []) as string[]
        const widget = options.length === 0
        if (widget) {
          options = await page.evaluate(readComboOptionsExpr(bad.sel)).catch(() => []) as string[]
          if (!options.length) options = await readComboOptionsNative(page, bad.sel)
        }
        let want: string | null =
          identityAnswer(opts.profile, bad.label) ?? locationAnswer(opts.profile, bad.label)
        if (!want && opts.anthropic && options.length) {
          want = await chooseFromOptions(
            opts.anthropic, bad.label, options, opts.resumeContext, opts.userId, opts.runId,
          )
        }
        // Say it the way the menu says it. A profile holding "TX" against a
        // list offering "Texas" is an answer we have, not one we lack.
        if (want && options.length) want = matchOption(want, options) ?? want
        if (!want) continue
        const set = widget
          ? false
          : await page.evaluate(selectNativeOptionExpr(bad.sel, want)).catch(() => false)
        // Real clicks through the popup are the only thing a framework-managed
        // select registers; setting the hidden mirror's value satisfies the
        // browser while the framework's own state stays empty, which is exactly
        // how a form passed checkValidity and still refused on submit.
        // Try every spelling of the answer against the widget itself. The option
        // list we can READ is truncated and virtualised — it stops around
        // "Georgia" on a state menu — but the widget can still be asked for
        // "Texas" by name, so a readable list is the wrong thing to constrain to.
        let viaWidget = set
        if (!viaWidget) {
          for (const alias of usStateAliases(want)) {
            viaWidget = await selectComboNative(page, bad.sel, alias).catch(() => false)
            if (viaWidget) break
          }
        }
      }
      await page.waitForTimeout(400)
      validity = await page.evaluate(FORM_VALIDITY).catch(() => null) as FormValidity | null
    }
    r.formInvalid = (validity?.invalid ?? []).map((f) => ({ label: f.label, message: f.message }))

    await page.waitForTimeout(400)
    const final = await page.evaluate(INSPECT) as InspectResult
    r.requiredTotal = final.requiredTotal
    r.requiredFilled = final.requiredFilled
    // A form with no detectable required fields is UNMEASURED, not complete.
    // Scoring 0/0 as 1 reported barely-filled JazzHR forms as fully covered.
    r.requiredRate = final.requiredTotal > 0 ? final.requiredFilled / final.requiredTotal : 0
    r.submitAttemptsBlocked = (final.blockedSubmits ?? 0) + state.blocked
    r.residual = final.unfilledRequired.map((f) => ({
      kind: f.kind, label: f.label, hasSelector: !!f.sel,
    }))
    // "ok" means the form could be submitted, not that it was.
    // A disqualified form can never be submitted, however complete it looks.
    r.ok = r.requiredRate >= 1 && !r.disqualified

    // Two conditions, both required. Submitting a partially filled application
    // is worse than not applying at all: it reaches a real employer under the
    // user's name and cannot be withdrawn.
    // Three conditions now, not two. Clicking submit on a form the browser has
    // already marked invalid cannot succeed, and burns the posting: the ledger
    // row it writes excludes the job from every future run.
    if (opts.allowSubmit === true && r.ok && r.formInvalid.length === 0) {
      r.submit = await submitForm(page)
      r.submitted = r.submit.confirmed
    } else if (opts.allowSubmit === true && r.ok) {
      r.error = `form_invalid: ${r.formInvalid.map((f) => f.label || "?").join(", ").slice(0, 180)}`
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message.slice(0, 200) : String(err)
  } finally {
    await ctx.close().catch(() => {})
    if (ownBrowser) await browser.close().catch(() => {})
  }
  return r
}
