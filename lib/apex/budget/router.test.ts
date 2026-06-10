import assert from "node:assert/strict"
import test from "node:test"

import { routeApexMessage } from "./router"

test("routes opportunity re-rank suggestions deterministically", () => {
  const decision = routeApexMessage(
    "Re-rank my opportunities around Backend Engineering and tell me what deserves attention today"
  )

  assert.equal(decision.useLLM, false)
})

test("keeps analysis questions on the LLM path", () => {
  const decision = routeApexMessage("Why is this role a good fit for my background?")

  assert.equal(decision.useLLM, true)
})
