/**
 * Keyword Highlighter
 *
 * Wraps matched/missing keywords in colored <mark> spans inside a JD root.
 * - Green (matched): skills present in user resume vs. JD
 * - Orange/red (missing): skills in JD that the resume lacks
 *
 * Safety: read-only DOM mutations, fully reversible via clearHighlights().
 */

const HIGHLIGHT_STYLE_ID = "ho-keyword-highlight-style"
const HIGHLIGHT_CLASS = "ho-kw"

const HIGHLIGHT_CSS = `
.ho-kw {
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 600;
}
.ho-kw.matched {
  background: rgba(16, 185, 129, 0.14);
  color: #065f46;
  border-bottom: 1.5px solid rgba(16, 185, 129, 0.55);
}
.ho-kw.missing {
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
  border-bottom: 1.5px solid rgba(245, 158, 11, 0.55);
}
`

function injectHighlightStyle(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = HIGHLIGHT_STYLE_ID
  style.textContent = HIGHLIGHT_CSS
  ;(document.head ?? document.documentElement).appendChild(style)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightTextNode(node: Text, pattern: RegExp, cls: string): void {
  const text = node.textContent ?? ""
  if (!pattern.test(text)) return
  pattern.lastIndex = 0

  const frag = document.createDocumentFragment()
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, match.index)))
    }
    const mark = document.createElement("mark")
    mark.className = `${HIGHLIGHT_CLASS} ${cls}`
    mark.textContent = match[0]
    frag.appendChild(mark)
    last = pattern.lastIndex
  }

  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)))
  }

  node.parentNode?.replaceChild(frag, node)
}

function walkAndHighlight(root: HTMLElement, pattern: RegExp, cls: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName?.toLowerCase()
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "code") {
        return NodeFilter.FILTER_REJECT
      }
      if (parent.classList?.contains(HIGHLIGHT_CLASS)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  for (const textNode of nodes) {
    highlightTextNode(textNode, pattern, cls)
  }
}

/**
 * Highlight matched (green) and missing (orange) keywords within a JD root element.
 * Missing are applied first so matched overwrites overlapping ones.
 */
export function highlightKeywords(
  root: HTMLElement,
  matched: string[],
  missing: string[],
): void {
  injectHighlightStyle()
  clearHighlights(root)

  const missingClean = missing.filter((k) => k.trim().length > 2)
  const matchedClean = matched.filter((k) => k.trim().length > 2)

  if (missingClean.length > 0) {
    const pattern = new RegExp(
      `\\b(${missingClean.map(escapeRegex).join("|")})\\b`,
      "gi",
    )
    walkAndHighlight(root, pattern, "missing")
  }

  if (matchedClean.length > 0) {
    const pattern = new RegExp(
      `\\b(${matchedClean.map(escapeRegex).join("|")})\\b`,
      "gi",
    )
    walkAndHighlight(root, pattern, "matched")
  }
}

/** Remove all keyword highlights from a root element. */
export function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    const frag = document.createDocumentFragment()
    while (mark.firstChild) frag.appendChild(mark.firstChild)
    parent.replaceChild(frag, mark)
    parent.normalize()
  })
}
