// @vitest-environment jsdom
/**
 * Regression: Shield AI Lever form (jobs.lever.co/shieldai).
 *
 * Bugs this guards against:
 *  1. Sponsorship "now or in the future" must follow the work-auth product
 *     rule (currently-authorized OPT → "No") deterministically — never left
 *     to the AI tier, and never overridden by a stale requires_sponsorship
 *     profile flag when a current status is present.
 *  2. A deterministic answer that FAILS to apply (profile city offered to a
 *     select whose options don't contain it) must fall through to the AI
 *     tier instead of stranding the field empty.
 */
import { describe, expect, it } from "vitest"
import { fillRequiredAtsFields } from "../../src/autofill/ashby-autofill"
import type { SafeProfile } from "../../src/autofill/safe-fields"

const LEVER_HTML = `
<form>
<ul>
  <li class="application-question" data-qa="opportunity-location-question">
    <div class="application-label">Which location are you applying for?</div>
    <div class="application-field"><div class="application-dropdown">
      <select name="opportunityLocationId" class="opportunity-location">
        <option value="">Select...</option>
        <option value="58494029">Dallas, Texas</option>
        <option value="11b7d288">Washington, DC</option>
        <option value="9e100134">San Francisco, California</option>
      </select>
    </div></div>
  </li>
  <li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-choice"><div class="text">Are you authorized to work in the United States?<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
      <li><label><input type="radio" name="cards[c1][field0]" value="Yes" required="required"><span class="application-answer-alternative">Yes</span></label></li>
      <li><label><input type="radio" name="cards[c1][field0]" value="No" required="required"><span class="application-answer-alternative">No</span></label></li>
    </ul></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-choice"><div class="text">Will you require sponsorship for employment now or in the future?<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
      <li><label><input type="radio" name="cards[c1][field1]" value="Yes" required="required"><span class="application-answer-alternative">Yes</span></label></li>
      <li><label><input type="radio" name="cards[c1][field1]" value="No" required="required"><span class="application-answer-alternative">No</span></label></li>
    </ul></div>
  </div></li>
</ul>
</form>`

describe("Lever custom questions (Shield AI regression)", () => {
  it("OPT profile answers sponsorship=No / authorized=Yes deterministically; unmatchable location select is retried via the AI tier", async () => {
    document.body.innerHTML = LEVER_HTML
    const profile: SafeProfile = {
      first_name: "Felix",
      email: "f@x.com",
      city: "Lubbock",
      state: "TX",
      work_authorization: "F-1 OPT",
      // Stale flag — must NOT override the currently-authorized OPT status.
      requires_sponsorship: true,
      authorized_to_work: true,
    }

    let aiLabels: string[] = []
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) => {
        aiLabels = qs.map((q) => q.label)
        return qs.map((q) => ({
          id: q.id,
          value: /location/i.test(q.label) ? "Dallas, Texas" : null,
          confidence: "high" as const,
        }))
      },
    })

    const radios = (name: string) =>
      [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]

    // Work-auth product rule, applied deterministically:
    expect(radios("cards[c1][field0]").find((r) => r.value === "Yes")!.checked).toBe(true)
    expect(radios("cards[c1][field1]").find((r) => r.value === "No")!.checked).toBe(true)
    // …and those questions were never delegated to the AI:
    expect(aiLabels.join(" | ")).not.toMatch(/sponsorship|authorized/i)

    // Location: deterministic "Lubbock, TX" cannot match the options, so the
    // question must reach the AI, whose valid option gets applied:
    expect(aiLabels.join(" | ")).toMatch(/which location/i)
    const select = document.querySelector("select")!
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe("Dallas, Texas")
  })

  it("fills 'how did you hear' radios + signature Date + EEO (opted in); leaves conditional follow-ups blank", async () => {
    document.body.innerHTML = `
<form><ul>
  <li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-choice"><div class="text">How did you hear about us?<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
      <li><label><input type="radio" name="cards[c2][f0]" value="Campus visit" required><span class="application-answer-alternative">Campus visit</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="LinkedIn Post" required><span class="application-answer-alternative">LinkedIn Post</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="LinkedIn Sponsored Job/Ad" required><span class="application-answer-alternative">LinkedIn Sponsored Job/Ad</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Industry Conference" required><span class="application-answer-alternative">Industry Conference</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Twitter/X" required><span class="application-answer-alternative">Twitter/X</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Instagram" required><span class="application-answer-alternative">Instagram</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Referral" required><span class="application-answer-alternative">Referral</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Handshake" required><span class="application-answer-alternative">Handshake</span></label></li>
      <li><label><input type="radio" name="cards[c2][f0]" value="Other" required><span class="application-answer-alternative">Other</span></label></li>
    </ul></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">If "Industry Conference" or "Other," please provide more details:</div></div>
    <div class="application-field"><textarea name="cards[c2][f1]"></textarea></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">If you selected international, what location(s)?</div></div>
    <div class="application-field"><textarea name="cards[c2][f2]"></textarea></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Date</div></div>
    <div class="application-field"><input type="text" name="cards[c2][f3]" placeholder="MM/DD/YYYY"></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Gender</div></div>
    <div class="application-field"><select name="cards[c2][f4]">
      <option value="">Select ...</option><option value="m">Male</option><option value="w">Female</option><option value="d">Decline to self-identify</option>
    </select></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-choice"><div class="text">Race</div></div>
    <div class="application-field"><ul data-qa="multiple-choice">
      <li><label><input type="radio" name="cards[c2][f5]" value="hl"><span class="application-answer-alternative">Hispanic or Latino</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="w"><span class="application-answer-alternative">White (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="baa"><span class="application-answer-alternative">Black or African American (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="nh"><span class="application-answer-alternative">Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="a"><span class="application-answer-alternative">Asian (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="ai"><span class="application-answer-alternative">American Indian or Alaska Native (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="tm"><span class="application-answer-alternative">Two or More Races (Not Hispanic or Latino)</span></label></li>
      <li><label><input type="radio" name="cards[c2][f5]" value="d"><span class="application-answer-alternative">Decline to self-identify</span></label></li>
    </ul></div>
  </div></li>
  <li class="application-question custom-question"><div>
    <div class="application-label"><div class="text">Veteran status</div></div>
    <div class="application-field"><select name="cards[c2][f6]">
      <option value="">Select ...</option>
      <option value="v">I identify as one or more of the classifications of protected veteran</option>
      <option value="nv">I am not a protected veteran</option>
      <option value="d">I don't wish to answer</option>
    </select></div>
  </div></li>
</ul></form>`
    const profile: SafeProfile = {
      first_name: "Felix",
      email: "f@x.com",
      auto_fill_diversity: true,
      gender: "Male",
      ethnicity: "Black or African American",
      veteran_status: "I am not a protected veteran",
    }
    await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (qs) =>
        qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })

    const checked = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
    // "How did you hear" radios: source-candidate list now works on radio groups
    expect(checked("cards[c2][f0]")?.value).toBe("LinkedIn Post")
    // Conditional follow-ups stay blank (branch not taken / manual)
    expect(document.querySelector<HTMLTextAreaElement>('[name="cards[c2][f1]"]')!.value).toBe("")
    expect(document.querySelector<HTMLTextAreaElement>('[name="cards[c2][f2]"]')!.value).toBe("")
    // Signature date = today
    const now = new Date()
    const today = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`
    expect(document.querySelector<HTMLInputElement>('[name="cards[c2][f3]"]')!.value).toBe(today)
    // EEO — opted in, mapped from profile across differently-worded options
    expect(document.querySelector<HTMLSelectElement>('[name="cards[c2][f4]"]')!.selectedOptions[0]?.text).toBe("Male")
    expect(checked("cards[c2][f5]")?.value).toBe("baa")
    expect(document.querySelector<HTMLSelectElement>('[name="cards[c2][f6]"]')!.value).toBe("nv")
  })
})
