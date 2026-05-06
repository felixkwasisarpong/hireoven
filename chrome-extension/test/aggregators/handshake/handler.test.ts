import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clearTestState, setLocation } from "../../setup"
import { HandshakeHandler } from "../../../src/content/aggregators/handshake/handler"

function loadFixture(name: string) {
  const html = readFileSync(join(__dirname, name), "utf-8")
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>|<\/html>\s*$/g, "")
}

describe("HandshakeHandler", () => {
  beforeEach(() => {
    clearTestState()
  })

  describe("internal.html", () => {
    beforeEach(() => {
      setLocation("https://app.joinhandshake.com/jobs/9876543")
      loadFixture("internal.html")
    })

    it("isJobPage returns true on /jobs/<id>", () => {
      const h = new HandshakeHandler()
      expect(h.isJobPage()).toBe(true)
    })

    it("scrapeJob extracts standard fields plus early-career metadata", () => {
      const h = new HandshakeHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.site).toBe("handshake")
      expect(job!.sourceId).toBe("9876543")
      expect(job!.title).toBe("Software Engineering Intern")
      expect(job!.company).toBe("FutureCo")
      expect(job!.employmentType).toBe("Internship")
      expect(job!.metadata.earlyCareer).toBe(true)
      const requirements = job!.metadata.requirements as Record<string, unknown>
      expect(requirements.gpaCutoff).toBe(3)
      expect(Array.isArray(requirements.eligibleMajors)).toBe(true)
    })

    it("detectApplyMode returns internal_easyapply with handshake driver", () => {
      const h = new HandshakeHandler()
      const mode = h.detectApplyMode()
      expect(mode.kind).toBe("internal_easyapply")
      expect((mode as { driver?: string }).driver).toBe("handshake")
    })

    it("injectPill places a single pill near the apply button", async () => {
      const h = new HandshakeHandler()
      const job = h.scrapeJob()!
      h.injectPill(document.querySelector("button")!, job)
      await new Promise((r) => setTimeout(r, 0))
      const pills = document.querySelectorAll("[data-scout-pill]")
      expect(pills).toHaveLength(1)
      expect(pills[0].getAttribute("data-testid")).toBe("scout-pill-handshake")
    })
  })

  describe("express-interest.html", () => {
    beforeEach(() => {
      setLocation("https://app.joinhandshake.com/jobs/4444444")
      loadFixture("express-interest.html")
    })

    it("detectApplyMode returns express_interest", () => {
      const h = new HandshakeHandler()
      expect(h.detectApplyMode().kind).toBe("express_interest")
    })

    it("scrapeJob captures metadata.deadline when present", () => {
      const h = new HandshakeHandler()
      const job = h.scrapeJob()!
      expect(typeof job.metadata.deadline).toBe("string")
      expect((job.metadata.deadline as string).length).toBeGreaterThan(0)
    })
  })

  describe("locked-resume.html", () => {
    beforeEach(() => {
      setLocation("https://app.joinhandshake.com/jobs/3333333")
      loadFixture("locked-resume.html")
    })

    it("scrapeJob succeeds even with a locked-profile modal in the DOM", () => {
      const h = new HandshakeHandler()
      const job = h.scrapeJob()
      expect(job).not.toBeNull()
      expect(job!.title).toBe("Operations Analyst Intern")
    })
  })

  describe("login-wall.html", () => {
    beforeEach(() => {
      setLocation("https://app.joinhandshake.com/jobs/1111111")
      loadFixture("login-wall.html")
    })

    it("isJobPage returns false when login form is present", () => {
      const h = new HandshakeHandler()
      expect(h.isJobPage()).toBe(false)
    })
  })
})
