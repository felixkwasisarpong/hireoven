import test from "node:test"
import assert from "node:assert/strict"
import {
  buildJobSearchTokenSql,
  escapeLikePattern,
  tokenizeJobSearchQuery,
} from "./search-sql"

test("tokenizeJobSearchQuery keeps technical punctuation and caps tokens", () => {
  assert.deepEqual(tokenizeJobSearchQuery("  senior C++ C# .NET (remote), platform engineer  "), [
    "senior",
    "C++",
    "C#",
    ".NET",
    "remote",
    "platform",
    "engineer",
  ])
  assert.equal(tokenizeJobSearchQuery("a b c", 2).length, 2)
})

test("escapeLikePattern treats SQL LIKE wildcards as literals", () => {
  assert.equal(escapeLikePattern("100% remote_backend\\role"), "100\\% remote\\_backend\\\\role")
})

test("buildJobSearchTokenSql uses ILIKE, not unsafe regex search", () => {
  const sql = buildJobSearchTokenSql({
    jobsAlias: "j",
    companiesAlias: "c",
    patternParam: "$1",
    token: "C++",
  })

  assert.match(sql, /j\.title ILIKE \$1 ESCAPE '\\'/)
  assert.match(sql, /unnest\(j\.skills\)/)
  assert.doesNotMatch(sql, /~\*/)
})

test("buildJobSearchTokenSql treats remote as a work-mode match", () => {
  const sql = buildJobSearchTokenSql({
    patternParam: "$1",
    token: "remote",
  })

  assert.match(sql, /jobs\.is_remote = true/)
})
