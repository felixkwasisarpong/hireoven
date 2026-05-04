import { NextResponse } from "next/server"
import { generateGuidance } from "@/lib/background-check/guidance-engine"
import type { GuidanceInput, RecordType, YearsAgo } from "@/lib/background-check/guidance-engine"

export const dynamic = "force-dynamic"

const VALID_RECORD_TYPES = new Set<RecordType>([
  "criminal_conviction",
  "arrest_no_conviction",
  "credit_issues",
  "employment_gap",
  "dismissed_charges",
  "expunged_record",
])

const VALID_YEARS_AGO = new Set<YearsAgo>(["under_3", "3_to_7", "7_to_10", "over_10"])

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { recordTypes, yearsAgo, stateCode, industries } = body as Record<string, unknown>

  if (!Array.isArray(recordTypes) || recordTypes.length === 0) {
    return NextResponse.json({ error: "recordTypes must be a non-empty array" }, { status: 400 })
  }

  for (const rt of recordTypes) {
    if (!VALID_RECORD_TYPES.has(rt as RecordType)) {
      return NextResponse.json({ error: `Invalid recordType: ${rt}` }, { status: 400 })
    }
  }

  if (typeof yearsAgo !== "string" || !VALID_YEARS_AGO.has(yearsAgo as YearsAgo)) {
    return NextResponse.json({ error: "Invalid yearsAgo value" }, { status: 400 })
  }

  if (typeof stateCode !== "string" || stateCode.length !== 2) {
    return NextResponse.json({ error: "stateCode must be a 2-character string" }, { status: 400 })
  }

  if (!Array.isArray(industries)) {
    return NextResponse.json({ error: "industries must be an array" }, { status: 400 })
  }

  const input: GuidanceInput = {
    recordTypes: recordTypes as RecordType[],
    yearsAgo: yearsAgo as YearsAgo,
    stateCode: stateCode.toUpperCase(),
    industries: industries.filter((i): i is string => typeof i === "string"),
  }

  try {
    const result = await generateGuidance(input)
    return NextResponse.json(result)
  } catch (err) {
    console.error("[background-check/guidance] Error generating guidance:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to generate guidance" }, { status: 500 })
  }
}
