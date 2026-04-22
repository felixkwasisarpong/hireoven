import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration"
import { RouteToastBridge, ToastProvider } from "@/components/ui/ToastProvider"
import { SubscriptionProvider } from "@/lib/context/SubscriptionContext"
import { UpgradeModalProvider } from "@/lib/context/UpgradeModalContext"
import UpgradeModal from "@/components/gates/UpgradeModal"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Hireoven – Jobs served fresh",
  description:
    "We monitor thousands of company career pages in real time so you see new roles within minutes of posting.",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} site-chroma`}>
        <UpgradeModalProvider>
          <SubscriptionProvider>
            <ToastProvider>
              <RouteToastBridge />
              {children}
              <UpgradeModal />
              <ServiceWorkerRegistration />
            </ToastProvider>
          </SubscriptionProvider>
        </UpgradeModalProvider>
      </body>
    </html>
  )
}
