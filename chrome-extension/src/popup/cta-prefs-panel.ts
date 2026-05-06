/**
 * CTA prefs overlay for the popup. Self-contained: it only attaches to
 * #cta-prefs-overlay and #cta-prefs-toggle if the popup HTML provides them.
 * No edits to popup.ts behavior; importing this module wires it up.
 */

import {
  getCtaPrefs,
  setCtaPref,
  type CtaPref,
} from "../content/aggregators/cta-suppression"
import type { AggregatorSite } from "../content/aggregators/base"

const SITES: AggregatorSite[] = ["linkedin", "glassdoor", "indeed", "handshake"]
const SITE_LABELS: Record<AggregatorSite, string> = {
  linkedin: "LinkedIn",
  glassdoor: "Glassdoor",
  indeed: "Indeed",
  handshake: "Handshake",
}
const PREF_LABELS: Record<CtaPref, string> = {
  always_show: "Always show",
  hide_on_site: "Hide on this site",
  hide_everywhere: "Hide everywhere",
}
const PREF_OPTIONS: CtaPref[] = ["always_show", "hide_on_site", "hide_everywhere"]

function init(): void {
  const overlay = document.getElementById("cta-prefs-overlay")
  const toggle = document.getElementById("cta-prefs-toggle")
  const closeBtn = document.getElementById("cta-prefs-close")
  const list = document.getElementById("cta-prefs-list")
  if (!overlay || !toggle || !closeBtn || !list) return

  toggle.addEventListener("click", () => {
    overlay.classList.remove("hidden")
    void render(list)
  })
  closeBtn.addEventListener("click", () => {
    overlay.classList.add("hidden")
  })
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.classList.add("hidden")
  })
}

async function render(list: HTMLElement): Promise<void> {
  const prefs = await getCtaPrefs()
  list.innerHTML = ""
  for (const site of SITES) {
    const row = document.createElement("div")
    row.style.cssText = [
      "display: flex",
      "flex-direction: column",
      "gap: 4px",
      "padding: 8px 0",
      "border-bottom: 1px solid #f1f5f9",
    ].join(";")

    const label = document.createElement("div")
    label.textContent = SITE_LABELS[site]
    label.style.cssText = "font-weight: 600; font-size: 12px; color: #0f172a"
    row.appendChild(label)

    const select = document.createElement("select")
    select.style.cssText = [
      "font-size: 12px",
      "padding: 4px 6px",
      "border: 1px solid #e2e8f0",
      "border-radius: 6px",
      "background: #fff",
      "color: #0f172a",
    ].join(";")
    for (const opt of PREF_OPTIONS) {
      const o = document.createElement("option")
      o.value = opt
      o.textContent = PREF_LABELS[opt]
      if ((prefs[site] ?? "always_show") === opt) o.selected = true
      select.appendChild(o)
    }
    select.addEventListener("change", () => {
      void setCtaPref(site, select.value as CtaPref)
    })
    row.appendChild(select)
    list.appendChild(row)
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}
