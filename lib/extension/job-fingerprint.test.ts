import assert from "node:assert/strict"
import test from "node:test"
import {
  buildExtensionJobFingerprint,
  extractExternalJobIdsFromUrl,
  normalizeExtensionJobUrl,
} from "@/lib/extension/job-fingerprint"

test("normalizeExtensionJobUrl canonicalizes LinkedIn currentJobId URLs", () => {
  const normalized = normalizeExtensionJobUrl(
    "https://www.linkedin.com/jobs/search/?currentJobId=1234567890&utm_source=test",
  )
  assert.equal(normalized, "https://www.linkedin.com/jobs/view/1234567890/")
})

test("extractExternalJobIdsFromUrl reads gh_jid", () => {
  const ids = extractExternalJobIdsFromUrl(
    "https://www.sofi.com/careers/job/?gh_jid=7693700003&utm_source=linkedin",
  )
  assert.deepEqual(ids, ["7693700003"])
})

test("buildExtensionJobFingerprint keeps gh_jid URL candidate and external id", () => {
  const fingerprint = buildExtensionJobFingerprint({
    urls: [
      "https://www.sofi.com/careers/job/?gh_jid=7693700003&utm_source=linkedin",
      "https://www.sofi.com/careers/job/",
    ],
  })

  assert.ok(fingerprint.externalJobIds.includes("7693700003"))
  assert.ok(
    fingerprint.candidateUrls.some((url) =>
      url.includes("https://www.sofi.com/careers/job?gh_jid=7693700003"),
    ),
  )
})
