import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clearTestState, setLocation } from "../../setup"
import { GlassdoorHandler } from "../../../src/content/aggregators/glassdoor/handler"

function loadFixture(name: string) {
  const html = readFileSync(join(__dirname, name), "utf-8")
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>|<\/html>\s*$/g, "")
}

describe("GlassdoorHandler", () => {
  beforeEach(() => {
    clearTestState()
  })

  describe("standard.html", () => {
    beforeEach(() => {
      setLocation("https://www.glassdoor.com/job-listing/senior-frontend-engineer-figma-JV_IC1147401_KO0,24_IM759.htm")
      loadFixture("standard.html")
    })

    it("isJobPage returns true on /job-listing/", () => {
      const h = new GlassdoorHandler()
      expect(h.isJobPage()).toBe(true)
    })

    it("scrapeJob produces the expected shape with confirmed salary", () => {
      const h = new GlassdoorHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.site).toBe("glassdoor")
      expect(job!.title).toBe("Senior Frontend Engineer")
      expect(job!.company).toBe("Figma")
      expect(job!.location).toContain("San Francisco")
      expect(job!.salary).toContain("$180K")
      expect(job!.salaryConfirmed).toBe(true)
    })

    it("postedAtPrecision is day for '3 days ago'", () => {
      const h = new GlassdoorHandler()
      const job = h.scrapeJob()!
      expect(job.postedAtPrecision).toBe("day")
    })

    it("detectApplyMode returns external_redirect for 'Apply on Employer Site'", () => {
      const h = new GlassdoorHandler()
      expect(h.detectApplyMode().kind).toBe("external_redirect")
    })

    it("injectPill places two pills (primary + Save company secondary)", async () => {
      const h = new GlassdoorHandler()
      const job = h.scrapeJob()!
      h.injectPill(document.querySelector("button")!, job)
      await new Promise((r) => setTimeout(r, 0))
      const pills = document.querySelectorAll("[data-apex-pill]")
      expect(pills).toHaveLength(2)
      expect(pills[0].getAttribute("data-testid")).toBe("apex-pill-glassdoor-primary")
      expect(pills[1].getAttribute("data-testid")).toBe("apex-pill-glassdoor-secondary")
    })
  })

  describe("walled.html", () => {
    beforeEach(() => {
      setLocation("https://www.glassdoor.com/job-listing/director-engineering-walledco-JV_IC1234.htm")
      loadFixture("walled.html")
    })

    it("scrapeJob still extracts visible content and flags givenToGetWalled", () => {
      const h = new GlassdoorHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.metadata.givenToGetWalled).toBe(true)
      // Doesn't try to bypass — description is whatever text was visible.
      expect(job!.title).toBe("Director of Engineering")
    })
  })
})
