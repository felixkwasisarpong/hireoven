import { describe, it, expect } from "vitest"
import { clampAvailabilityToFuture } from "../../src/autofill/workday-autofill"

// Fixed "now" so the tests are deterministic (repo lint bans argless new Date()
// only in workflow scripts; here we inject it explicitly anyway).
const NOW = new Date(2026, 6, 11) // 2026-07-11 (local)

describe("clampAvailabilityToFuture", () => {
  it("keeps free-text availability untouched", () => {
    expect(clampAvailabilityToFuture("Immediately", NOW)).toBe("Immediately")
    expect(clampAvailabilityToFuture("2 weeks notice required", NOW)).toBe("2 weeks notice required")
  })

  it("falls back when empty", () => {
    expect(clampAvailabilityToFuture("", NOW)).toBe("2 weeks notice required")
    expect(clampAvailabilityToFuture(null, NOW)).toBe("2 weeks notice required")
    expect(clampAvailabilityToFuture(undefined, NOW)).toBe("2 weeks notice required")
  })

  it("passes through a future date unchanged (both formats)", () => {
    expect(clampAvailabilityToFuture("2026-09-01", NOW)).toBe("2026-09-01")
    expect(clampAvailabilityToFuture("09/01/2026", NOW)).toBe("09/01/2026")
  })

  it("passes through today unchanged", () => {
    expect(clampAvailabilityToFuture("2026-07-11", NOW)).toBe("2026-07-11")
  })

  it("re-bases a PAST date to ~2 weeks out, preserving the input format", () => {
    // 2026-07-11 + 14 days = 2026-07-25
    expect(clampAvailabilityToFuture("2025-06-16", NOW)).toBe("2026-07-25")
    expect(clampAvailabilityToFuture("06/16/2025", NOW)).toBe("07/25/2026")
  })

  it("does not treat text-with-numbers as a calendar date", () => {
    expect(clampAvailabilityToFuture("Available in 2 weeks", NOW)).toBe("Available in 2 weeks")
  })
})
