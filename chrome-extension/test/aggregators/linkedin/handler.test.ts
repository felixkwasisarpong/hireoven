import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clearTestState, setLocation } from "../../setup"
import { LinkedInHandler } from "../../../src/content/aggregators/linkedin/handler"

function loadFixture(name: string) {
  const html = readFileSync(join(__dirname, name), "utf-8")
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>|<\/html>\s*$/g, "")
}

describe("LinkedInHandler", () => {
  beforeEach(() => {
    clearTestState()
  })

  describe("easy-apply.html", () => {
    beforeEach(() => {
      setLocation("https://www.linkedin.com/jobs/view/3923456789/")
      loadFixture("easy-apply.html")
    })

    it("isJobPage returns true on /jobs/view/", () => {
      const h = new LinkedInHandler()
      expect(h.isJobPage()).toBe(true)
    })

    it("scrapeJob produces the expected shape", () => {
      const h = new LinkedInHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.site).toBe("linkedin")
      expect(job!.sourceId).toBe("3923456789")
      expect(job!.title).toBe("Senior Software Engineer")
      expect(job!.company).toBe("Anthropic")
      expect(job!.location).toContain("San Francisco")
      expect(job!.workMode).toBe("remote")
      expect(job!.postedAtPrecision).toBe("exact")
      expect(job!.applyMode.kind).toBe("internal_easyapply")
      expect(job!.metadata).toBeDefined()
    })

    it("detectApplyMode returns internal_easyapply with linkedin driver", () => {
      const h = new LinkedInHandler()
      const mode = h.detectApplyMode()
      expect(mode.kind).toBe("internal_easyapply")
      expect((mode as { driver?: string }).driver).toBe("linkedin")
    })

    it("injectPill does not render any LinkedIn pill overlay", async () => {
      const h = new LinkedInHandler()
      const job = h.scrapeJob()!
      h.injectPill(document.querySelector(".jobs-apply-button")!, job)
      // injectPill is intentionally a no-op on LinkedIn.
      await new Promise((r) => setTimeout(r, 0))
      expect(document.querySelector("[data-scout-pill]")).toBeNull()
    })
  })

  describe("external.html", () => {
    beforeEach(() => {
      setLocation("https://www.linkedin.com/jobs/view/4001234567/")
      loadFixture("external.html")
    })

    it("detectApplyMode returns external_redirect", () => {
      const h = new LinkedInHandler()
      expect(h.detectApplyMode().kind).toBe("external_redirect")
    })

    it("scrapeJob workMode is hybrid", () => {
      const h = new LinkedInHandler()
      const job = h.scrapeJob()!
      expect(job.workMode).toBe("hybrid")
    })
  })

  describe("closed.html", () => {
    beforeEach(() => {
      setLocation("https://www.linkedin.com/jobs/view/2999000111/")
      loadFixture("closed.html")
    })

    it("detectApplyMode returns closed", () => {
      const h = new LinkedInHandler()
      expect(h.detectApplyMode().kind).toBe("closed")
    })

    it("injectPill keeps LinkedIn pill overlay disabled when closed", async () => {
      const h = new LinkedInHandler()
      const job = h.scrapeJob()!
      h.injectPill(document.querySelector(".jobs-apply-button")!, job)
      await new Promise((r) => setTimeout(r, 0))
      expect(document.querySelector("[data-scout-pill]")).toBeNull()
    })
  })

  describe("isJobPage gating", () => {
    it("returns false on the LinkedIn home feed", () => {
      setLocation("https://www.linkedin.com/feed/")
      document.documentElement.innerHTML = "<body></body>"
      const h = new LinkedInHandler()
      expect(h.isJobPage()).toBe(false)
    })
  })
})
