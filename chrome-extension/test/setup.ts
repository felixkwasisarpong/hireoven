/**
 * Vitest setup: stub the chrome.* global so handler modules can auto-bootstrap
 * inside JSDOM without throwing. Tests instantiate handler classes directly to
 * exercise their methods; the bootstrap calls become safe no-ops here.
 */

interface StubMessageListener {
  (msg: unknown, sender: unknown, sendResponse: (response: unknown) => void): boolean | void
}

const messageListeners = new Set<StubMessageListener>()
const sentMessages: Array<{ type?: string; payload: Record<string, unknown> }> = []

const chromeStub = {
  runtime: {
    id: "apex-test-extension",
    lastError: undefined as { message: string } | undefined,
    onMessage: {
      addListener: (fn: StubMessageListener) => {
        messageListeners.add(fn)
      },
      removeListener: (fn: StubMessageListener) => {
        messageListeners.delete(fn)
      },
    },
    sendMessage: (msg: Record<string, unknown>, callback?: (response?: unknown) => void) => {
      sentMessages.push({ type: msg.type as string | undefined, payload: msg })
      if (callback) callback(undefined)
    },
  },
  storage: {
    local: {
      data: new Map<string, unknown>(),
      get(key: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {}
        const keys = typeof key === "string" ? [key] : Array.isArray(key) ? key : Object.keys(key ?? {})
        for (const k of keys) {
          if (this.data.has(k)) out[k] = this.data.get(k)
        }
        return Promise.resolve(out)
      },
      set(items: Record<string, unknown>): Promise<void> {
        for (const [k, v] of Object.entries(items)) this.data.set(k, v)
        return Promise.resolve()
      },
      remove(key: string | string[]): Promise<void> {
        const keys = typeof key === "string" ? [key] : key
        for (const k of keys) this.data.delete(k)
        return Promise.resolve()
      },
    },
    session: {
      data: new Map<string, unknown>(),
      get(key: string | string[]): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {}
        const keys = typeof key === "string" ? [key] : key
        for (const k of keys) {
          if (this.data.has(k)) out[k] = this.data.get(k)
        }
        return Promise.resolve(out)
      },
      set(items: Record<string, unknown>): Promise<void> {
        for (const [k, v] of Object.entries(items)) this.data.set(k, v)
        return Promise.resolve()
      },
      remove(key: string | string[]): Promise<void> {
        const keys = typeof key === "string" ? [key] : key
        for (const k of keys) this.data.delete(k)
        return Promise.resolve()
      },
    },
  },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage: () => undefined,
  },
  cookies: {
    get: () => undefined,
  },
}

;(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub

// JSDOM doesn't implement CSS.escape, which the autofill selector builder uses.
const cssHost = globalThis as unknown as { CSS?: { escape?: (s: string) => string } }
if (!cssHost.CSS) cssHost.CSS = {}
if (typeof cssHost.CSS.escape !== "function") {
  cssHost.CSS.escape = (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)
}

// JSDOM doesn't implement layout-aware innerText. The handlers read .innerText
// on description/header containers; fall back to textContent so fixture parsing
// behaves the same in tests as it does in a real browser.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")?.get) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? ""
    },
    set(this: HTMLElement, value: string) {
      this.textContent = value
    },
  })
}

export function clearTestState(): void {
  sentMessages.length = 0
  chromeStub.storage.local.data.clear()
  chromeStub.storage.session.data.clear()
}

export function getSentMessages(): typeof sentMessages {
  return sentMessages
}

export function setLocation(href: string): void {
  // JSDOM forbids assignment to window.location; navigate via replace instead.
  const url = new URL(href)
  Object.defineProperty(window, "location", {
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign: () => undefined,
      replace: () => undefined,
      reload: () => undefined,
    },
    writable: true,
    configurable: true,
  })
}
