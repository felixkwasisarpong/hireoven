/**
 * Hireoven Scout Bridge — Popup Script
 *
 * Phase 3: Tailor resume before autofill.
 * - Job listing page: scan + save flow (Phase 1)
 * - Application form page: tailor resume preview → approve → autofill (Phase 3)
 *
 * Safety rules:
 *   - Never auto-submit
 *   - Never auto-fill without user clicking "Autofill this application"
 *   - Never upload files automatically
 *   - Never modify original resume — only create a new version draft
 *   - User must approve tailored resume before it is associated with the autofill
 *   - Mark low-confidence fields as "Review"
 */

import type {
  AutofillExecuteResult,
  AutofillPreviewResult,
  BackgroundMessage,
  BackgroundResponse,
  CoverLetterResult,
  DetectedField,
  ExtractedJob,
  PageInfoResult,
  SaveResult,
  SessionResult,
  TailorPreviewResult,
  TailorApproveResult,
  TailorChangePreview,
} from "../types"

// ── DOM refs ───────────────────────────────────────────────────────────────────

const content              = document.getElementById("content")!
const loading              = document.getElementById("loading")!
const loadingText          = document.getElementById("loading-text")!
const pillRow              = document.getElementById("pill-row")!
const pillPageType         = document.getElementById("pill-page-type")!
const pillAts              = document.getElementById("pill-ats")!
const jobCard              = document.getElementById("job-card")!
const jobTitle             = document.getElementById("job-title")!
const jobMeta              = document.getElementById("job-meta")!
const jobSalary            = document.getElementById("job-salary")!
const savedBanner          = document.getElementById("saved-banner")!
const infoText             = document.getElementById("info-text")!
const autofillSection      = document.getElementById("autofill-section")!
const autofillStats        = document.getElementById("autofill-stats")!
const statDetected         = document.getElementById("stat-detected")!
const statMatched          = document.getElementById("stat-matched")!
const statReview           = document.getElementById("stat-review")!
const profileWarning       = document.getElementById("profile-warning")!
const profileLink          = document.getElementById("profile-link") as HTMLAnchorElement
const fieldList            = document.getElementById("field-list")!
const autofillConfirm      = document.getElementById("autofill-confirm")!
const autofillConfirmTitle = document.getElementById("autofill-confirm-title")!

// Documents refs
const docsSection          = document.getElementById("docs-section")!
const docsList             = document.getElementById("docs-list")!

// Tailor refs
const tailorSection        = document.getElementById("tailor-section")!
const tailorSummaryEl      = document.getElementById("tailor-summary")!
const tailorScoreEl        = document.getElementById("tailor-score")!
const changeListEl         = document.getElementById("change-list")!
const tailorApprovedEl     = document.getElementById("tailor-approved")!
const tailorApprovedTitle  = document.getElementById("tailor-approved-title")!
const tailorApprovedSub    = document.getElementById("tailor-approved-sub")!
const tailorDivider        = document.getElementById("tailor-divider")!

const barLabel             = document.getElementById("bar-label")!
const barSub               = document.getElementById("bar-sub")!
const signinBtn            = document.getElementById("signin-btn") as HTMLButtonElement
const scanBtn              = document.getElementById("scan-btn") as HTMLButtonElement
const saveBtn              = document.getElementById("save-btn") as HTMLButtonElement
const tailorBtn            = document.getElementById("tailor-btn") as HTMLButtonElement
const approveTailorBtn     = document.getElementById("approve-tailor-btn") as HTMLButtonElement
const previewAutofillBtn   = document.getElementById("preview-autofill-btn") as HTMLButtonElement
const autofillBtn          = document.getElementById("autofill-btn") as HTMLButtonElement
const openBtn              = document.getElementById("open-btn") as HTMLButtonElement

// ── State ──────────────────────────────────────────────────────────────────────

let currentJob: ExtractedJob | null = null
let savedJobId: string | null = null
let currentAutofillFields: DetectedField[] = []
let currentTailorResumeId: string | null = null
let tailorJobId: string | null = null
let detectedAts: string | null = null
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
  const isCoverLetterText = field.suggestedProfileKey === "cover_letter_text"
  const isDocument = isFile || isCoverLetterText
  const isReady = !field.needsReview && !isDocument && field.detectedValue

  const div = document.createElement("div")
  div.className = `field-row ${isDocument ? "file" : isReady ? "ready" : "review"}`

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
    valueEl.textContent = key === "resume" ? "See Documents section below" : "See Documents section below"
  } else if (isCoverLetterText) {
    valueEl.textContent = "AI-generated — see Documents section below"
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
  if (isDocument) {
    badge.textContent = "Docs"
  } else if (isReady) {
    badge.textContent = "Ready"
  } else {
    badge.textContent = "Review"
  }
  div.appendChild(badge)

  return div
}

// ── Documents section rendering ────────────────────────────────────────────────

function renderDocsSection(docFields: DetectedField[]) {
  docsList.innerHTML = ""

  if (docFields.length === 0) {
    hide(docsSection)
    return
  }

  for (const field of docFields) {
    const isResume = field.suggestedProfileKey === "resume"
    const isCoverLetterFile = field.suggestedProfileKey === "cover_letter"
    const isCoverLetterText = field.suggestedProfileKey === "cover_letter_text"

    const row = document.createElement("div")
    row.className = "doc-row"

    const header = document.createElement("div")
    header.className = "doc-row-header"

    const labelWrap = document.createElement("div")
    const labelEl = document.createElement("div")
    labelEl.className = "doc-label"
    labelEl.textContent = field.label || (isResume ? "Resume upload" : "Cover letter")
    labelWrap.appendChild(labelEl)

    if (isResume) {
      const sub = document.createElement("div")
      sub.className = "doc-label-sub"
      sub.textContent = "Download tailored version → attach manually"
      labelWrap.appendChild(sub)
    }

    header.appendChild(labelWrap)

    if (isResume) {
      // Link to Hireoven resume hub
      const link = document.createElement("a")
      link.className = "doc-action doc-action-green"
      link.href = `${appOrigin}/dashboard/resumes`
      link.target = "_blank"
      link.rel = "noopener"
      link.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open`
      header.appendChild(link)
      row.appendChild(header)
    } else if (isCoverLetterFile || isCoverLetterText) {
      // Generate button
      const genBtn = document.createElement("button")
      genBtn.className = "doc-action doc-action-blue"
      genBtn.textContent = "Generate"
      header.appendChild(genBtn)
      row.appendChild(header)

      // Generated text area (hidden until generated)
      const coverWrap = document.createElement("div")
      coverWrap.className = "doc-cover-wrap hidden"

      const textarea = document.createElement("textarea")
      textarea.className = "doc-cover-textarea"
      textarea.readOnly = false
      textarea.placeholder = "Generating…"
      coverWrap.appendChild(textarea)

      const actionsDiv = document.createElement("div")
      actionsDiv.className = "doc-cover-actions"

      const copyBtn = document.createElement("button")
      copyBtn.className = "doc-btn doc-btn-copy"
      copyBtn.textContent = "Copy"
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(textarea.value)
        copyBtn.textContent = "Copied!"
        setTimeout(() => { copyBtn.textContent = "Copy" }, 1500)
      })
      actionsDiv.appendChild(copyBtn)

      if (isCoverLetterText && field.elementRef) {
        const fillBtn = document.createElement("button")
        fillBtn.className = "doc-btn doc-btn-fill"
        fillBtn.textContent = "Fill into form"
        fillBtn.addEventListener("click", () => {
          const text = textarea.value
          if (!text) return
          fillBtn.textContent = "Filling…"
          fillBtn.disabled = true
          sendToBackground({
            type: "FILL_COVER_LETTER",
            elementRef: field.elementRef,
            text,
          }).then(() => {
            fillBtn.textContent = "Filled!"
          }).catch(() => {
            fillBtn.textContent = "Fill into form"
            fillBtn.disabled = false
          })
        })
        actionsDiv.appendChild(fillBtn)
      }

      coverWrap.appendChild(actionsDiv)
      row.appendChild(coverWrap)

      genBtn.addEventListener("click", () => {
        void handleGenerateCoverLetter(textarea, genBtn, coverWrap)
      })
    }

    docsList.appendChild(row)
  }

  show(docsSection)
}

async function handleGenerateCoverLetter(
  textarea: HTMLTextAreaElement,
  genBtn: HTMLButtonElement,
  coverWrap: HTMLElement
) {
  if (!tailorJobId) {
    textarea.value = "No job context found. Scan and save the job first."
    coverWrap.classList.remove("hidden")
    return
  }

  genBtn.disabled = true
  genBtn.textContent = "Generating…"
  coverWrap.classList.add("hidden")

  try {
    const res = await sendToBackground({
      type: "GENERATE_COVER_LETTER",
      jobId: tailorJobId,
      resumeId: currentTailorResumeId ?? undefined,
      ats: detectedAts ?? undefined,
    })
    const result = res as CoverLetterResult

    if (!result.success || !result.coverLetter) {
      textarea.value = result.error ?? "Generation failed. Try again."
    } else {
      textarea.value = result.coverLetter
    }
  } catch (err) {
    textarea.value = `Generation failed: ${String(err)}`
  }

  coverWrap.classList.remove("hidden")
  genBtn.textContent = "Regenerate"
  genBtn.disabled = false
}

// ── Change row rendering ───────────────────────────────────────────────────────

function renderChangeRow(change: TailorChangePreview): HTMLElement {
  const div = document.createElement("div")
  div.className = "change-row"

  const sectionLabel = change.section === "ats_tip" ? "ATS" : change.section.charAt(0).toUpperCase() + change.section.slice(1)
  const badge = document.createElement("span")
  badge.className = `change-section-badge ${change.section === "ats_tip" ? "ats-tip" : change.section}`
  badge.textContent = sectionLabel
  div.appendChild(badge)

  if (change.after) {
    const after = document.createElement("div")
    after.className = "change-after"
    after.textContent = change.after.slice(0, 120) + (change.after.length > 120 ? "…" : "")
    div.appendChild(after)
  }

  if (change.before && change.before !== change.after) {
    const before = document.createElement("div")
    before.className = "change-before"
    before.textContent = change.before.slice(0, 100) + (change.before.length > 100 ? "…" : "")
    div.appendChild(before)
  }

  if (change.reason) {
    const reason = document.createElement("div")
    reason.className = "change-reason"
    reason.textContent = change.reason
    div.appendChild(reason)
  }

  return div
}

// ── Render states ──────────────────────────────────────────────────────────────

function renderIdle() {
  hide(content)
  setBarLabel("Hireoven Scout", "click to scan")
  hide(signinBtn, saveBtn, openBtn, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
  show(scanBtn)
  scanBtn.disabled = false
  scanBtn.textContent = "Scan"
}

function renderUnauthenticated() {
  show(content)
  hide(loading, pillRow, jobCard, savedBanner, saveBtn, scanBtn, openBtn,
    autofillSection, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
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
  hide(scanBtn, saveBtn, openBtn, signinBtn, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
}

function renderPageInfo(info: PageInfoResult) {
  hide(loading, savedBanner, infoText, autofillSection)
  show(content, pillRow)

  const { page, job } = info

  if (!page) {
    pillPageType.textContent = "Unknown Page"
    hide(pillAts, jobCard, saveBtn, openBtn, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
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

  // ── Application form → show tailor + autofill entry points ────────────────
  if (page.pageType === "application_form") {
    detectedAts = page.ats ?? null
    setBarLabel("Application Form", ATS_LABELS[page.ats] ?? "")
    hide(jobCard, saveBtn, scanBtn, signinBtn, openBtn, autofillBtn, approveTailorBtn)
    show(autofillSection, tailorSection)

    // Extract job data from the page to get a jobId after save
    // We'll get it from savedJobId if the user saved on this page,
    // or from the background state (the extension may have already imported it)
    tailorBtn.disabled = false
    tailorBtn.textContent = "Tailor Resume"
    show(tailorBtn)

    previewAutofillBtn.disabled = false
    previewAutofillBtn.textContent = "Preview Autofill"
    show(previewAutofillBtn)
    return
  }

  // ── Job listing → show job card + save button ─────────────────────────────
  currentJob = job

  if (!job || (!job.title && !job.company)) {
    hide(jobCard, saveBtn, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
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
  hide(scanBtn, signinBtn, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
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
  tailorJobId = result.jobId ?? null
  hide(jobCard, saveBtn, pillRow, infoText, autofillSection, tailorBtn, approveTailorBtn, previewAutofillBtn, autofillBtn)
  show(savedBanner, openBtn)
  setBarLabel("Saved to Hireoven", "")
}

function renderAutofillLoading() {
  previewAutofillBtn.disabled = true
  previewAutofillBtn.textContent = "Loading…"
  previewAutofillBtn.className = "bar-btn bar-btn-primary"
  loadingText.textContent = "Detecting form fields…"
  show(loading)
  hide(fieldList, autofillStats, profileWarning, autofillConfirm, autofillBtn, docsSection)
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
  const fillableFields = result.fields.filter(
    (f) => f.type !== "file" && f.suggestedProfileKey !== "cover_letter_text"
  )
  for (const field of result.fields) {
    fieldList.appendChild(renderFieldRow(field))
  }
  show(fieldList)

  // Documents section (resume upload + cover letter)
  const docFields = result.fields.filter(
    (f) => f.type === "file" || f.suggestedProfileKey === "cover_letter_text"
  )
  renderDocsSection(docFields)

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

// ── Tailor render states ───────────────────────────────────────────────────────

function renderTailorLoading() {
  tailorBtn.disabled = true
  tailorBtn.textContent = "Analyzing…"
  loadingText.textContent = "Analyzing resume vs. job…"
  show(loading)
  // Hide previewAutofillBtn so the user focuses on the tailor review step first
  hide(previewAutofillBtn, tailorSummaryEl, tailorScoreEl, changeListEl, tailorApprovedEl, tailorDivider, approveTailorBtn)
}

function renderTailorPreview(result: TailorPreviewResult) {
  hide(loading)

  if (result.status === "missing_resume") {
    infoText.textContent = result.summary
    show(infoText)
    tailorBtn.disabled = false
    tailorBtn.textContent = "Tailor Resume"
    // Re-surface autofill so user can proceed without tailoring
    previewAutofillBtn.textContent = "Skip & Autofill"
    show(previewAutofillBtn)
    setBarLabel("No resume found", "upload one first")
    return
  }

  if (result.status === "missing_job_context") {
    infoText.textContent = result.summary
    show(infoText)
    tailorBtn.disabled = false
    tailorBtn.textContent = "Retry"
    // Re-surface autofill so user can proceed without tailoring
    previewAutofillBtn.textContent = "Skip & Autofill"
    show(previewAutofillBtn)
    setBarLabel("Missing job info", "")
    return
  }

  // Store resume ID for approve step
  currentTailorResumeId = result.resumeId

  // ATS tip shown before summary if available
  const atsTip = result.atsTip
  const atsName = result.atsName
  if (atsTip) {
    tailorSummaryEl.textContent = atsTip
    tailorSummaryEl.style.color = "#1d4ed8"
    tailorSummaryEl.style.fontWeight = "600"
  } else {
    tailorSummaryEl.textContent = result.summary
    tailorSummaryEl.style.color = ""
    tailorSummaryEl.style.fontWeight = ""
  }
  show(tailorSummaryEl)

  // Main summary shown below as normal text when ATS tip is shown
  if (atsTip && atsName) {
    const subSummary = document.createElement("p")
    subSummary.className = "tailor-summary"
    subSummary.style.marginTop = "4px"
    subSummary.textContent = result.summary
    tailorSummaryEl.insertAdjacentElement("afterend", subSummary)
  }

  // Match score badge
  if (result.matchScore !== null) {
    tailorScoreEl.textContent = `${result.matchScore}% match`
    tailorScoreEl.className = "tailor-score"
    if (result.matchScore >= 75) tailorScoreEl.classList.add("good")
    else if (result.matchScore >= 50) tailorScoreEl.classList.add("ok")
    show(tailorScoreEl)
  }

  // Changes list
  if (result.changesPreview.length > 0) {
    changeListEl.innerHTML = ""
    for (const change of result.changesPreview) {
      changeListEl.appendChild(renderChangeRow(change))
    }
    show(changeListEl)
  } else {
    // No changes needed
    hide(changeListEl)
  }

  // Show approve button (only if there are changes to apply or a resume version to create)
  hide(tailorBtn)
  approveTailorBtn.disabled = false
  approveTailorBtn.textContent = "Use this tailored resume"
  show(approveTailorBtn)
  show(tailorDivider)

  setBarLabel("Resume tailoring ready", result.changesPreview.length > 0
    ? `${result.changesPreview.length} suggestion${result.changesPreview.length !== 1 ? "s" : ""}`
    : "strong match")
}

function renderTailorApproving() {
  approveTailorBtn.disabled = true
  approveTailorBtn.textContent = "Saving draft…"
}

function renderTailorApproved(result: TailorApproveResult) {
  hide(approveTailorBtn, changeListEl, tailorSummaryEl, tailorScoreEl)

  tailorApprovedTitle.textContent = result.versionName ?? "Resume version saved!"
  tailorApprovedSub.textContent = result.matchScore ? `${result.matchScore}% match · version saved` : "New version saved."
  show(tailorApprovedEl)

  // Make the autofill button the obvious primary CTA now that tailoring is done
  previewAutofillBtn.disabled = false
  previewAutofillBtn.textContent = "Autofill Application →"
  previewAutofillBtn.className = "bar-btn bar-btn-primary"
  show(previewAutofillBtn)

  setBarLabel("Resume approved", "click to autofill")
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

async function handleTailorResume() {
  // Get the current job from the active tab to import it if not yet saved
  if (!tailorJobId) {
    // Try to import the job from the current page first
    renderScanning("Importing job…")
    try {
      const pageRes = await sendToBackground({ type: "GET_PAGE_INFO" })
      const info = pageRes as PageInfoResult
      if (info.job) {
        const saveRes = await sendToBackground({ type: "SAVE_JOB", job: info.job })
        const saved = saveRes as SaveResult
        if (saved.jobId) tailorJobId = saved.jobId
      }
    } catch {
      // Proceed without jobId — the preview endpoint will return missing_job_context
    }
    hide(loading)
  }

  if (!tailorJobId) {
    infoText.textContent = "Could not detect job data on this page. Save the job first, then retry."
    show(content, infoText)
    tailorBtn.disabled = false
    tailorBtn.textContent = "Retry"
    return
  }

  renderTailorLoading()
  try {
    const res = await sendToBackground({
      type: "GET_TAILOR_PREVIEW",
      jobId: tailorJobId,
      resumeId: currentTailorResumeId ?? undefined,
      ats: detectedAts ?? undefined,
    })
    renderTailorPreview(res as TailorPreviewResult)
  } catch (err) {
    hide(loading)
    infoText.textContent = `Could not analyze resume: ${String(err)}`
    show(infoText)
    tailorBtn.disabled = false
    tailorBtn.textContent = "Retry"
    previewAutofillBtn.textContent = "Skip & Autofill"
    show(previewAutofillBtn)
    setBarLabel("Error", "try again")
  }
}

async function handleApproveTailoredResume() {
  if (!tailorJobId) return
  renderTailorApproving()
  try {
    const res = await sendToBackground({
      type: "APPROVE_TAILORED_RESUME",
      jobId: tailorJobId,
      resumeId: currentTailorResumeId ?? undefined,
      ats: detectedAts ?? undefined,
    })
    const result = res as TailorApproveResult
    if (!result.success) {
      approveTailorBtn.disabled = false
      approveTailorBtn.textContent = "Retry"
      infoText.textContent = result.error ?? "Could not save tailored resume. Try opening the Resume Hub in Hireoven first."
      show(infoText)
      return
    }
    renderTailorApproved(result)
  } catch (err) {
    approveTailorBtn.disabled = false
    approveTailorBtn.textContent = "Retry"
    infoText.textContent = `Could not save resume version: ${String(err)}`
    show(infoText)
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
  const stored = await chrome.storage.local.get(["devMode", "lastJobId"])
  const isUnpacked = !chrome.runtime.getManifest().update_url
  if (stored.devMode === true) {
    appOrigin = "http://localhost:3000"
  } else if (stored.devMode === false) {
    appOrigin = "https://hireoven.com"
  } else {
    appOrigin = isUnpacked ? "http://localhost:3000" : "https://hireoven.com"
  }

  // Restore jobId from extension storage if available (handles cross-session)
  if (stored.lastJobId) tailorJobId = stored.lastJobId as string

  profileLink.href = `${appOrigin}/dashboard/autofill`

  scanBtn.addEventListener("click", () => void handleScan())
  saveBtn.addEventListener("click", () => void handleSave())
  tailorBtn.addEventListener("click", () => void handleTailorResume())
  approveTailorBtn.addEventListener("click", () => void handleApproveTailoredResume())
  previewAutofillBtn.addEventListener("click", () => void handlePreviewAutofill())
  autofillBtn.addEventListener("click", () => void handleAutofill())
  openBtn.addEventListener("click", handleOpen)
  signinBtn.addEventListener("click", handleSignIn)
  profileLink.addEventListener("click", handleProfileLink)

  renderIdle()
}

document.addEventListener("DOMContentLoaded", () => void boot())
