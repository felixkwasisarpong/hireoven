import type { Metadata, Viewport } from "next"

// Standalone layout for embeddable widgets. The root layout already renders a bare
// document (no providers / service worker) for these paths; here we just keep them
// out of the index and ensure mobile-correct sizing inside the host iframe.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "transparent", padding: 0, margin: 0 }}>{children}</div>
}
