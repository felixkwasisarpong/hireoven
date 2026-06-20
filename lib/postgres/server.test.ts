import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  getErrorMessage,
  getPostgresErrorCode,
  isTransientPostgresError,
} from "./server"

test("isTransientPostgresError recognizes shutdown and connection failures", () => {
  assert.equal(isTransientPostgresError({ code: "57P01" }), true)
  assert.equal(isTransientPostgresError({ code: "08006" }), true)
  assert.equal(isTransientPostgresError({ code: "23505" }), false)
  assert.equal(isTransientPostgresError(new Error("boom")), false)
})

test("getPostgresErrorCode and getErrorMessage normalize unknown errors", () => {
  assert.equal(getPostgresErrorCode({ code: "57P03" }), "57P03")
  assert.equal(getPostgresErrorCode({ code: 57 }), undefined)
  assert.equal(getErrorMessage(new Error("database unavailable")), "database unavailable")
  assert.equal(getErrorMessage("plain failure"), "plain failure")
})
