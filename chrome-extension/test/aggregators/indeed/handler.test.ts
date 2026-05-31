import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clearTestState, setLocation } from "../../setup"
import { IndeedHandler } from "../../../src/content/aggregators/indeed/handler"

function loadFixture(name: string) {
  const html = readFileSync(join(__dirname, name), "utf-8")
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>|<\/html>\s*$/g, "")
}

describe("IndeedHandler", () => {
  beforeEach(() => {
    clearTestState()
  })

  describe("easily-apply.html", () => {
    beforeEach(() => {
      setLocation("https://www.indeed.com/viewjob?jk=abc123def456")
      loadFixture("easily-apply.html")
    })

    it("isJobPage returns true on /viewjob", () => {
      const h = new IndeedHandler()
      expect(h.isJobPage()).toBe(true)
    })

    it("scrapeJob produces the expected shape with confirmed salary", () => {
      const h = new IndeedHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.site).toBe("indeed")
      expect(job!.sourceId).toBe("abc123def456")
      expect(job!.title).toBe("Software Engineer II")
      expect(job!.company).toBe("Acme Corp")
      expect(job!.salary).toContain("$140,000")
      expect(job!.salaryConfirmed).toBe(true)
      expect(job!.workMode).toBe("remote")
    })

    it("postedAtPrecision is exact for 'Posted 3 hours ago'", () => {
      const h = new IndeedHandler()
      const job = h.scrapeJob()!
      expect(job.postedAtPrecision).toBe("exact")
    })

    it("detectApplyMode returns internal_easyapply with indeed driver", () => {
      const h = new IndeedHandler()
      const mode = h.detectApplyMode()
      expect(mode.kind).toBe("internal_easyapply")
      expect((mode as { driver?: string }).driver).toBe("indeed")
    })

    it("injectPill anchors to the right pane apply button", async () => {
      const h = new IndeedHandler()
      const job = h.scrapeJob()!
      h.injectPill(document.querySelector("[data-testid='indeedApplyButton']")!, job)
      await new Promise((r) => setTimeout(r, 0))
      const pill = document.querySelector("[data-testid='apex-pill-indeed']")
      expect(pill).not.toBeNull()
      expect(pill!.previousElementSibling?.getAttribute("data-testid")).toBe("indeedApplyButton")
    })
  })

  describe("external.html", () => {
    beforeEach(() => {
      setLocation("https://www.indeed.com/viewjob?jk=ext789")
      loadFixture("external.html")
    })

    it("detectApplyMode returns external_redirect", () => {
      const h = new IndeedHandler()
      expect(h.detectApplyMode().kind).toBe("external_redirect")
    })
  })

  describe("disqualifier.html", () => {
    beforeEach(() => {
      setLocation("https://www.indeed.com/viewjob?jk=dq111")
      loadFixture("disqualifier.html")
    })

    it("scrapeJob succeeds and detectApplyMode is internal_easyapply", () => {
      const h = new IndeedHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(h.detectApplyMode().kind).toBe("internal_easyapply")
    })
  })

  describe("isJobPage gating", () => {
    it("returns false on the homepage", () => {
      setLocation("https://www.indeed.com/")
      document.documentElement.innerHTML = "<body></body>"
      const h = new IndeedHandler()
      expect(h.isJobPage()).toBe(false)
    })

    it("matches country subdomains", () => {
      setLocation("https://uk.indeed.com/viewjob?jk=intl-456")
      document.documentElement.innerHTML = "<body><h1 class=\"jobsearch-JobInfoHeader-title\">Role</h1><a class=\"jobsearch-CompanyInfoContainer\">Co</a></body>"
      const h = new IndeedHandler()
      expect(h.isJobPage()).toBe(true)
    })
  })
})
