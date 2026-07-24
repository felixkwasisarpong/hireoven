import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { Plus_Jakarta_Sans } from "next/font/google"
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration"
import PageViewTracker from "@/components/analytics/PageViewTracker"
import MetaPixel from "@/components/analytics/MetaPixel"
import { RouteToastBridge, ToastProvider } from "@/components/ui/ToastProvider"
import { AuthProvider } from "@/lib/context/AuthContext"
import { SubscriptionProvider } from "@/lib/context/SubscriptionContext"
import { UpgradeModalProvider } from "@/lib/context/UpgradeModalContext"
import UpgradeModal from "@/components/gates/UpgradeModal"
import FeedbackModal from "@/components/feedback/FeedbackModal"
import { FeedbackModalProvider } from "@/lib/context/FeedbackModalContext"
import { headers } from "next/headers"
import { getSessionUser } from "@/lib/auth/session-user"
import "./globals.css"

/** Plus Jakarta Sans — geometric SaaS feel (Cruip / Mosaic-adjacent). */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
})

export const metadata: Metadata = {
  // Production fallback, NOT localhost: metadataBase is baked into every
  // absolute og:/twitter: URL, and a blank build-time env would otherwise put
  // localhost links in social shares.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://hireoven.com"),
  title: "Hireoven – Jobs served fresh",
  description:
    "We monitor thousands of company career pages in real time so you see new roles within minutes of posting.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Hireoven",
    title: "Hireoven – Jobs served fresh",
    description:
      "Every job sponsorship-checked against DOL and USCIS records, surfaced minutes after it posts. Apex AI applies for you.",
    images: [
      {
        url: "/brand/og-image.png",
        width: 1200,
        height: 630,
        alt: "Hireoven: jobs served fresh",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hireoven – Jobs served fresh",
    description:
      "Every job sponsorship-checked against DOL and USCIS records, surfaced minutes after it posts. Apex AI applies for you.",
    images: ["/brand/og-image.png"],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hireoven",
  },
  icons: {
    icon: [
      { url: "/brand/hireoven-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/hireoven-favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/brand/hireoven-favicon-180.png", sizes: "180x180", type: "image/png" },
      { url: "/brand/hireoven-favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/brand/hireoven-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/brand/hireoven-favicon-32.png",
  },
}

export const viewport: Viewport = {
  themeColor: "#FF5C18",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Embeddable widgets (Spec 07) render as a bare document: no providers, no
  // service worker, no session read. Marked by middleware via x-hireoven-embed.
  if (headers().get("x-hireoven-embed") === "1") {
    return (
      <html lang="en">
        <body className={jakarta.variable}>{children}</body>
      </html>
    )
  }

  const session = await getSessionUser()
  const initialUser = session
    ? { id: session.sub, email: session.email }
    : null

  return (
    <html lang="en">
      <body className={`${jakarta.variable} site-chroma`}>
        <AuthProvider initialUser={initialUser}>
          <UpgradeModalProvider>
            <SubscriptionProvider>
              <FeedbackModalProvider>
                <ToastProvider>
                  <Suspense fallback={null}>
                    <RouteToastBridge />
                  </Suspense>
                  {children}
                  <UpgradeModal />
                  <FeedbackModal />
                  <ServiceWorkerRegistration />
                  <PageViewTracker />
                  <MetaPixel />
                </ToastProvider>
              </FeedbackModalProvider>
            </SubscriptionProvider>
          </UpgradeModalProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
