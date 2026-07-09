// @vitest-environment jsdom
/**
 * Auto-learn the user's manual picks and reuse them as top-priority custom
 * answers. jsdom can't synthesize a trusted event, so we test the extracted
 * `recordUserEdit` core (the change listener just gates it on event.isTrusted).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { getLearnedCustomAnswers, recordUserEdit } from "../../src/autofill/learned-answers"

function installChromeMock(): void {
  const mem: Record<string, unknown> = {}
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: "test", lastError: undefined },
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: mem[key] }),
        set: (obj: Record<string, unknown>) => {
          Object.assign(mem, obj)
        },
      },
    },
  }
}

describe("learned answers", () => {
  beforeEach(() => {
    installChromeMock()
  })

  it("learns a radio pick keyed by the QUESTION, storing the chosen option", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Are you able to reliably commute to Tempe, AZ?</legend>
          <label for="c0">Yes</label><input id="c0" type="radio" name="commute" />
          <label for="c1">No</label><input id="c1" type="radio" name="commute" />
        </fieldset>
      </form>`
    const no = document.getElementById("c1") as HTMLInputElement
    no.checked = true
    const entry = await recordUserEdit(no)
    expect(entry?.answer).toBe("No")
    expect(entry?.label.toLowerCase()).toContain("commute")

    // Reused as a custom_answer whose pattern matches the same question later.
    const learned = await getLearnedCustomAnswers()
    const hit = learned.find((l) => new RegExp(l.question_pattern, "i").test("Are you able to reliably commute to Tempe, AZ?"))
    expect(hit?.answer).toBe("No")
  })

  it("captures a select choice with the field label", async () => {
    document.body.innerHTML = `
      <div class="field">
        <label for="shirt">T-shirt size</label>
        <select id="shirt"><option value="">Select…</option><option>Medium</option><option>Large</option></select>
      </div>`
    const sel = document.getElementById("shirt") as HTMLSelectElement
    sel.value = "Large"
    const entry = await recordUserEdit(sel)
    expect(entry?.answer).toBe("Large")
    expect(entry?.label).toBe("T-shirt size")
  })

  it("skips profile-covered fields (Email) — those come from the profile, not learning", async () => {
    document.body.innerHTML = `<label for="e">Email</label><input id="e" type="text" />`
    const e = document.getElementById("e") as HTMLInputElement
    e.value = "x@y.com"
    expect(await recordUserEdit(e)).toBeNull()
  })

  it("produces a valid, escaped regex pattern even for questions with special chars", async () => {
    document.body.innerHTML = `
      <div class="field"><label for="q">Do you have C++ (5+ years)?</label><textarea id="q"></textarea></div>`
    const q = document.getElementById("q") as HTMLTextAreaElement
    q.value = "Yes, 6 years"
    await recordUserEdit(q)
    const [l] = await getLearnedCustomAnswers()
    expect(() => new RegExp(l.question_pattern, "i")).not.toThrow()
    expect(new RegExp(l.question_pattern, "i").test("Do you have C++ (5+ years)?")).toBe(true)
    expect(l.answer).toBe("Yes, 6 years")
  })
})
