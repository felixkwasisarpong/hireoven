import { describe, it, expect } from "vitest"
import { extractNameParts } from "../../src/autofill/workday-autofill"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = (o: Record<string, unknown>) => o as any

describe("extractNameParts — surname vs middle-name split", () => {
  it("uses the resume full name's final token when last_name absorbed the middle", () => {
    // The live CrowdStrike bug: profile.last_name = "Kwasi Sarpong".
    const r = extractNameParts(p({
      first_name: "Felix",
      last_name: "Kwasi Sarpong",
      resume_full_name: "Felix Kwasi Sarpong",
    }))
    expect(r.firstName).toBe("Felix")
    expect(r.middleName).toBe("Kwasi")
    expect(r.lastName).toBe("Sarpong")
  })

  it("keeps a correct single-token last_name as-is", () => {
    const r = extractNameParts(p({
      first_name: "Felix",
      last_name: "Sarpong",
      resume_full_name: "Felix Kwasi Sarpong",
    }))
    expect(r.firstName).toBe("Felix")
    expect(r.lastName).toBe("Sarpong")
  })

  it("does not touch a legitimate two-word surname when no 3-part full name exists", () => {
    const r = extractNameParts(p({
      first_name: "Maria",
      last_name: "De La Cruz",
    }))
    expect(r.firstName).toBe("Maria")
    expect(r.lastName).toBe("De La Cruz")
  })

  it("preserves a compound-particle surname even with a 3+-part full name", () => {
    const r = extractNameParts(p({
      first_name: "Maria",
      last_name: "De La Cruz",
      resume_full_name: "Maria Elena De La Cruz",
    }))
    expect(r.firstName).toBe("Maria")
    expect(r.lastName).toBe("De La Cruz")
  })

  it("preserves a 'van der' surname", () => {
    const r = extractNameParts(p({
      first_name: "Jan",
      last_name: "van der Berg",
      resume_full_name: "Jan Pieter van der Berg",
    }))
    expect(r.lastName).toBe("Van Der Berg")
  })

  it("derives a missing last name from a 3-part full name", () => {
    const r = extractNameParts(p({
      first_name: "Felix",
      last_name: "",
      resume_full_name: "Felix Kwasi Sarpong",
    }))
    expect(r.firstName).toBe("Felix")
    expect(r.lastName).toBe("Sarpong")
  })

  it("falls back to full-name-only split when no structured fields", () => {
    const r = extractNameParts(p({ resume_full_name: "Felix Kwasi Sarpong" }))
    expect(r.firstName).toBe("Felix")
    expect(r.middleName).toBe("Kwasi")
    expect(r.lastName).toBe("Sarpong")
  })
})
