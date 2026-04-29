import { sendToBackground } from "../bridge"
import type {
  SaveResult,
  ScoutOverlayInsightsPayload,
  ScoutOverlayResult,
  SessionResult,
} from "../types"
import {
  extractSiteContext,
  findDetailDescriptionRoot,
  type JobCardSnapshot,
  sponsorshipHintFromText,
  toExtractedJob,
} from "./site-adapters"
import {
  InlineJobIntelligenceLayer,
  type InlineOverlayActions,
  type InlineOverlayModel,
  type OverlayVisaTier,
  type PrimarySignal,
} from "./inline-job-intelligence"
import { ScoutCommandDock } from "./scout-command-dock"
import { SearchFilterLayer, type SearchFilterState } from "./search-filter-layer"
import {
  FocusedIntelligenceLayer,
  type FocusedIntelligenceActions,
  type FocusedIntelligenceModel,
} from "./focused-intelligence-layer"

const STATE_STORAGE_KEY = "ho_overlay_state_v2"
const APPLY_HIDDEN_ATTR = "data-ho-filter-hidden"
const SKILL_HIGHLIGHT_STYLE_ID = "hireoven-skill-highlight-style"
const SKILL_HIGHLIGHT_ATTR = "data-ho-skill-hit"

const SKILL_LIBRARY = [
  "Python",
  "TypeScript",
  "JavaScript",
  "React",
  "Node.js",
  "AWS",
  "Docker",
  "Kubernetes",
  "Kafka",
  "SQL",
  "PostgreSQL",
  "Machine Learning",
  "TensorFlow",
  "PyTorch",
  "Spark",
  "GraphQL",
  "REST",
]

interface PersistedEntry {
  canonicalId: string
  savedJobId: string | null
  compare: boolean
  queuedApply: boolean
  insights: ScoutOverlayInsightsPayload | null
}

interface PersistedState {
  byCanonicalId: Record<string, PersistedEntry>
}

interface CardRuntimeState {
  key: string
  canonicalId: string
  card: JobCardSnapshot
  savedJobId: string | null
  insights: ScoutOverlayInsightsPayload | null
  compare: boolean
  queuedApply: boolean
  busy: boolean
}

interface OverlaySystemOptions {
  resolveAppOrigin: () => Promise<string>
}

interface SkillDiff {
  matched: string[]
  missing: string[]
  matchedOverflow: number
  missingOverflow: number
}

interface SkillSet {
  matched: string[]
  missing: string[]
}

interface CanonicalSyncOptions {
  busy?: boolean
}

function defaultPersistedState(): PersistedState {
  return { byCanonicalId: {} }
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function canonicalIdForCard(card: JobCardSnapshot): string {
  if (card.url) {
    try {
      const u = new URL(card.url)
      const host = u.hostname.replace(/^www\./, "").toLowerCase()
      if (host.includes("linkedin.com")) {
        const m = u.pathname.match(/\/jobs\/view\/(\d+)/)
        if (m?.[1]) return `linkedin:${m[1]}`
      }
      return `${host}${u.pathname}`
    } catch {
      // fallback below
    }
  }
  return `${card.site}:${norm(card.title)}|${norm(card.company)}|${norm(card.location)}`
}

function truncate(s: string | null | undefined, n: number): string {
  const t = (s ?? "").trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}...`
}

function scoreTier(matchPercent: number | null): "high" | "medium" | "low" {
  if (matchPercent == null) return "low"
  if (matchPercent >= 78) return "high"
  if (matchPercent >= 58) return "medium"
  return "low"
}

function detectSkillMatches(card: JobCardSnapshot): string[] {
  const source = `${card.title ?? ""} ${card.description ?? ""}`.toLowerCase()
  const found: string[] = []
  for (const skill of SKILL_LIBRARY) {
    const token = skill.toLowerCase().replace(/[.+]/g, "\\$&")
    const re = new RegExp(`\\b${token}\\b`, "i")
    if (re.test(source)) found.push(skill)
  }
  return found
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = norm(v)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export class ScoutOverlaySystem {
  private readonly options: OverlaySystemOptions
  private appOrigin = "http://localhost:3000"
  private isAuthenticated = false
  private mounted = false
  private disposed = false

  private readonly overlays = new Map<string, InlineJobIntelligenceLayer>()
  private readonly cardStates = new Map<string, CardRuntimeState>()
  private orderedKeys: string[] = []

  private hoveredKey: string | null = null
  private selectedKey: string | null = null
  private panelHovering = false

  private currentUrl = window.location.href

  private persisted: PersistedState = defaultPersistedState()
  private persistTimer: number | null = null
  private scanTimer: number | null = null
  private urlTimer: number | null = null
  private hoverLeaveTimer: number | null = null

  private observer: MutationObserver | null = null
  private readonly onScrollResize: () => void = () => this.scheduleScan(140)

  private dock: ScoutCommandDock | null = null
  private filterLayer: SearchFilterLayer | null = null
  private intelligenceLayer: FocusedIntelligenceLayer | null = null
  private filterState: SearchFilterState = {
    visaFriendly: false,
    remoteFirst: false,
    highResponseLikelihood: false,
    highSponsorshipProbability: false,
    highMatch: false,
    tailorWorthy: false,
  }
  private highlightedSkillRoot: HTMLElement | null = null
  private highlightedSkillSignature: string | null = null

  private readonly indicatorActions: InlineOverlayActions = {
    onHover: (key) => {
      if (this.hoverLeaveTimer) {
        window.clearTimeout(this.hoverLeaveTimer)
        this.hoverLeaveTimer = null
      }
      this.hoveredKey = key
      this.refreshVisuals()
    },
    onLeave: (key) => {
      if (this.hoveredKey !== key) return
      if (this.hoverLeaveTimer) window.clearTimeout(this.hoverLeaveTimer)
      this.hoverLeaveTimer = window.setTimeout(() => {
        this.hoverLeaveTimer = null
        if (this.panelHovering) return
        if (this.hoveredKey === key) {
          this.hoveredKey = null
          this.refreshVisuals()
        }
      }, 220)
    },
    onSelect: (key) => {
      this.selectedKey = this.selectedKey === key ? null : key
      this.hoveredKey = key
      this.refreshVisuals()
    },
  }

  private readonly intelligenceActions: FocusedIntelligenceActions = {
    onRunCheck: (key) => {
      void this.runCheckForKey(key)
    },
    onTailor: (key) => {
      void this.tailorCardByKey(key)
    },
    onCompare: (key) => {
      this.toggleCompare(key)
    },
    onQueueApply: (key) => {
      this.toggleQueueApply(key)
    },
    onAutofill: () => {
      window.open(`${this.appOrigin}/dashboard/autofill`, "_blank", "noopener")
    },
    onCheckVisa: (key) => {
      void this.runCheckForKey(key)
    },
    onClose: () => {
      this.hoveredKey = null
      this.selectedKey = null
      this.refreshVisuals()
    },
    onPanelHoverChange: (hovering) => {
      this.panelHovering = hovering
      if (hovering) {
        if (this.hoverLeaveTimer) {
          window.clearTimeout(this.hoverLeaveTimer)
          this.hoverLeaveTimer = null
        }
        return
      }
      if (this.selectedKey) return
      if (this.hoverLeaveTimer) window.clearTimeout(this.hoverLeaveTimer)
      this.hoverLeaveTimer = window.setTimeout(() => {
        this.hoverLeaveTimer = null
        if (this.panelHovering || this.selectedKey) return
        this.hoveredKey = null
        this.refreshVisuals()
      }, 130)
    },
  }

  constructor(options: OverlaySystemOptions) {
    this.options = options
  }

  async mount(): Promise<void> {
    if (this.mounted || this.disposed) return
    this.mounted = true
    this.cleanupLegacyOverlayHosts()
    this.ensureSkillHighlightStyle()

    this.appOrigin = await this.options.resolveAppOrigin()
    await this.loadPersistedState()
    await this.refreshSession()

    this.dock = new ScoutCommandDock({
      onTailor: () => {
        const key = this.getContextKey()
        if (!key) return
        void this.tailorCardByKey(key)
      },
      onCheckVisa: () => {
        const key = this.getContextKey()
        if (!key) return
        void this.runCheckForKey(key)
      },
      onAutofill: () => {
        window.open(`${this.appOrigin}/dashboard/autofill`, "_blank", "noopener")
      },
      onCompare: () => {
        const key = this.getContextKey()
        if (!key) return
        this.toggleCompare(key)
      },
      onQueueApply: () => {
        const key = this.getContextKey()
        if (!key) return
        this.toggleQueueApply(key)
      },
    })

    this.filterLayer = new SearchFilterLayer({
      onChange: (state) => {
        this.filterState = state
        this.applyFilterStateToCards()
        this.refreshVisuals()
      },
    })
    this.filterLayer.setVisible(false)

    this.intelligenceLayer = new FocusedIntelligenceLayer(this.intelligenceActions)

    this.bindObservers()
    this.scheduleScan(20)
  }

  private cleanupLegacyOverlayHosts(): void {
    const staleIds = ["hireoven-scout-overlay-host", "hireoven-scout-bar-host"]
    for (const id of staleIds) {
      const el = document.getElementById(id)
      if (el) el.remove()
    }
  }

  private ensureSkillHighlightStyle(): void {
    if (document.getElementById(SKILL_HIGHLIGHT_STYLE_ID)) return
    const style = document.createElement("style")
    style.id = SKILL_HIGHLIGHT_STYLE_ID
    style.textContent = `
      span.ho-skill-hit-match[${SKILL_HIGHLIGHT_ATTR}="1"] {
        background: rgba(34,197,94,0.18);
        color: #14532d;
        border-radius: 4px;
        box-shadow: inset 0 -1px 0 rgba(34,197,94,0.4);
      }
      span.ho-skill-hit-miss[${SKILL_HIGHLIGHT_ATTR}="1"] {
        background: rgba(249,115,22,0.2);
        color: #9a3412;
        border-radius: 4px;
        box-shadow: inset 0 -1px 0 rgba(249,115,22,0.42);
      }
    `
    document.documentElement.appendChild(style)
  }

  private removeSkillHighlightStyle(): void {
    const el = document.getElementById(SKILL_HIGHLIGHT_STYLE_ID)
    if (el) el.remove()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.scanTimer) window.clearTimeout(this.scanTimer)
    if (this.persistTimer) window.clearTimeout(this.persistTimer)
    if (this.urlTimer) window.clearInterval(this.urlTimer)
    if (this.hoverLeaveTimer) window.clearTimeout(this.hoverLeaveTimer)
    this.clearSkillHighlights()

    this.observer?.disconnect()
    this.observer = null

    window.removeEventListener("scroll", this.onScrollResize, true)
    window.removeEventListener("resize", this.onScrollResize)

    for (const layer of this.overlays.values()) layer.destroy()
    this.overlays.clear()

    this.restoreAllFilteredCards()

    this.cardStates.clear()
    this.orderedKeys = []

    this.dock?.destroy()
    this.dock = null
    this.filterLayer?.destroy()
    this.filterLayer = null
    this.intelligenceLayer?.destroy()
    this.intelligenceLayer = null
    this.removeSkillHighlightStyle()
  }

  private bindObservers(): void {
    this.observer = new MutationObserver(() => this.scheduleScan(160))
    if (document.body) this.observer.observe(document.body, { childList: true, subtree: true })

    window.addEventListener("scroll", this.onScrollResize, true)
    window.addEventListener("resize", this.onScrollResize)

    this.urlTimer = window.setInterval(() => {
      const next = window.location.href
      if (next === this.currentUrl) return
      this.currentUrl = next
      this.hoveredKey = null
      this.selectedKey = null
      this.clearSkillHighlights()
      this.restoreAllFilteredCards()
      for (const layer of this.overlays.values()) layer.destroy()
      this.overlays.clear()
      this.cardStates.clear()
      this.orderedKeys = []
      this.intelligenceLayer?.hide()
      this.scheduleScan(90)
    }, 420)
  }

  private scheduleScan(delayMs: number): void {
    if (this.disposed) return
    if (this.scanTimer) window.clearTimeout(this.scanTimer)
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null
      this.scanDom()
    }, delayMs)
  }

  private scanDom(): void {
    if (this.disposed) return

    const context = extractSiteContext()
    const cards = context.cards.filter((card) => card.host.isConnected)
    this.filterLayer?.setVisible(context.isSearchPage && cards.length > 1)

    const seen = new Set<string>()
    const nextOrder: string[] = []

    for (const card of cards) {
      const key = card.key
      seen.add(key)
      nextOrder.push(key)

      const existing = this.cardStates.get(key)
      if (existing) {
        existing.card = card
        continue
      }

      const canonicalId = canonicalIdForCard(card)
      const seeded = this.persisted.byCanonicalId[canonicalId]
      const sibling = this.findStateByCanonicalId(canonicalId)
      this.cardStates.set(key, {
        key,
        canonicalId,
        card,
        savedJobId: sibling?.savedJobId ?? seeded?.savedJobId ?? null,
        insights: sibling?.insights ?? seeded?.insights ?? null,
        compare: sibling?.compare ?? seeded?.compare ?? false,
        queuedApply: sibling?.queuedApply ?? seeded?.queuedApply ?? false,
        busy: false,
      })
    }

    for (const [key, layer] of this.overlays) {
      if (seen.has(key)) continue
      layer.destroy()
      this.overlays.delete(key)
      this.cardStates.delete(key)
    }

    this.orderedKeys = nextOrder

    if (this.hoveredKey && !this.cardStates.has(this.hoveredKey)) this.hoveredKey = null
    if (this.selectedKey && !this.cardStates.has(this.selectedKey)) this.selectedKey = null

    for (const key of this.orderedKeys) {
      const state = this.cardStates.get(key)
      if (!state) continue
      const model = this.buildIndicatorModel(state)
      const existing = this.overlays.get(key)
      if (existing) {
        existing.update(state.card, model)
      } else {
        this.overlays.set(key, new InlineJobIntelligenceLayer(state.card, model, this.indicatorActions))
      }
    }

    this.applyFilterStateToCards()
    this.refreshVisuals()
  }

  private refreshVisuals(): void {
    const contextKey = this.getContextKey()

    for (const key of this.orderedKeys) {
      const state = this.cardStates.get(key)
      const overlay = this.overlays.get(key)
      if (!state || !overlay) continue
      overlay.update(state.card, this.buildIndicatorModel(state))
    }

    const context = contextKey ? this.cardStates.get(contextKey) ?? null : null
    const visaLabel = this.resolveDockVisaLabel(context)

    this.dock?.update({
      title: truncate(context?.card.title ?? context?.card.company ?? "Scout", 56),
      focused: Boolean(context),
      busy: Boolean(context?.busy),
      compare: Boolean(context?.compare),
      queuedApply: Boolean(context?.queuedApply),
      checkVisaLabel: visaLabel,
    })

    this.refreshDetailSkillHighlights()

    const expandedKey = this.getExpandedKey()
    if (!expandedKey) {
      this.intelligenceLayer?.hide()
      return
    }

    const expandedState = this.cardStates.get(expandedKey)
    const expandedOverlay = this.overlays.get(expandedKey)
    if (!expandedState || !expandedOverlay || !this.isVisibleKey(expandedKey)) {
      this.intelligenceLayer?.hide()
      return
    }

    const model = this.buildFocusedModel(expandedState)
    const anchor = expandedOverlay.anchorRect()
    this.intelligenceLayer?.show(model, anchor)
  }

  private getExpandedKey(): string | null {
    const hover = this.hoveredKey && this.isVisibleKey(this.hoveredKey) ? this.hoveredKey : null
    if (hover) return hover

    const selected = this.selectedKey && this.isVisibleKey(this.selectedKey) ? this.selectedKey : null
    if (selected) return selected

    return null
  }

  private getContextKey(): string | null {
    const hover = this.hoveredKey && this.isVisibleKey(this.hoveredKey) ? this.hoveredKey : null
    if (hover) return hover

    const selected = this.selectedKey && this.isVisibleKey(this.selectedKey) ? this.selectedKey : null
    if (selected) return selected

    const detail = this.orderedKeys.find((key) => {
      const state = this.cardStates.get(key)
      return Boolean(state && state.card.role === "detail" && this.isVisibleKey(key))
    })
    if (detail) return detail

    const firstVisible = this.orderedKeys.find((key) => this.isVisibleKey(key))
    return firstVisible ?? null
  }

  private buildIndicatorModel(state: CardRuntimeState): InlineOverlayModel {
    const insights = state.insights
    const fallbackVisa = sponsorshipHintFromText(state.card)

    const matchPercent = insights?.matchPercent ?? null
    const matchLabel = matchPercent != null ? `${Math.max(0, Math.min(100, Math.round(matchPercent)))}%` : "--"

    const visaTier: OverlayVisaTier =
      insights?.sponsorshipLikely === true
        ? "positive"
        : insights?.sponsorshipLikely === false
        ? "warn"
        : fallbackVisa === true || Boolean(insights?.sponsorshipLabel)
        ? "neutral"
        : "none"

    const visaLabel =
      insights?.sponsorshipLabel?.trim() ||
      (insights?.sponsorshipLikely === true
        ? "Visa likely"
        : insights?.sponsorshipLikely === false
        ? "Visa caution"
        : fallbackVisa === true
        ? "Check visa"
        : "No visa signal")

    const missingCount = insights?.missingSkills?.length ?? 0

    let primarySignal: PrimarySignal = "check"
    if (state.queuedApply) primarySignal = "queue"
    else if (state.busy || !insights) primarySignal = "check"
    else if (insights.sponsorshipLikely === false) primarySignal = "visa"
    else if (missingCount > 0 || scoreTier(matchPercent) === "low") primarySignal = "tailor"
    else primarySignal = "match"

    const contextKey = this.getContextKey()

    return {
      key: state.key,
      role: state.card.role,
      matchPercent,
      matchLabel,
      visaTier,
      visaLabel,
      primarySignal,
      active: contextKey === state.key,
      selected: this.selectedKey === state.key,
      checked: Boolean(insights),
    }
  }

  private deriveSkillSet(state: CardRuntimeState): SkillSet {
    const detected = detectSkillMatches(state.card)
    const missingRaw = uniqueStrings(
      state.insights?.missingSkills?.length
        ? state.insights.missingSkills
        : [],
    )

    const missingNorm = new Set(missingRaw.map((v) => norm(v)))
    const matchedRaw = uniqueStrings(
      detected.filter((skill) => !missingNorm.has(norm(skill))),
    )

    return {
      matched: matchedRaw,
      missing: missingRaw,
    }
  }

  private deriveSkillDiff(state: CardRuntimeState): SkillDiff {
    const full = this.deriveSkillSet(state)

    const matched = full.matched.slice(0, 4)
    const missing = full.missing.slice(0, 4)

    return {
      matched,
      missing,
      matchedOverflow: Math.max(0, full.matched.length - matched.length),
      missingOverflow: Math.max(0, full.missing.length - missing.length),
    }
  }

  private getVisibleDetailState(): CardRuntimeState | null {
    const key = this.orderedKeys.find((candidate) => {
      const state = this.cardStates.get(candidate)
      return Boolean(state && state.card.role === "detail" && this.isVisibleKey(candidate))
    })
    if (!key) return null
    return this.cardStates.get(key) ?? null
  }

  private refreshDetailSkillHighlights(): void {
    const detail = this.getVisibleDetailState()
    if (!detail?.insights) {
      this.clearSkillHighlights()
      return
    }

    const root = findDetailDescriptionRoot(detail.card)
    if (!root || !root.isConnected) {
      this.clearSkillHighlights()
      return
    }

    const skillSet = this.deriveSkillSet(detail)
    const matched = skillSet.matched
    const missing = skillSet.missing

    if (matched.length === 0 && missing.length === 0) {
      this.clearSkillHighlights(root)
      return
    }

    const signature = [
      detail.canonicalId,
      root.textContent?.length ?? 0,
      matched.join("|"),
      missing.join("|"),
    ].join("::")

    if (this.highlightedSkillRoot === root && this.highlightedSkillSignature === signature) {
      return
    }

    if (this.highlightedSkillRoot && this.highlightedSkillRoot !== root) {
      this.clearSkillHighlights(this.highlightedSkillRoot)
    } else {
      this.clearSkillHighlights(root)
    }

    this.applySkillHighlights(root, matched, missing)
    this.highlightedSkillRoot = root
    this.highlightedSkillSignature = signature
  }

  private applySkillHighlights(root: HTMLElement, matched: string[], missing: string[]): void {
    const kindBySkill = new Map<string, "match" | "miss">()
    for (const skill of missing) kindBySkill.set(norm(skill), "miss")
    for (const skill of matched) {
      const key = norm(skill)
      if (!kindBySkill.has(key)) kindBySkill.set(key, "match")
    }

    const terms = uniqueStrings([...missing, ...matched]).sort((a, b) => b.length - a.length)
    if (terms.length === 0) return

    const alternates = terms.map((term) => escRe(term)).join("|")
    if (!alternates) return

    const pattern = new RegExp(`(^|[^A-Za-z0-9])(${alternates})(?=$|[^A-Za-z0-9])`, "gi")
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node): number => {
          if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
          if (parent.closest(`[${SKILL_HIGHLIGHT_ATTR}="1"]`)) return NodeFilter.FILTER_REJECT
          if (
            parent.closest(
              "#hireoven-focused-intelligence-layer,#hireoven-scout-command-dock,#hireoven-search-filter-layer",
            )
          ) {
            return NodeFilter.FILTER_REJECT
          }
          if (
            ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "BUTTON"].includes(
              parent.tagName,
            )
          ) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        },
      },
    )

    const nodes: Text[] = []
    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text)
    }

    for (const node of nodes) {
      const source = node.nodeValue ?? ""
      pattern.lastIndex = 0

      let cursor = 0
      let hit = false
      const frag = document.createDocumentFragment()
      let match: RegExpExecArray | null = pattern.exec(source)

      while (match) {
        const lead = match[1] ?? ""
        const token = match[2] ?? ""
        const start = match.index + lead.length
        const end = start + token.length
        if (end <= cursor) {
          match = pattern.exec(source)
          continue
        }

        if (start > cursor) {
          frag.appendChild(document.createTextNode(source.slice(cursor, start)))
        }

        const kind = kindBySkill.get(norm(token))
        if (!kind) {
          frag.appendChild(document.createTextNode(token))
        } else {
          const mark = document.createElement("span")
          mark.setAttribute(SKILL_HIGHLIGHT_ATTR, "1")
          mark.className = kind === "match" ? "ho-skill-hit-match" : "ho-skill-hit-miss"
          mark.textContent = token
          frag.appendChild(mark)
          hit = true
        }

        cursor = end
        match = pattern.exec(source)
      }

      if (!hit) continue
      if (cursor < source.length) {
        frag.appendChild(document.createTextNode(source.slice(cursor)))
      }
      node.parentNode?.replaceChild(frag, node)
    }
  }

  private clearSkillHighlights(root?: HTMLElement | null): void {
    const target = root ?? this.highlightedSkillRoot
    if (!target) {
      this.highlightedSkillRoot = null
      this.highlightedSkillSignature = null
      return
    }

    target.querySelectorAll<HTMLElement>(`span[${SKILL_HIGHLIGHT_ATTR}="1"]`).forEach((el) => {
      const parent = el.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el)
      parent.normalize()
    })

    if (!root || root === this.highlightedSkillRoot) {
      this.highlightedSkillRoot = null
      this.highlightedSkillSignature = null
    }
  }

  private buildFocusedModel(state: CardRuntimeState): FocusedIntelligenceModel {
    const insights = state.insights
    const skillDiff = this.deriveSkillDiff(state)
    const matchLabel = insights?.matchPercent != null
      ? `${Math.max(0, Math.min(100, Math.round(insights.matchPercent)))}%`
      : "--"

    const visaLabel =
      insights?.sponsorshipLabel?.trim() ||
      (insights?.sponsorshipLikely === true
        ? "Visa likely"
        : insights?.sponsorshipLikely === false
        ? "Visa caution"
        : sponsorshipHintFromText(state.card) === true
        ? "Check visa"
        : "No visa signal")

    const recommendation =
      !state.savedJobId
        ? "Run check to save and score this job with sponsorship intelligence."
        : !insights
        ? "Run check to load the latest match and visa intelligence."
        : insights.sponsorshipLikely === false
        ? "Sponsorship risk detected. Compare before queueing apply."
        : skillDiff.missing.length > 0
        ? "Tailor first, then apply."
        : scoreTier(insights.matchPercent) === "high"
        ? "Strong fit. Move quickly with tailored resume."
        : "Review and compare before queueing apply."

    const whyItMatters =
      truncate(insights?.resumeAlignmentNote, 180) ||
      truncate(insights?.visaInsight, 180) ||
      recommendation

    return {
      key: state.key,
      role: state.card.role,
      title: state.card.title ?? "Job",
      company: state.card.company,
      matchLabel,
      visaLabel,
      whyItMatters,
      recommendation,
      matchedSkills: skillDiff.matched,
      missingSkills: skillDiff.missing,
      matchedOverflow: skillDiff.matchedOverflow,
      missingOverflow: skillDiff.missingOverflow,
      busy: state.busy,
      checked: Boolean(insights),
      compare: state.compare,
      queuedApply: state.queuedApply,
    }
  }

  private resolveDockVisaLabel(state: CardRuntimeState | null): string {
    if (!state) return "Check visa"
    if (state.busy) return "Checking..."

    const insights = state.insights
    if (!insights) return "Check visa"

    if (insights.sponsorshipLikely === true) return "Visa likely"
    if (insights.sponsorshipLikely === false) return "Visa caution"
    if (insights.sponsorshipLabel) return truncate(insights.sponsorshipLabel, 16)

    return "Check visa"
  }

  private async runCheckForKey(key: string): Promise<void> {
    const state = this.cardStates.get(key)
    if (!state || state.busy) return

    if (!this.isAuthenticated) {
      window.open(`${this.appOrigin}/login`, "_blank", "noopener")
      return
    }

    state.busy = true
    this.syncCanonicalState(state, { busy: true })
    this.refreshVisuals()

    try {
      if (!state.savedJobId) {
        const rawSave = await sendToBackground({
          type: "SAVE_JOB",
          job: toExtractedJob(state.card),
        })
        const saveRes = rawSave as SaveResult
        if (!saveRes?.saved) return
        state.savedJobId = saveRes.jobId ?? state.savedJobId
        this.syncCanonicalState(state)
      }

      if (!state.savedJobId) return
      await this.fetchInsightsForState(state, true)
      this.syncCanonicalState(state)
      this.persistFromState(state)
    } finally {
      state.busy = false
      this.syncCanonicalState(state, { busy: false })
      this.refreshVisuals()
    }
  }

  private async fetchInsightsForState(state: CardRuntimeState, force: boolean): Promise<void> {
    if (!state.savedJobId) return
    if (!force && state.insights) return

    const raw = await sendToBackground({
      type: "GET_SCOUT_OVERLAY",
      jobId: state.savedJobId,
    })

    const res = raw as ScoutOverlayResult
    if (!res?.ok || res.type !== "SCOUT_OVERLAY_RESULT") return

    state.insights = {
      ok: true,
      matchPercent: res.matchPercent,
      sponsorshipLikely: res.sponsorshipLikely,
      sponsorshipLabel: res.sponsorshipLabel,
      visaInsight: res.visaInsight,
      missingSkills: res.missingSkills,
      resumeAlignmentNote: res.resumeAlignmentNote,
      autofillReady: res.autofillReady,
      jobIntelligenceStale: res.jobIntelligenceStale,
    }
  }

  private async tailorCardByKey(key: string): Promise<void> {
    const state = this.cardStates.get(key)
    if (!state) return

    if (!this.isAuthenticated) {
      window.open(`${this.appOrigin}/login`, "_blank", "noopener")
      return
    }

    if (!state.savedJobId) {
      await this.runCheckForKey(key)
    }

    const resolved = this.cardStates.get(key)
    if (!resolved?.savedJobId) return

    const url = `${this.appOrigin}/dashboard/resume/studio?mode=tailor&jobId=${encodeURIComponent(
      resolved.savedJobId,
    )}`
    window.open(url, "_blank", "noopener")
  }

  private toggleCompare(key: string): void {
    const state = this.cardStates.get(key)
    if (!state) return
    state.compare = !state.compare
    this.syncCanonicalState(state)
    this.persistFromState(state)
    this.refreshVisuals()
  }

  private toggleQueueApply(key: string): void {
    const state = this.cardStates.get(key)
    if (!state) return
    state.queuedApply = !state.queuedApply
    this.syncCanonicalState(state)
    this.persistFromState(state)
    this.refreshVisuals()
  }

  private findStateByCanonicalId(canonicalId: string): CardRuntimeState | null {
    for (const state of this.cardStates.values()) {
      if (state.canonicalId === canonicalId) return state
    }
    return null
  }

  private syncCanonicalState(source: CardRuntimeState, options?: CanonicalSyncOptions): void {
    for (const state of this.cardStates.values()) {
      if (state.canonicalId !== source.canonicalId) continue
      state.savedJobId = source.savedJobId
      state.insights = source.insights
      state.compare = source.compare
      state.queuedApply = source.queuedApply
      if (typeof options?.busy === "boolean") {
        state.busy = options.busy
      }
    }
  }

  private passesFilters(state: CardRuntimeState): boolean {
    if (state.card.role === "detail") return true

    const f = this.filterState
    if (
      !f.visaFriendly &&
      !f.remoteFirst &&
      !f.highResponseLikelihood &&
      !f.highSponsorshipProbability &&
      !f.highMatch &&
      !f.tailorWorthy
    ) {
      return true
    }

    const insights = state.insights
    const sponsorship = insights?.sponsorshipLikely ?? sponsorshipHintFromText(state.card)
    const match = insights?.matchPercent ?? null
    const missingCount = insights?.missingSkills?.length ?? 0

    const source = `${state.card.title ?? ""} ${state.card.location ?? ""} ${state.card.description ?? ""}`.toLowerCase()
    const remote = /\bremote\b|work\s+from\s+home|distributed|anywhere/.test(source)
    const highResponse = scoreTier(match) === "high" && missingCount <= 2
    const highSponsor = sponsorship === true || /(sponsor|h-1b|h1b|opt)/.test(source)
    const highMatch = match != null && match >= 75
    const tailorWorthy = missingCount > 0 || (match != null && match >= 45 && match < 80)

    if (f.visaFriendly && sponsorship !== true) return false
    if (f.remoteFirst && !remote) return false
    if (f.highResponseLikelihood && !highResponse) return false
    if (f.highSponsorshipProbability && !highSponsor) return false
    if (f.highMatch && !highMatch) return false
    if (f.tailorWorthy && !tailorWorthy) return false

    return true
  }

  private applyFilterStateToCards(): void {
    for (const key of this.orderedKeys) {
      const state = this.cardStates.get(key)
      const overlay = this.overlays.get(key)
      if (!state || !overlay) continue

      const pass = this.passesFilters(state)
      const host = state.card.host

      if (pass) {
        if (host.hasAttribute(APPLY_HIDDEN_ATTR)) {
          host.removeAttribute(APPLY_HIDDEN_ATTR)
          const prev = host.dataset.hoPrevDisplay ?? ""
          host.style.display = prev
          delete host.dataset.hoPrevDisplay
        }
        overlay.setHidden(false)
      } else {
        if (!host.hasAttribute(APPLY_HIDDEN_ATTR)) {
          host.dataset.hoPrevDisplay = host.style.display
          host.style.display = "none"
          host.setAttribute(APPLY_HIDDEN_ATTR, "1")
        }
        overlay.setHidden(true)
      }
    }

    if (this.hoveredKey && !this.isVisibleKey(this.hoveredKey)) this.hoveredKey = null
    if (this.selectedKey && !this.isVisibleKey(this.selectedKey)) this.selectedKey = null
  }

  private isVisibleKey(key: string): boolean {
    const state = this.cardStates.get(key)
    if (!state) return false
    if (!state.card.host.isConnected) return false
    if (!this.passesFilters(state)) return false
    return state.card.host.style.display !== "none"
  }

  private restoreAllFilteredCards(): void {
    for (const state of this.cardStates.values()) {
      const host = state.card.host
      if (!host.hasAttribute(APPLY_HIDDEN_ATTR)) continue
      const prev = host.dataset.hoPrevDisplay ?? ""
      host.style.display = prev
      delete host.dataset.hoPrevDisplay
      host.removeAttribute(APPLY_HIDDEN_ATTR)
    }
  }

  private async refreshSession(): Promise<void> {
    try {
      const raw = await sendToBackground({ type: "GET_SESSION" })
      const session = raw as SessionResult
      this.isAuthenticated = Boolean(session?.authenticated)
    } catch {
      this.isAuthenticated = false
    }
  }

  private async loadPersistedState(): Promise<void> {
    this.persisted = await new Promise<PersistedState>((resolve) => {
      chrome.storage.local.get([STATE_STORAGE_KEY], (raw: Record<string, unknown>) => {
        const hit = raw[STATE_STORAGE_KEY]
        if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
          resolve(defaultPersistedState())
          return
        }

        const parsed = hit as PersistedState
        if (!parsed.byCanonicalId || typeof parsed.byCanonicalId !== "object") {
          resolve(defaultPersistedState())
          return
        }

        resolve(parsed)
      })
    })
  }

  private persistFromState(state: CardRuntimeState): void {
    this.persisted.byCanonicalId[state.canonicalId] = {
      canonicalId: state.canonicalId,
      savedJobId: state.savedJobId,
      compare: state.compare,
      queuedApply: state.queuedApply,
      insights: state.insights,
    }
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) window.clearTimeout(this.persistTimer)
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null
      void chrome.storage.local.set({ [STATE_STORAGE_KEY]: this.persisted })
    }, 180)
  }
}
