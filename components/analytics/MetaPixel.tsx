"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

// Public pixel id (safe to expose; it's visible in the client either way).
// Override per-environment with NEXT_PUBLIC_META_PIXEL_ID.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "1965040384900626"

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

/**
 * Meta (Facebook) Pixel — powers conversion tracking for the /find ad campaign.
 * The inline snippet fires the first PageView; because this is a Next.js SPA,
 * we also fire PageView on client-side route changes so Meta sees the whole
 * landing → signup funnel, not just the initial load.
 */
export default function MetaPixel() {
  const pathname = usePathname()
  const isFirstLoad = useRef(true)

  useEffect(() => {
    // The inline script below already fired PageView on first paint; only track
    // subsequent SPA navigations here.
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    window.fbq?.("track", "PageView")
  }, [pathname])

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`,
        }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  )
}
