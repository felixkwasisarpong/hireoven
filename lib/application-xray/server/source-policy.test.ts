import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const SERVER_DIR = join(process.cwd(), "lib/application-xray/server")
const ROUTE_FILE = join(process.cwd(), "app/api/jobs/[id]/xray/route.ts")

test("Application X-Ray server adapter avoids forbidden integration shortcuts", () => {
  const source = productionSource()

  for (const [label, pattern] of [
    ["network fetch", /\bfetch\s*\(/],
    ["Anthropic SDK", /\bAnthropic\b|@anthropic-ai\/sdk/],
    ["OpenAI SDK", /\bOpenAI\b|openai\/resources|chat\.completions|responses\.create/],
    ["legacy verdict scorer", /\bcalculateApplicationVerdict\b/],
    ["internal API route call", /\/api\/(?:jobs|match|resume|employers|rejections|h1b)\//],
    ["interview probability output", /\binterview(?:_|P)robability\b|\boffer(?:_|P)robability\b|\bhire(?:_|P)robability\b|\bchanceOfInterview\b/],
  ] as const) {
    assert.equal(pattern.test(source), false, label)
  }
})

test("Application X-Ray server adapter does not select excluded demographic columns", () => {
  const source = productionSource()
  const selectStatements = source.match(/SELECT[\s\S]*?FROM\s+autofill_profiles/g) ?? []
  assert.ok(selectStatements.length > 0, "expected an autofill profile read")

  for (const statement of selectStatements) {
    for (const [label, pattern] of [
      ["demographic field 1", /\bgender\b/],
      ["demographic field 2", /\bethnicity\b|\bhispanic\b/],
      ["demographic field 3", /\bveteran_status\b/],
      ["demographic field 4", /\bdisability_status\b/],
    ] as const) {
      assert.equal(pattern.test(statement), false, label)
    }
  }
})

function productionSource(): string {
  const files = filesUnder(SERVER_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .concat(ROUTE_FILE)
  return files
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}
