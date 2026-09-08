/**
 * Dump the form controls on an application page, read-only.
 *
 *   npx tsx scripts/probe-apply-form.ts <apply-url>
 *
 * Nothing is filled, clicked, or submitted. This exists because a failed
 * submission is nearly impossible to diagnose from the ledger alone: the run
 * reports its own belief about coverage, and when that belief is wrong the only
 * way to find out is to look at the real control.
 */

import { chromium } from "playwright"

const FIELD_DUMP = `(() => {
  const ctrls = Array.from(document.querySelectorAll("input, textarea, select"));
  return ctrls.map((el) => {
    const tag = el.tagName.toLowerCase();
    let label = "";
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) label = l.textContent || "";
    }
    if (!label) { const l = el.closest("label"); if (l) label = l.textContent || ""; }
    if (!label) {
      const box = el.closest('[class*="field" i],[class*="form" i],[class*="question" i]');
      const h = box && box.querySelector("label");
      if (h) label = h.textContent || "";
    }
    return {
      tag,
      type: (el.getAttribute("type") || "").toLowerCase(),
      name: el.getAttribute("name") || "",
      id: el.id || "",
      required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
      label: (label || "").replace(/\\s+/g, " ").trim().slice(0, 70),
      value: (el.value || "").slice(0, 40),
      // Why the runner's hasValue() believes this control is answered. The
      // widget fallbacks it uses are the part that misfires, so show what they
      // would actually see.
      hasValueProbe: (() => {
        const w = el.closest('[class*="control" i]') || el.parentElement;
        const sv = w && w.querySelector('[class*="singleValue" i],[class*="single-value" i],[class*="multiValue" i]');
        const hidden = w ? Array.from(w.querySelectorAll('input[type="hidden"]')).map((h) => (h.getAttribute("name") || "?") + "=" + JSON.stringify(h.value || "")) : [];
        return {
          ownValue: (el.value || "").trim(),
          wrapperClass: w && w.className ? String(w.className).slice(0, 60) : null,
          wrapperTag: w ? w.tagName.toLowerCase() : null,
          siblingSingleValue: sv ? (sv.textContent || "").trim().slice(0, 40) : null,
          hiddenInputsInWrapper: hidden.slice(0, 5),
        };
      })(),
      options: tag === "select"
        ? Array.from(el.options).slice(0, 5).map((o) => ({
            text: (o.textContent || "").replace(/\\s+/g, " ").trim(),
            value: o.value,
          }))
        : undefined,
    };
  }).filter((f) => f.label || f.name);
})()`

async function main() {
  const url = process.argv[2]
  if (!url) throw new Error("usage: probe-apply-form.ts <apply-url>")

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await page.waitForTimeout(4_000)

    // Most ATS keep the form behind an apply CTA, so a bare page load shows the
    // posting and no controls at all. Same allowlist the runner uses — nothing
    // matching submit/send/finish is ever clicked here.
    const APPLY_CTA = /^(apply|apply now|apply for this job|apply to this job|apply here|start application|i'?m interested)$/i
    for (const el of await page.$$("button, a, [role=button], input[type=submit]")) {
      const label = (((await el.textContent().catch(() => "")) ?? "") ||
        ((await el.getAttribute("value").catch(() => "")) ?? "")).replace(/\s+/g, " ").trim()
      if (!label || label.length > 32 || !APPLY_CTA.test(label)) continue
      if (!(await el.isVisible().catch(() => false))) continue
      console.error(`[probe] clicked apply CTA: ${JSON.stringify(label)}`)
      await el.click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(4_000)
      break
    }
    const fields = await page.evaluate(FIELD_DUMP)
    console.log(JSON.stringify(fields, null, 1))
  } finally {
    await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
