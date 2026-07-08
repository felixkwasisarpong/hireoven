/**
 * Open-shadow-DOM helpers.
 *
 * SmartRecruiters' oneclick-ui (and a growing number of ATS frontends) render
 * every form control inside web components (`spl-input`, `spl-dropzone`, …)
 * with open shadow roots. `document.querySelectorAll("input")` returns NOTHING
 * on those pages, so shadow-blind collection saw "no form". These helpers let
 * the detector/filler pierce open shadow roots. Closed roots stay invisible —
 * nothing we can do about those from a content script.
 */

/** Delimiter for selector paths that cross shadow boundaries. */
export const SHADOW_DELIM = " >>> "

/**
 * querySelectorAll that also descends into every open shadow root beneath
 * `root` (including nested ones). Returns matches in document order per tree.
 */
export function queryAllDeep<T extends Element>(root: ParentNode, selector: string): T[] {
  const out: T[] = []
  const visit = (node: ParentNode) => {
    try {
      out.push(...Array.from(node.querySelectorAll<T>(selector)))
    } catch {
      return
    }
    for (const el of Array.from(node.querySelectorAll<HTMLElement>("*"))) {
      if (el.shadowRoot) visit(el.shadowRoot)
    }
  }
  visit(root)
  return out
}

/** First deep match or null. */
export function queryDeep<T extends Element>(root: ParentNode, selector: string): T | null {
  return queryAllDeep<T>(root, selector)[0] ?? null
}

/**
 * parentElement that hops shadow boundaries: at the top of a shadow tree,
 * continue from the host element instead of stopping.
 */
export function deepParentElement(el: Element): HTMLElement | null {
  if (el.parentElement) return el.parentElement
  const root = el.getRootNode()
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement) return root.host
  return null
}

/** Hosts enclosing `el`, outermost first. Empty when `el` is in the light DOM. */
export function shadowHostChain(el: Element): HTMLElement[] {
  const hosts: HTMLElement[] = []
  let node: Element = el
  for (;;) {
    const root = node.getRootNode()
    if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
      hosts.unshift(root.host)
      node = root.host
    } else {
      break
    }
  }
  return hosts
}

/**
 * Resolve a selector that may contain SHADOW_DELIM segments: each segment is
 * resolved inside the previous segment's shadow root. A plain selector (no
 * delimiter) behaves exactly like `root.querySelector(selector)`.
 */
export function queryShadowSelector(root: ParentNode, selector: string): HTMLElement | null {
  const parts = selector.split(SHADOW_DELIM)
  let ctx: ParentNode | null = root
  let el: HTMLElement | null = null
  for (const part of parts) {
    if (!ctx) return null
    try {
      el = ctx.querySelector<HTMLElement>(part)
    } catch {
      return null
    }
    if (!el) return null
    ctx = el.shadowRoot
  }
  return el
}
