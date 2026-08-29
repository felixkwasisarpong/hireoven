/**
 * Pre-launch quality audit: show exactly what auto-apply would put in front of
 * an employer.
 *
 * Every other measurement in this project counted whether fields ended up
 * non-empty. None of them looked at what was actually written. Those are very
 * different claims, and only the second one decides whether this is safe to
 * turn on: a form can score 100% required coverage while telling a clinic the
 * applicant is a licensed physical therapist.
 *
 * This fills real postings with the user's real profile and résumé, then prints
 * every label/value pair, flagging which answers came from the model. Nothing is
 * submitted — the request router arms as soon as a form is found and aborts
 * every non-GET, submit paths are stubbed in-page, and nothing outside an
 * apply-CTA allowlist is clicked.
 *
 *   npx tsx scripts/audit-fill-quality.ts --user <uuid> --limit 20
 *
 * Requires the prod DB tunnel: ./scripts/db-tunnel.sh --daemon
 */

import { chromium, type Page } from "playwright"
import Anthropic from "@anthropic-ai/sdk"
import { writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { getPostgresPool } from "../lib/postgres/server"
import { getAutoApplyCandidates } from "../lib/apex/auto-apply/candidates"
import { generateFillScript } from "../lib/autofill"
import { formatResumeContext } from "../lib/autofill/resume-context"
import { HAIKU_MODEL } from "../lib/ai/anthropic-models"
import {
  isAnswered, isUsableAnswer, classifyWorkAuthQuestion, answerWorkAuth, identityAnswer,
} from "../lib/autofill/answer-policy"
import type { AutofillProfile } from "../types"

const SETTLE_MS = 2_500
const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
const NEVER_CLICK = /submit|send|finish|complete|confirm|agree|accept/i

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** Read back every visible control with its label and current value. */
const DUMP = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none"; };
  const ctrls = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const t = (el.getAttribute("type")||"").toLowerCase();
    if (["hidden","submit","button","image","reset"].indexOf(t) !== -1) return false;
    return vis(el); });
  const labelFor = (el) => {
    const id = el.getAttribute("id");
    const bf = id ? document.querySelector('label[for="' + (window.CSS&&CSS.escape?CSS.escape(id):id) + '"]') : null;
    const wr = el.closest("label");
    const t = (bf&&bf.textContent)||(wr&&wr.textContent)||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"";
    return t.replace(/\\s+/g," ").trim(); };
  const valueOf = (el) => {
    if ((el.value||"").trim()) return el.value.trim();
    const w = el.closest('[class*="control" i]') || el.parentElement;
    if (w) {
      const sv = w.querySelector('[class*="singleValue" i], [class*="single-value" i]');
      if (sv && (sv.textContent||"").trim()) return sv.textContent.trim();
    }
    return ""; };
  return ctrls.map((el) => ({
    label: labelFor(el).slice(0, 90),
    value: valueOf(el).slice(0, 400),
    kind: el.tagName.toLowerCase() === "textarea" ? "textarea"
        : el.getAttribute("role") === "combobox" ? "combobox"
        : (el.getAttribute("type")||"text").toLowerCase(),
    required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
  })).filter((f) => f.label);
})()`

const ANSWER_INSTRUCTIONS = `You help a job applicant answer application-form questions. Answer as the applicant, first person. Match the answer length to the question. Return ONLY the answer text — no preamble, no quotes, no explanation.
- Yes/No → just "Yes" or "No".
- Numeric → the number with a unit.
- Open-ended → 2-4 sentences grounded in the résumé.
HARD FACTS (work authorization, sponsorship, citizenship, clearance, licences, criminal history) come from the profile only — never guess.
Never fabricate an employer, credential, tool, or metric that is not in the résumé.`

async function revealForm(page: Page) {
  for (const el of await page.$$("a, button, [role=button]")) {
    const label = ((await el.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim()
    if (!label || label.length > 32 || NEVER_CLICK.test(label) || !APPLY_CTA.test(label)) continue
    if (!(await el.isVisible().catch(() => false))) continue
    await el.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS).catch(() => {})
    return
  }
}

async function main() {
  const userId = arg("user")
  if (!userId) throw new Error("--user <uuid> is required")
  const limit = Number.parseInt(arg("limit", "20"), 10)
  const out = arg("out", "fill-audit.json")

  const pool = getPostgresPool()
  const { rows: pr } = await pool.query<AutofillProfile>(
    `SELECT * FROM autofill_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId])
  const profile = pr[0]
  if (!profile) throw new Error("no autofill profile for that user")

  const { rows: rr } = await pool.query(
    `SELECT summary, primary_role, top_skills, work_experience, education,
            projects, years_of_experience, raw_text
       FROM resumes WHERE user_id = $1 ORDER BY is_primary DESC, updated_at DESC LIMIT 1`, [userId])
  const resumeContext = rr[0] ? formatResumeContext(rr[0] as never) : ""
  if (!resumeContext) throw new Error("no resume for that user")

  const candidates = await getAutoApplyCandidates(userId, { minMatchScore: 70, limit })
  console.log(`auditing ${candidates.length} postings with the REAL profile\n`)

  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null
  const browser = await chromium.launch({ headless: true })
  const report: unknown[] = []

  for (const job of candidates) {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    })
    const state = { armed: false }
    try {
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        const native = HTMLFormElement.prototype.submit
        HTMLFormElement.prototype.submit = function () { void native }
        document.addEventListener("submit", (e) => {
          e.preventDefault(); e.stopImmediatePropagation()
        }, true)
      })
      await page.route("**/*", (r) => {
        const m = r.request().method()
        if (!state.armed || m === "GET" || m === "HEAD") return r.continue()
        return r.abort("blockedbyclient")
      })

      await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      await page.waitForTimeout(SETTLE_MS)
      let fields = await page.evaluate(DUMP) as { label: string; value: string; kind: string; required: boolean }[]
      if (fields.length < 3) { await revealForm(page); fields = await page.evaluate(DUMP) as typeof fields }
      if (fields.length < 3) { console.log(`  (no form)  ${job.companyName}`); continue }

      state.armed = true
      const { script } = generateFillScript(profile, job.ats)
      await page.evaluate(script).catch(() => null)
      await page.waitForTimeout(700)

      const afterDeterministic = await page.evaluate(DUMP) as typeof fields
      const aiAnswers: { label: string; answer: string }[] = []

      // Answer the required free-text gaps exactly as the worker would.
      const grounded: { label: string; answer: string }[] = []
      const leftBlank: string[] = []
      for (const f of afterDeterministic) {
        // Only required fields, and a sentinel counts as still-unanswered.
        if (!f.required || isAnswered(f.value)) continue

        const identity = identityAnswer(profile, f.label)
        if (identity) { grounded.push({ label: f.label, answer: identity }); continue }

        const authKind = classifyWorkAuthQuestion(f.label)
        if (authKind) {
          const g = answerWorkAuth(profile, authKind)
          if (g) grounded.push({ label: f.label, answer: g.value })
          else leftBlank.push(f.label)
          continue
        }
        if (f.kind !== "text" && f.kind !== "textarea") continue
        if (!anthropic) break
        const msg = await anthropic.messages.create({
          model: HAIKU_MODEL, max_tokens: 300,
          system: [
            { type: "text", text: ANSWER_INSTRUCTIONS },
            { type: "text", text: `APPLICANT RÉSUMÉ:\n${resumeContext}`, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: `Applying for: ${job.title} at ${job.companyName}\n\nQuestion: "${f.label}"\n\nWrite the answer.` }],
        }).catch(() => null)
        const answer = msg?.content.filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text).join("").trim() ?? ""
        if (!isUsableAnswer(answer)) { leftBlank.push(f.label); continue }
        aiAnswers.push({ label: f.label, answer })
      }

      report.push({
        company: job.companyName, title: job.title, ats: job.ats,
        applyUrl: job.applyUrl, matchScore: job.matchScore,
        deterministic: afterDeterministic.filter((f) => isAnswered(f.value))
          .map((f) => ({ label: f.label, value: f.value })),
        grounded,
        aiAnswers,
        leftBlank,
        sentinels: afterDeterministic.filter((f) => f.value && !isAnswered(f.value))
          .map((f) => ({ label: f.label, value: f.value })),
      })
      console.log(`  ok  ${(job.companyName ?? "").slice(0, 26).padEnd(28)} ${afterDeterministic.filter((f) => isAnswered(f.value)).length} filled, ${grounded.length} grounded, ${aiAnswers.length} AI, ${leftBlank.length} left blank`)
    } catch (e) {
      console.log(`  ERR ${job.companyName}: ${(e as Error).message.slice(0, 80)}`)
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  await browser.close()
  await pool.end()
  writeFileSync(out, JSON.stringify({ runId: randomUUID(), report }, null, 2))
  console.log(`\nwrote ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
