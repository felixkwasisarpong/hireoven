import test from "node:test"
import assert from "node:assert/strict"
import {
  extractAtsCandidates,
  generateEnterpriseAtsSearchQueries,
  nextCheckSecondsForCandidate,
  verifyAtsCandidate,
} from "@/lib/companies/ats-candidates"

test("extractAtsCandidates detects Workday CXS endpoints embedded in careers HTML", () => {
  const html = `
    <html>
      <body>
        <h1>Careers at Acme Robotics</h1>
        <script>
          window.__jobs = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/jobs";
        </script>
        <a href="https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers">View open roles</a>
      </body>
    </html>
  `

  const candidates = extractAtsCandidates({
    companyName: "Acme Robotics",
    companyDomain: "acmerobotics.com",
    page: { url: "https://acmerobotics.com/careers", finalUrl: "https://acmerobotics.com/careers", html },
  })

  const workday = candidates.find((candidate) => candidate.atsType === "workday")
  assert.ok(workday)
  assert.equal(workday.candidateUrl, "https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers")
  assert.equal(workday.host, "acme.wd5.myworkdayjobs.com")
})

test("verifyAtsCandidate scores verified Workday candidates with jobs and details", () => {
  const officialHtml = `
    <a href="https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers">Open roles</a>
  `
  const candidate = extractAtsCandidates({
    companyName: "Acme Robotics",
    page: {
      url: "https://acmerobotics.com/careers",
      finalUrl: "https://acmerobotics.com/careers",
      html: officialHtml,
    },
  })[0]
  assert.ok(candidate)

  const candidateHtml = `
    <html>
      <head><title>Careers at Acme Robotics</title></head>
      <body>
        <a href="/en-US/Acme_Careers/job/Austin-TX/Software-Engineer_JR123">Software Engineer</a>
        <script>{"title":"Platform Engineer","location":"Austin, TX"}</script>
      </body>
    </html>
  `

  const verification = verifyAtsCandidate({
    candidate,
    companyName: "Acme Robotics",
    officialPageHtml: officialHtml,
    candidatePageHtml: candidateHtml,
    candidateFinalUrl: candidate.candidateUrl,
  })

  assert.equal(verification.status, "verified")
  assert.equal(verification.confidence, 100)
  assert.ok(verification.evidence.jobs.jobsFound >= 1)
  assert.ok(verification.evidence.jobs.detailUrls.length >= 1)
})

test("extractAtsCandidates detects iCIMS branded portals through embedded iCIMS URLs", () => {
  const html = `
    <html>
      <head><title>Acme Health Careers</title></head>
      <body>
        <script src="https://careers-acme.icims.com/jobs/scripts/ats.js"></script>
        <a href="https://careers-acme.icims.com/jobs/456/nurse/job">Registered Nurse</a>
      </body>
    </html>
  `

  const candidates = extractAtsCandidates({
    companyName: "Acme Health",
    companyDomain: "acmehealth.com",
    page: { url: "https://careers.acmehealth.com/jobs", finalUrl: "https://careers.acmehealth.com/jobs", html },
  })

  const icims = candidates.find((candidate) => candidate.atsType === "icims")
  assert.ok(icims)
  assert.equal(icims.host, "careers-acme.icims.com")
  assert.equal(icims.candidateUrl, "https://careers-acme.icims.com/jobs/search")
})

test("extractAtsCandidates ignores Phenom CDN assets", () => {
  const html = `
    <html><body>
      <img src="https://cdn.phenompeople.com/CareerConnectResources/MCAFGLOBAL/en_global/desktop/assets/images/l/apple-touch-icon-precomposed.png?v=1" />
    </body></html>
  `

  const candidates = extractAtsCandidates({
    companyName: "McAfee",
    companyDomain: "mcafee.com",
    page: { url: "https://careers.mcafee.com", finalUrl: "https://careers.mcafee.com", html },
  })

  assert.equal(candidates.length, 0)
})

test("extractAtsCandidates normalizes Greenhouse embed scripts to board URLs", () => {
  const html = `<script src="https://boards.greenhouse.io/embed/job_board/js?for=quinstreet"></script>`
  const candidates = extractAtsCandidates({
    companyName: "Quinstreet",
    companyDomain: "quinstreet.com",
    page: { url: "https://quinstreet.com/careers", finalUrl: "https://quinstreet.com/careers", html },
  })

  assert.equal(candidates[0]?.atsType, "greenhouse")
  assert.equal(candidates[0]?.candidateUrl, "https://boards.greenhouse.io/quinstreet")
})

test("verifyAtsCandidate keeps official no-job ATS pages but marks them verified_no_jobs", () => {
  const officialHtml = `<a href="https://careers-acme.icims.com/jobs/search">Jobs</a>`
  const candidate = extractAtsCandidates({
    companyName: "Acme Health",
    page: {
      url: "https://careers.acmehealth.com/jobs",
      finalUrl: "https://careers.acmehealth.com/jobs",
      html: officialHtml,
    },
  })[0]
  assert.ok(candidate)

  const verification = verifyAtsCandidate({
    candidate,
    companyName: "Acme Health",
    officialPageHtml: officialHtml,
    candidatePageHtml: "<html><title>Careers at Acme Health</title><p>No jobs currently open.</p></html>",
  })

  assert.equal(verification.status, "verified_no_jobs")
  assert.equal(verification.confidence, 40)
})

test("verifyAtsCandidate rejects likely wrong-company pages", () => {
  const officialHtml = `<a href="https://wrongco.wd5.myworkdayjobs.com/en-US/WrongCo">Jobs</a>`
  const candidate = extractAtsCandidates({
    companyName: "Acme Robotics",
    page: {
      url: "https://acmerobotics.com/careers",
      finalUrl: "https://acmerobotics.com/careers",
      html: officialHtml,
    },
  })[0]
  assert.ok(candidate)

  const verification = verifyAtsCandidate({
    candidate,
    companyName: "Acme Robotics",
    officialPageHtml: officialHtml,
    candidatePageHtml: "<html><title>Careers at WrongCo</title></html>",
  })

  assert.equal(verification.status, "rejected")
  assert.equal(verification.evidence.wrongCompanyName, true)
})

test("generateEnterpriseAtsSearchQueries includes Workday and iCIMS fallbacks", () => {
  const queries = generateEnterpriseAtsSearchQueries("Acme Robotics")
  assert.ok(queries.includes('site:myworkdayjobs.com "Acme Robotics" careers'))
  assert.ok(queries.includes('site:icims.com "Acme Robotics" jobs'))
})

test("nextCheckSecondsForCandidate encodes refresh cadence", () => {
  assert.equal(nextCheckSecondsForCandidate("verified"), 10 * 60)
  assert.equal(nextCheckSecondsForCandidate("verified_no_jobs"), 8 * 60 * 60)
  assert.equal(nextCheckSecondsForCandidate("pending"), 24 * 60 * 60)
  assert.equal(nextCheckSecondsForCandidate("rejected"), 14 * 24 * 60 * 60)
})
