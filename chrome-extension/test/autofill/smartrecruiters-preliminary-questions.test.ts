// @vitest-environment jsdom
/**
 * Regression: SmartRecruiters multi-step "Preliminary questions" page
 * (Pilot Company Cashier). A question-only step — zero classic profile
 * fields. Verifies the question tier answers what it should and leaves
 * alone what it must.
 */
import { describe, expect, it } from "vitest"
import { fillRequiredAtsFields } from "../../src/autofill/ashby-autofill"
import type { SafeProfile } from "../../src/autofill/safe-fields"

const PAGE = `
<form><ul>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Are you under the age of 18?<span class="required">✱</span></div></div>
    <div class="application-field"><ul>
      <li><label><input type="radio" name="q[age]" value="Yes" required><span>Yes</span></label></li>
      <li><label><input type="radio" name="q[age]" value="No" required><span>No</span></label></li>
    </ul></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Are you looking for Full-Time or Part-Time work?<span class="required">✱</span></div></div>
    <div class="application-field"><select name="q[ftpt]" required>
      <option value=""></option><option value="ft">Full-Time</option><option value="pt">Part-Time</option>
    </select></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">What is your minimum expected pay?<span class="required">✱</span></div></div>
    <div class="application-field"><input type="text" name="q[pay]" required></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">When can you start work?<span class="required">✱</span></div></div>
    <div class="application-field"><input type="text" name="q[start]" required></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Have you previously been employed by Pilot, Flying J, or any other Pilot affiliates?<span class="required">✱</span></div></div>
    <div class="application-field"><ul>
      <li><label><input type="radio" name="q[prev]" value="Yes" required><span>Yes</span></label></li>
      <li><label><input type="radio" name="q[prev]" value="No" required><span>No</span></label></li>
    </ul></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">If yes, please list where you previously, your position, and when you departed.</div></div>
    <div class="application-field"><textarea name="q[prevDetail]"></textarea></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Select all - by selecting all, you acknowledge the terms below</div></div>
    <div class="application-field"><ul>
      <li><label><input type="checkbox" name="q[ack]" value="a1"><span>I can perform essential job functions</span></label></li>
      <li><label><input type="checkbox" name="q[ack]" value="a2"><span>I agree to a background check</span></label></li>
      <li><label><input type="checkbox" name="q[ack]" value="a3"><span>The information provided is accurate</span></label></li>
    </ul></div>
  </div></li>
</ul></form>`

describe("SmartRecruiters Preliminary questions step", () => {
  it("answers eligibility/logistics questions, ticks acknowledge-all, leaves conditionals blank", async () => {
    document.body.innerHTML = PAGE
    const profile: SafeProfile = {
      first_name: "Felix",
      email: "f@x.com",
      salary_expectation_min: 18,
      salary_expectation_max: 22,
      earliest_start_date: null, // → "Immediately" default
      // Dashboard "Common questions" saved answer — must beat heuristics:
      custom_answers: [{ question_pattern: "minimum expected pay", answer: "20" }],
    }
    const aiSeen: string[] = []
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => {
        aiSeen.push(...qs.map((q) => q.label))
        return qs.map((q) => ({
          id: q.id,
          value: /full-time or part-time/i.test(q.label)
            ? "Full-Time"
            : /previously been employed/i.test(q.label)
              ? "no"
              : null,
          confidence: "high" as const,
        }))
      },
    })

    const checked = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
    const val = (name: string) =>
      document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!.value

    // Deterministic client-side answers (the server strips "age" questions):
    expect(checked("q[age]")?.value).toBe("No")
    // User's saved custom answer (20) beats the salary heuristic (22):
    expect(val("q[pay]")).toBe("20")
    expect(val("q[start]")).toBe("Immediately")
    // Acknowledge-all consent block: every box ticked
    expect(document.querySelectorAll('input[name="q[ack]"]:checked').length).toBe(3)
    // AI-tier answers (FT/PT select, previous-employment radio):
    expect(val("q[ftpt]")).toBe("ft")
    expect(checked("q[prev]")?.value).toBe("No")
    // Conditional follow-up stays blank and never reaches the AI:
    expect(val("q[prevDetail]")).toBe("")
    expect(aiSeen.join(" | ")).not.toMatch(/if yes/i)
  })

  it("answers spl-radio custom-element questions (no native inputs at all)", async () => {
    // Real markup shape from jobs.smartrecruiters.com /screening: the radios
    // are <spl-radio role="radio" label="Yes"> web components — zero <input>
    // elements — inside an <sr-question-field-radio> wrapper whose CLASS is
    // empty (the role is in the tag name).
    document.body.innerHTML = `
<div class="form-section">
  <sr-question-field-radio>
    <p>Are you under the age of 18?</p>
    <spl-radio-group role="radiogroup">
      <spl-radio role="radio" label="Yes" value="1" aria-checked="false"></spl-radio>
      <spl-radio role="radio" label="No" value="0" aria-checked="false"></spl-radio>
    </spl-radio-group>
  </sr-question-field-radio>
</div>`
    // Simulate the component's own click behavior (toggles aria-checked).
    for (const r of document.querySelectorAll("spl-radio")) {
      r.addEventListener("click", () => r.setAttribute("aria-checked", "true"))
    }
    const profile: SafeProfile = { first_name: "Felix", email: "f@x.com" }
    const summary = await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    const no = document.querySelector('spl-radio[label="No"]')!
    const yes = document.querySelector('spl-radio[label="Yes"]')!
    expect(no.getAttribute("aria-checked")).toBe("true")
    expect(yes.getAttribute("aria-checked")).toBe("false")
    expect(summary.filledCount).toBeGreaterThanOrEqual(1)
  })

  it("drives spl-autocomplete typeaheads: deep-nested input, decoy form-field wrapper, aria-controls menu", async () => {
    // Real anatomy from /screening: the combobox input is buried under
    // several wrapper divs AND an <spl-internal-form-field> — whose tag
    // matches /form-field/ but holds NO question text (the question is a
    // sibling <p> many levels up). Row resolution must skip the decoy and
    // climb to <sr-question-field-select>. The menu with
    // <spl-select-option> lives in a separate tree via aria-controls.
    document.body.innerHTML = `
<div class="form-section">
  <sr-question-field-select>
    <p>Are you looking for Full-Time or Part-Time work?</p>
    <spl-dropdown class="c-spl-autocomplete-dropdown"><div class="c-spl-autocomplete-trigger">
      <spl-autocomplete id="question_ftpt"></spl-autocomplete>
    </div></spl-dropdown>
  </sr-question-field-select>
  <div id="menu-question_ftpt"></div>
</div>`
    const host = document.querySelector("spl-autocomplete")!
    const shadow = host.attachShadow({ mode: "open" })
    // "Value is required" = inline validation text inside the decoy wrapper —
    // must NOT be mistaken for the question label.
    shadow.innerHTML = `<spl-internal-form-field><div class="c-spl-input-grid"><div class="c-spl-input-wrapper"></div><span class="error">Value is required</span></div></spl-internal-form-field>`
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("role", "combobox")
    input.setAttribute("aria-controls", "menu-question_ftpt")
    shadow.querySelector(".c-spl-input-wrapper")!.appendChild(input)
    const menu = document.getElementById("menu-question_ftpt")!
    for (const text of ["Full-Time (30+ hours per week)", "Part-Time (less than 30 hours per week)"]) {
      const opt = document.createElement("spl-select-option")
      opt.textContent = text
      // Simulate the component: clicking an option commits it to the input.
      opt.addEventListener("click", () => { input.value = text })
      menu.appendChild(opt)
    }

    const profile: SafeProfile = { first_name: "Felix", email: "f@x.com", preferred_work_type: null }
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) =>
        qs.map((q) => ({
          id: q.id,
          value: /full-time or part-time/i.test(q.label) ? "Full-Time" : null,
          confidence: "high" as const,
        })),
    })
    expect(input.value).toBe("Full-Time (30+ hours per week)")
  })

  it("fills EEO typeaheads labeled ONLY by placeholder (Gender) when opted in", async () => {
    document.body.innerHTML = `
<div class="form-section">
  <sr-question-field-select>
    <spl-autocomplete id="q_gender"></spl-autocomplete>
  </sr-question-field-select>
  <div id="menu-q_gender"></div>
</div>`
    const host = document.querySelector("spl-autocomplete")!
    const shadow = host.attachShadow({ mode: "open" })
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("role", "combobox")
    input.setAttribute("placeholder", "Gender")
    input.setAttribute("aria-controls", "menu-q_gender")
    shadow.appendChild(input)
    const menu = document.getElementById("menu-q_gender")!
    for (const text of ["Male", "Female", "Decline to self-identify"]) {
      const opt = document.createElement("spl-select-option")
      opt.textContent = text
      opt.addEventListener("click", () => { input.value = text })
      menu.appendChild(opt)
    }
    const profile: SafeProfile = {
      first_name: "Felix",
      email: "f@x.com",
      auto_fill_diversity: true,
      gender: "Male",
    }
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    expect(input.value).toBe("Male")
  })

  it("opens on ArrowDown and only counts a CLOSED menu as committed (live spl-autocomplete)", async () => {
    // Faithful to jobs.smartrecruiters.com /screening: the menu is EMPTY until an
    // ArrowDown keydown opens it (pointer clicks do nothing, minquerylength=0), and
    // the input holds unconfirmed query text with aria-expanded="true" until an
    // option is committed. A filler that treats typed text as "done" leaves the
    // field empty → "Value is required".
    document.body.innerHTML = `
<div class="form-section">
  <sr-question-field-select>
    <p>Are you looking for Full-Time or Part-Time work?</p>
    <spl-autocomplete id="q_ftpt"></spl-autocomplete>
  </sr-question-field-select>
  <div id="menu-q_ftpt"></div>
</div>`
    const host = document.querySelector("spl-autocomplete")!
    const shadow = host.attachShadow({ mode: "open" })
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("role", "combobox")
    input.setAttribute("aria-controls", "menu-q_ftpt")
    input.setAttribute("aria-expanded", "false")
    shadow.appendChild(input)
    const menu = document.getElementById("menu-q_ftpt")!
    const labels = ["Full-Time (30+ hours per week)", "Part-Time (Under 30 hours per week)", "Either"]

    const renderOptions = () => {
      if (menu.childElementCount) return
      input.setAttribute("aria-expanded", "true")
      for (const text of labels) {
        const opt = document.createElement("spl-select-option")
        opt.textContent = text
        // Commit ONLY closes the menu + sets the canonical value.
        opt.addEventListener("click", () => {
          input.value = text
          input.setAttribute("aria-expanded", "false")
        })
        menu.appendChild(opt)
      }
    }
    // Pointer does nothing; only ArrowDown reveals options.
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "ArrowDown") renderOptions()
    })

    const profile: SafeProfile = { first_name: "Felix", email: "f@x.com", preferred_work_type: null }
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    // Committed a real option and the menu closed — not stranded on query text.
    expect(labels).toContain(input.value)
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("defaults EEO Gender to 'Prefer not to answer' when diversity is OFF, clicking the option's deepest leaf", async () => {
    // Required EEO combobox with NO auto_fill_diversity: must decline (fill
    // "Prefer not to answer") rather than skip — otherwise the required field
    // blocks submit. The commit listener lives on the option's INNER leaf (a
    // nested <spl-truncate>), not the wrapper, mirroring the real widget where a
    // wrapper click never commits.
    document.body.innerHTML = `
<div class="form-section">
  <sr-question-field-eeo>
    <spl-autocomplete id="q_gender"></spl-autocomplete>
  </sr-question-field-eeo>
  <div id="menu-q_gender"></div>
</div>`
    const host = document.querySelector("spl-autocomplete")!
    const shadow = host.attachShadow({ mode: "open" })
    const input = document.createElement("input")
    input.type = "text"
    input.setAttribute("role", "combobox")
    input.setAttribute("placeholder", "Gender")
    input.setAttribute("aria-required", "true")
    input.setAttribute("aria-controls", "menu-q_gender")
    input.setAttribute("aria-expanded", "false")
    shadow.appendChild(input)
    const menu = document.getElementById("menu-q_gender")!
    const renderOptions = () => {
      if (menu.childElementCount) return
      input.setAttribute("aria-expanded", "true")
      for (const text of ["Male", "Female", "Prefer not to answer"]) {
        const opt = document.createElement("spl-select-option")
        const inner = document.createElement("spl-truncate") // deepest leaf
        inner.textContent = text
        opt.appendChild(inner)
        // Only a click on the INNER leaf commits — a wrapper click is ignored.
        inner.addEventListener("click", () => {
          input.value = text
          input.setAttribute("aria-expanded", "false")
        })
        menu.appendChild(opt)
      }
    }
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "ArrowDown") renderOptions()
    })

    const profile: SafeProfile = { first_name: "Felix", email: "f@x.com" } // diversity OFF
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    expect(input.value).toBe("Prefer not to answer")
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("last resort: required fields NEVER end as needs-review (all ATSs)", async () => {
    document.body.innerHTML = `
<form><ul>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Which region do you prefer?<span class="required">✱</span></div></div>
    <div class="application-field"><select name="q[region]" required>
      <option value=""></option><option value="n">North</option><option value="s">South</option>
    </select></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Explain any gaps in your record<span class="required">✱</span></div></div>
    <div class="application-field"><textarea name="q[constraints]" required></textarea></div>
  </div></li>
</ul></form>`
    // AI returns nothing — the last-resort tier must still leave ZERO
    // required fields empty (first real option / neutral "N/A").
    const profile: SafeProfile = { first_name: "Felix", email: "f@x.com" }
    const summary = await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    const val = (name: string) =>
      document.querySelector<HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!.value
    expect(val("q[region]")).toBe("n")
    expect(val("q[constraints]")).toBe("N/A")
    expect(summary.manualReviewCount).toBe(0)
  })
})
