/**
 * Hireoven Scout Bridge — Popup Script
 *
 * Phase 2: Single-job autofill preview.
 * - Job listing page: scan + save flow (Phase 1)
 * - Application form page: preview autofill fields, then fill on click
 *
 * Safety rules:
 *   - Never auto-submit
 *   - Never auto-fill without user clicking "Autofill this application"
 *   - Never upload files automatically
 *   - Mark low-confidence fields as "Review"
 */

import type {
  AutofillExecuteResult,
  AutofillPreviewResult,
  BackgroundMessage,
  BackgroundResponse,
  DetectedField,
  ExtractedJob,
  PageInfoResult,
  SaveResult,
  SessionResult,
} from "../types"

// ── DOM refs ───────────────────────────────────────────────────────────────────

const content           = document.getElementById("content")!
const loading           = document.getElementById("loading")!
const loadingText       = document.getElementById("loading-text")!
const pillRow           = document.getElementById("pill-row")!
const pillPageType      = document.getElementById("pill-page-type")!
const pillAts           = document.getElementById("pill-ats")!
const jobCard           = document.getElementById("job-card")!
const jobTitle          = document.getElementById("job-title")!
const jobMeta           = document.getElementById("job-meta")!
const jobSalary         = document.getElementById("job-salary")!
const savedBanner       = document.getElementById("saved-banner")!
const infoText          = document.getElementById("info-text")!
const autofillSection   = document.getElementById("autofill-section")!
const autofillStats     = document.getElementById("autofill-stats")!
const statDetected      = document.getElementById("stat-detected")!
const statMatched       = document.getElementById("stat-matched")!
const statReview        = document.getElementById("stat-review")!
const profileWarning    = document.getElementById("profile-warning")!
const profileLink       = document.getElementById("profile-link") as HTMLAnchorElement
const fieldList         = document.getElementById("field-list")!
const autofillConfirm   = document.getElementById("autofill-confirm")!
const autofillConfirmTitle = document.getElementById("autofill-confirm-title")!

const barLabel          = document.getElementById("bar-label")!
const barSub            = document.getElementById("bar-sub")!
const signinBtn         = document.getElementById("signin-btn") as HTMLButtonElement
const scanBtn           = document.getElementById("scan-btn") as HTMLButtonElement
const saveBtn           = document.getElementById("save-btn") as HTMLButtonElement
const previewAutofillBtn = document.getElementById("preview-autofill-btn") as HTMLButtonElement
const autofillBtn       = document.getElementById("autofill-btn") as HTMLButtonElement
const openBtn           = document.getElementById("open-btn") as HTMLButtonElement

// ── State ──────────────────────────────────────────────────────────────────────

let currentJob: ExtractedJob | null = null
let savedJobId: string | null = null
let currentAutofillFields: DetectedField[] = []
let appOrigin = "http://localhost:3000"

// ── Helpers ────────────────────────────────────────────────────────────────────

function show(...els: HTMLElement[]) { els.forEach((e) => e.classList.remove("hidden")) }
function hide(...els: HTMLElement[]) { els.forEach((e) => e.classList.add("hidden")) }

const ATS_LABELS: Record<string, string> = {
  workday: "Workday",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  icims: "iCIMS",
  smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR",
  generic: "Generic",
}

const PAGE_TYPE_LABELS: Record<string, string> = {
  job_listing: "Job Listing",
  application_form: "Application Form",
  unknown: "Unknown Page",
}

function setBarLabel(main: string, sub = "") {
  barLabel.childNodes[0].textContent = main + " "
  barSub.textContent = sub ? `· ${sub}` : ""
}

function sendToBackground(message: BackgroundMessage): Promise<BackgroundResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse | undefined) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return }
      if (!response) { reject(new Error("No response")); return }
      resolve(response)
    })
  })
}

// ── Field row rendering ────────────────────────────────────────────────────────

function renderFieldRow(field: DetectedField): HTMLElement {
  const isFile = field.type === "file"
  const isReady = !field.needsReview && !isFile && field.detectedValue

  const div = document.createElement("div")
  div.className = `field-row ${isFile ? "file" : isReady ? "ready" : "review"}`

  const dot = document.createElement("span")
  dot.className = "field-dot"
  div.appendChild(dot)

  const info = document.createElement("div")
  info.className = "field-info"

  const labelEl = document.createElement("div")
  labelEl.className = "field-label"
  labelEl.textContent = field.label

  const valueEl = document.createElement("div")
  valueEl.className = "field-value"
  if (isFile) {
    const key = field.suggestedProfileKey
    valueEl.textContent = key === "resume" ? "Manual upload required" : "Manual attachment required"
  } else if (field.detectedValue) {
    valueEl.textContent = field.detectedValue
  } else {
    valueEl.textContent = "No profile value"
  }

  info.appendChild(labelEl)
  info.appendChild(valueEl)
  div.appendChild(info)

  const badge = document.createElement("span")
  badge.className = "field-badge"
  if (isFile) {
    badge.textContent = "Manual"
  } else if (isReady) {
    badge.textContent = "Ready"
  } else {
    badge.textContent = "Review"
  }
  div.appendChild(badge)

  return div
}

// ── Render states ──────────────────────────────────────────────────────────────

function renderIdle() {
  hide(content)
  setBarLabel("Hireoven Scout", "click to scan")
  hide(signinBtn, saveBtn, openBtn, previewAutofillBtn, autofillBtn)
  show(scanBtn)
  scanBtn.disabled = false
  scanBtn.textContent = "Scan"
}

function renderUnauthenticated() {
  show(content)
  hide(loading, pillRow, jobCard, savedBanner, saveBtn, scanBtn, openBtn, autofillSection, previewAutofillBtn, autofillBtn)
  infoText.textContent = "Sign in to Hireoven to use Scout."
  show(infoText)
  setBarLabel("Hireoven Scout", "not signed in")
  show(signinBtn)
}

function renderScanning(message = "Scanning page…") {
  show(content, loading)
  loadingText.textContent = message
  hide(pillRow, jobCard, savedBanner, infoText, autofillSection)
  setBarLabel("Hireoven Scout", "scanning…")
  hide(scanBtn, saveBtn, openBtn, signinBtn, previewAutofillBtn, autofillBtn)
}

function renderPageInfo(info: PageInfoResult) {
  hide(loading, savedBanner, infoText, autofillSection)
  show(content, pillRow)

  const { page, job } = info

  if (!page) {
    pillPageType.textContent = "Unknown Page"
    hide(pillAts, jobCard, saveBtn, openBtn, previewAutofillBtn, autofillBtn)
    infoText.textContent = "Could not read this page."
    show(infoText)
    setBarLabel("No page detected", "")
    show(scanBtn)
    scanBtn.textContent = "Retry"
    return
  }

  pillPageType.textContent = PAGE_TYPE_LABELS[page.pageType] ?? page.pageType
  show(pillRow)

  if (page.ats && page.ats !== "generic") {
    pillAts.textContent = ATS_LABELS[page.ats] ?? page.ats
    show(pillAts)
  } else {
    hide(pillAts)
  }

  // ── Application form → show autofill preview entry point ──────────────────
  if (page.pageType === "application_form") {
    setBarLabel("Application Form", ATS_LABELS[page.ats] ?? "")
    hide(jobCard, saveBtn, scanBtn, signinBtn, openBtn, autofillBtn)
    show(autofillSection)
    previewAutofillBtn.disabled = false
    previewAutofillBtn.textContent = "Preview Autofill"
    show(previewAutofillBtn)
    return
  }

  // ── Job listing → show job card + save button ─────────────────────────────
  currentJob = job

  if (!job || (!job.title && !job.company)) {
    hide(jobCard, saveBtn, previewAutofillBtn, autofillBtn)
    infoText.textContent = "No job data found on this page."
    show(infoText)
    setBarLabel(PAGE_TYPE_LABELS[page.pageType] ?? "Page detected", "no job data")
    show(scanBtn)
    scanBtn.textContent = "Retry"
    return
  }

  jobTitle.textContent = job.title ?? "Untitled Role"
  const metaParts = [job.company, job.location].filter(Boolean)
  jobMeta.textContent = metaParts.join(" · ") || job.url
  if (job.salary) { jobSalary.textContent = job.salary; show(jobSalary) } else { hide(jobSalary) }
  show(jobCard)
  hide(infoText)

  setBarLabel(job.title ?? "Job detected", job.company ?? "")
  hide(scanBtn, signinBtn, previewAutofillBtn, autofillBtn)
  saveBtn.disabled = false
  saveBtn.textContent = "Save job"
  show(saveBtn)
}

function renderSaving() {
  saveBtn.disabled = true
  saveBtn.textContent = "Saving…"
}

function renderSaved(result: SaveResult) {
  savedJobId = result.jobId ?? null
  hide(jobCard, saveBtn, pillRow, infoText, autofillSection, previewAutofillBtn, autofillBtn)
  show(savedBanner, openBtn)
  setBarLabel("Saved to Hireoven", "")
}

function renderAutofillLoading() {
  previewAutofillBtn.disabled = true
  previewAutofillBtn.textContent = "Loading…"
  loadingText.textContent = "Detecting form fields…"
  show(loading)
  hide(fieldList, autofillStats, profileWarning, autofillConfirm, autofillBtn)
}

function renderAutofillPreview(result: AutofillPreviewResult) {
  hide(loading)

  if (result.profileMissing) {
    show(profileWarning)
    hide(autofillStats, fieldList, autofillBtn)
    setBarLabel("Autofill", "profile not set up")
    previewAutofillBtn.disabled = false
    previewAutofillBtn.textContent = "Retry"
    return
  }

  if (!result.formFound || result.fields.length === 0) {
    infoText.textContent = result.formFound
      ? "No recognized fields found in this form."
      : "No application form detected on this page."
    show(infoText)
    hide(autofillStats, fieldList, autofillBtn)
    setBarLabel("Autofill", "no fields found")
    previewAutofillBtn.disabled = false
    previewAutofillBtn.textContent = "Retry"
    return
  }

  // Stats
  statDetected.textContent = `${result.totalFields} detected`
  statMatched.textContent  = `${result.matchedFields} ready`
  show(statDetected, statMatched)
  if (result.reviewFields > 0) {
    statReview.textContent = `${result.reviewFields} need review`
    show(statReview)
  } else {
    hide(statReview)
  }
  show(autofillStats)

  // Field list
  fieldList.innerHTML = ""
  currentAutofillFields = result.fields
  const fillableFields = result.fields.filter((f) => f.type !== "file")
  for (const field of result.fields) {
    fieldList.appendChild(renderFieldRow(field))
  }
  show(fieldList)

  // Hide preview button, show autofill button
  hide(previewAutofillBtn)
  const canFill = fillableFields.filter((f) => f.detectedValue).length > 0
  if (canFill) {
    autofillBtn.disabled = false
    autofillBtn.textContent = "Autofill this application"
    show(autofillBtn)
  } else {
    infoText.textContent = "No fillable fields with profile data found."
    show(infoText)
  }

  setBarLabel(
    "Autofill Preview",
    `${result.matchedFields} of ${result.totalFields} fields ready`
  )
}

function renderFilling() {
  autofillBtn.disabled = true
  autofillBtn.textContent = "Filling fields…"
}

function renderFilled(result: AutofillExecuteResult) {
  hide(autofillBtn, fieldList)
  autofillConfirmTitle.textContent = `${result.filledCount} field${result.filledCount !== 1 ? "s" : ""} filled — review before submitting.`
  show(autofillConfirm)
  setBarLabel("Autofill complete", "review before submitting")
}

// ── Event handlers ─────────────────────────────────────────────────────────────

async function handleScan() {
  renderScanning()

  let authenticated = false
  try {
    const sessionRes = await sendToBackground({ type: "GET_SESSION" })
    authenticated = (sessionRes as SessionResult).authenticated
  } catch {
    authenticated = false
  }

  if (!authenticated) {
    renderUnauthenticated()
    return
  }

  try {
    const pageRes = await sendToBackground({ type: "GET_PAGE_INFO" })
    renderPageInfo(pageRes as PageInfoResult)
  } catch (err) {
    hide(loading)
    infoText.textContent = `Error: ${String(err)}`
    show(content, infoText)
    setBarLabel("Error", "try again")
    show(scanBtn)
    scanBtn.textContent = "Retry"
  }
}

async function handleSave() {
  if (!currentJob) return
  renderSaving()
  try {
    const res = await sendToBackground({ type: "SAVE_JOB", job: currentJob })
    const result = res as SaveResult
    if (result.saved) {
      renderSaved(result)
    } else {
      saveBtn.disabled = false
      saveBtn.textContent = "Retry save"
    }
  } catch {
    saveBtn.disabled = false
    saveBtn.textContent = "Retry save"
  }
}

async function handlePreviewAutofill() {
  renderAutofillLoading()
  try {
    const res = await sendToBackground({ type: "GET_AUTOFILL_PREVIEW" })
    renderAutofillPreview(res as AutofillPreviewResult)
  } catch (err) {
    hide(loading)
    infoText.textContent = `Could not load preview: ${String(err)}`
    show(infoText)
    previewAutofillBtn.disabled = false
    previewAutofillBtn.textContent = "Retry"
    setBarLabel("Error", "try again")
  }
}

async function handleAutofill() {
  const fieldsToFill = currentAutofillFields
    .filter((f) => f.type !== "file" && f.detectedValue)
    .map((f) => ({ elementRef: f.elementRef, value: f.detectedValue }))

  if (fieldsToFill.length === 0) return

  renderFilling()
  try {
    const res = await sendToBackground({ type: "EXECUTE_AUTOFILL", fields: fieldsToFill })
    renderFilled(res as AutofillExecuteResult)
  } catch (err) {
    autofillBtn.disabled = false
    autofillBtn.textContent = "Retry"
    infoText.textContent = `Fill failed: ${String(err)}`
    show(infoText)
  }
}

function handleOpen() {
  const url = savedJobId
    ? `${appOrigin}/dashboard/jobs/${savedJobId}`
    : `${appOrigin}/dashboard/applications`
  chrome.tabs.create({ url })
  window.close()
}

function handleSignIn() {
  chrome.tabs.create({ url: `${appOrigin}/login` })
  window.close()
}

function handleProfileLink(e: Event) {
  e.preventDefault()
  chrome.tabs.create({ url: `${appOrigin}/dashboard/autofill` })
  window.close()
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  const stored = await chrome.storage.local.get("devMode")
  appOrigin = stored.devMode === false ? "https://hireoven.com" : "http://localhost:3000"

  profileLink.href = `${appOrigin}/dashboard/autofill`

  scanBtn.addEventListener("click", () => void handleScan())
  saveBtn.addEventListener("click", () => void handleSave())
  previewAutofillBtn.addEventListener("click", () => void handlePreviewAutofill())
  autofillBtn.addEventListener("click", () => void handleAutofill())
  openBtn.addEventListener("click", handleOpen)
  signinBtn.addEventListener("click", handleSignIn)
  profileLink.addEventListener("click", handleProfileLink)

  renderIdle()
}

document.addEventListener("DOMContentLoaded", () => void boot())
