import { strict as assert } from "node:assert"
import { test } from "node:test"
import { detectBlockedHtml } from "./http"

test("detectBlockedHtml: blocks access-denied pages with access context", () => {
  assert.equal(
    detectBlockedHtml("<html><title>Access Denied</title><p>You do not have permission to access this page.</p></html>"),
    "blocked_html_access_denied"
  )
})

test("detectBlockedHtml: ignores incidental access-denied translation copy", () => {
  const html = `
    <html>
      <title>Employment Opportunities</title>
      <h4>Current Openings:</h4>
      <script>
        var dlmXHRtranslations = {
          access_denied: "Access denied. You do not have permission to download this file."
        };
      </script>
    </html>
  `
  assert.equal(detectBlockedHtml(html), null)
})
