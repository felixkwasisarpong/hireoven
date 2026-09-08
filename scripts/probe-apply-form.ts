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
    // --set "<label substring>=<option text>" (repeatable) drives a control the
    // way the runner does, then reports what the page did with it. This is how
    // you tell a value the browser accepted from one the site's own framework
    // registered — the distinction that decides whether a submit can succeed.
    const sets = process.argv.slice(3).filter((a) => a.startsWith("--set="))
    for (const raw of sets) {
      const [label, want] = raw.slice("--set=".length).split("=")
      const result = await page.evaluate(`(() => {
        const LABEL = ${JSON.stringify(label)}.toLowerCase(), WANT = ${JSON.stringify(want)}.toLowerCase();
        const labelOf = (el) => {
          let t = "";
          if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = l.textContent || ""; }
          if (!t) { const l = el.closest("label"); if (l) t = l.textContent || ""; }
          if (!t) { const b = el.closest('[class*="field" i],[class*="form" i]'); const h = b && b.querySelector("label"); if (h) t = h.textContent || ""; }
          return (t || "").replace(/\s+/g, " ").trim();
        };
        const el = Array.from(document.querySelectorAll("select, input, textarea"))
          .find((c) => labelOf(c).toLowerCase().indexOf(LABEL) !== -1);
        if (!el) return { found: false };
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
        let applied = false;
        if (el.tagName.toLowerCase() === "select") {
          const opts = Array.from(el.options).filter((o) => o.value !== "");
          const m = opts.find((o) => norm(o.textContent).toLowerCase() === WANT)
                || opts.find((o) => norm(o.textContent).toLowerCase().indexOf(WANT) !== -1);
          if (m) {
            const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
            if (d && d.set) d.set.call(el, m.value); else el.value = m.value;
            ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
            applied = true;
          }
        }
        const wrapper = el.closest('[class*="FormControl" i],[class*="field" i]');
        return {
          found: true,
          applied,
          optionCount: el.options ? el.options.length : null,
          nativeValue: (el.value || ""),
          checkValidity: typeof el.checkValidity === "function" ? el.checkValidity() : null,
          // What a human sees. If this stays on the placeholder while
          // nativeValue is set, the framework never registered the change.
          renderedText: wrapper ? (wrapper.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : null,
        };
      })()`).catch((e) => ({ error: String(e).slice(0, 200) }))
      console.log(`[set] ${label} = ${want} ->`, JSON.stringify(result))
      await page.waitForTimeout(1500)
    }

    // --listbox="<label substring>" opens a widget the way a person would and
    // reports what the popup offers. A native <select> holding one blank option
    // is not an empty field; its choices simply do not exist until it is opened.
    for (const raw of process.argv.slice(3).filter((a) => a.startsWith("--listbox="))) {
      const label = raw.slice("--listbox=".length).toLowerCase()
      const sel = await page.evaluate(`(() => {
        const labelOf = (el) => {
          let t = "";
          if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = l.textContent || ""; }
          if (!t) { const b = el.closest('[class*="field" i],[class*="form" i]'); const h = b && b.querySelector("label"); if (h) t = h.textContent || ""; }
          return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
        };
        const el = Array.from(document.querySelectorAll("select, input"))
          .find((c) => labelOf(c).indexOf(${JSON.stringify(label)}) !== -1);
        return el && el.id ? "#" + el.id : null;
      })()`) as string | null
      if (!sel) { console.log(`[listbox] ${label}: control not found`); continue }
      // What does a person actually click? The native element may be a hidden
      // mirror, in which case the real widget is a sibling inside the wrapper.
      const shapeExpr = "(() => {" +
        "const el = document.querySelector(" + JSON.stringify(sel) + ");" +
        "if (!el) return null;" +
        "const st = getComputedStyle(el), r = el.getBoundingClientRect();" +
        "const wrap = el.closest('[class*=\"FormControl\" i],[class*=\"field\" i]');" +
        "const clickable = wrap ? Array.from(wrap.querySelectorAll('[role=\"combobox\"],[role=\"button\"],button,[class*=\"select\" i]'))" +
        ".filter(function (n) { var rr = n.getBoundingClientRect(); return rr.width > 0 && rr.height > 0; })" +
        ".slice(0, 4).map(function (n) { return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '[role=' + (n.getAttribute('role') || '-') + '][class=' + String(n.className || '').slice(0, 44) + ']'; }) : [];" +
        "return { nativeVisible: r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'," +
        " nativeSize: Math.round(r.width) + 'x' + Math.round(r.height), nativeOpacity: st.opacity, clickableInWrapper: clickable };" +
        "})()"
      const shape = await page.evaluate(shapeExpr).catch((e) => ({ error: String(e).slice(0, 120) }))
      console.log(`[shape] ${label}:`, JSON.stringify(shape))
      // Click what a person clicks. When the native element is a 0x0 mirror the
      // widget lives beside it, and clicking the mirror opens nothing at all.
      const nativeHidden = await page.locator(sel).first().isVisible().catch(() => false)
      const control = nativeHidden
        ? page.locator(sel).first()
        : page.locator(sel).first().locator(
            'xpath=ancestor::*[contains(@class,"FormControl") or contains(@class,"field")][1]',
          ).locator('button, [role="combobox"], [class*="Toggle"]').first()
      await control.click({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(1_200)
      const opts = page.locator('[role="option"], [class*="option" i]:visible')
      const n = Math.min(await opts.count().catch(() => 0), 60)
      const texts: string[] = []
      for (let i = 0; i < n; i++) {
        const t = ((await opts.nth(i).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim()
        if (t) texts.push(t)
      }
      console.log(`[listbox] ${label} (${sel}): ${n} option(s) -> ${JSON.stringify(texts.slice(0, 12))}`)
      await page.keyboard.press("Escape").catch(() => {})
      await page.waitForTimeout(400)
    }

    // --pick="<label>=<option>" drives the widget the way the runner now does
    // and reports what the page ends up believing: the native mirror's value,
    // the browser's verdict, and what a person sees. Those three can disagree.
    for (const raw of process.argv.slice(3).filter((a) => a.startsWith("--pick="))) {
      const [label, want] = raw.slice("--pick=".length).split("=")
      const sel = await page.evaluate(`(() => {
        const labelOf = (el) => {
          let t = "";
          if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = l.textContent || ""; }
          if (!t) { const b = el.closest('[class*="field" i],[class*="form" i]'); const h = b && b.querySelector("label"); if (h) t = h.textContent || ""; }
          return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
        };
        const el = Array.from(document.querySelectorAll("select, input"))
          .find((c) => labelOf(c).indexOf(${JSON.stringify(label.toLowerCase())}) !== -1);
        if (!el) return null;
        const nm = el.getAttribute("name");
        return nm ? el.tagName.toLowerCase() + '[name="' + nm + '"]' : (el.id ? "#" + el.id : null);
      })()`) as string | null
      if (!sel) { console.log(`[pick] ${label}: not found`); continue }
      console.log(`[pick] using selector ${sel}`)

      const native = page.locator(sel).first()
      const nativeVisible = await native.isVisible().catch(() => false)
      const control = nativeVisible ? native : native.locator(
        'xpath=ancestor::*[contains(@class,"FormControl") or contains(@class,"field")][1]',
      ).locator('button, [role="combobox"], [class*="Toggle"]').first()
      await control.click({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(900)

      // Locate the option instead of walking the list. A state menu is long
      // enough that any enumeration cap stops around "Arizona", and the list may
      // be virtualised, so the wanted node might not exist until it is asked for.
      const exact = new RegExp(`^\\s*${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i")
      const match = page.locator('[role="option"], [class*="option" i]').filter({ hasText: exact }).first()
      let picked = false
      if (await match.count().catch(() => 0)) {
        await match.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {})
        await match.click({ timeout: 5_000 }).catch(() => {})
        picked = true
      }
      await page.waitForTimeout(900)

      const after = await page.evaluate("(() => {" +
        "const el = document.querySelector(" + JSON.stringify(sel) + ");" +
        "if (!el) return null;" +
        "const wrap = el.closest('[class*=\"FormControl\" i],[class*=\"field\" i]');" +
        "return { nativeValue: el.value || '', checkValidity: el.checkValidity ? el.checkValidity() : null," +
        " rendered: wrap ? (wrap.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null };" +
        "})()").catch((e) => ({ error: String(e).slice(0, 120) }))
      console.log(`[pick] ${label}=${want} picked=${picked} ->`, JSON.stringify(after))
    }

    const fields = await page.evaluate(FIELD_DUMP)
    if (!sets.length && !process.argv.some((a) => a.startsWith("--listbox=") || a.startsWith("--pick="))) {
      console.log(JSON.stringify(fields, null, 1))
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
