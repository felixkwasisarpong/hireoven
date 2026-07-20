import { grantDataConsent } from "../utils/consent"

const DEFAULT_APP_ORIGIN =
  __HIREOVEN_EXTENSION_DEFAULT_ORIGIN__ === "https://hireoven.com"
    ? "https://hireoven.com"
    : "http://localhost:3000"

async function resolveAppOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get("devMode")
  if (stored.devMode === true) return "http://localhost:3000"
  if (stored.devMode === false) return "https://hireoven.com"
  return DEFAULT_APP_ORIGIN
}

async function boot(): Promise<void> {
  const appOrigin = await resolveAppOrigin()
  const privacyLink = document.getElementById("privacy-link") as HTMLAnchorElement
  privacyLink.href = `${appOrigin}/privacy#extension`

  document.getElementById("agree-btn")!.addEventListener("click", () => {
    void grantDataConsent().then(() => {
      window.location.href = `${appOrigin}/dashboard`
    })
  })

  document.getElementById("decline-btn")!.addEventListener("click", () => {
    document.getElementById("declined-note")!.classList.add("visible")
  })
}

document.addEventListener("DOMContentLoaded", () => void boot())
