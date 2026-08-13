import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const XRAY_DIR = join(process.cwd(), "lib/application-xray")

test("Application X-Ray core has no forbidden production dependencies or fields", () => {
  const source = productionSource()

  for (const [label, pattern] of [
    ["legacy verdict scorer", /\bcalculateApplicationVerdict\b/],
    ["environment reads", /\bprocess\.env\b/],
    ["network fetch", /\bfetch\s*\(/],
    ["Supabase client", /\bcreateClient\b/],
    ["Postgres import", /\bfrom\s+["']pg["']/],
    ["overall match score", /\boverall(?:_|S)core\b|\boverall_match_score\b|\bjob_match_scores\.overall_score\b/],
    ["gender field", /\bgender\b/],
    ["ethnicity field", /\bethnicity\b|\bhispanic\b/],
    ["veteran field", /\bveteran_status\b/],
    ["disability field", /\bdisability_status\b/],
    ["interview probability output", /\binterview(?:_|P)robability\b|\boffer(?:_|P)robability\b|\bhire(?:_|P)robability\b|\bchanceOfInterview\b/],
  ] as const) {
    assert.equal(pattern.test(source), false, label)
  }
})

test("Application X-Ray source does not read current time implicitly", () => {
  const source = productionSource()
  assert.equal(/\bDate\.now\s*\(/.test(source), false)
  assert.equal(/\bnew\s+Date\s*\(\s*\)/.test(source), false)
})

function productionSource(): string {
  return filesUnder(XRAY_DIR)
    .filter((file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      !file.startsWith(join(XRAY_DIR, "server")),
    )
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}
