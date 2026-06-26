/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      // Company logos come from many external career sites/domains.
      // Keep explicit patterns, but allow HTTPS fallthrough so unknown hosts
      // don't crash runtime with "next/image unconfigured host".
      { protocol: "https", hostname: "**" },
      { hostname: "**.greenhouse.io" },
      { hostname: "**.lever.co" },
      { hostname: "**.ashbyhq.com" },
      { hostname: "logo.clearbit.com" },
      { hostname: "unavatar.io" },
      { hostname: "icon.horse" },
      { hostname: "www.google.com" },
      { hostname: "**.gstatic.com" },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ["hireoven.com", "localhost:3000"] },
    serverComponentsExternalPackages: ["pdf-parse", "@napi-rs/canvas", "mammoth", "sharp", "undici"],
    outputFileTracingIncludes: {
      "/**": ["./node_modules/sharp/**/*"],
      // Native .node binary + pdfjs need to be traced into the standalone build
      // so server-side PDF resume parsing works in production (DOMMatrix etc.).
      "/api/resume/**": [
        "./node_modules/@napi-rs/canvas/**/*",
        "./node_modules/@napi-rs/canvas-*/**/*",
        "./node_modules/pdf-parse/**/*",
      ],
    },
  },
  async headers() {
    return [
      {
        // Global CORS for browser-originated API calls.
        // Excluded when Origin is chrome-extension:// — those routes set their
        // own per-request CORS via extensionCorsHeaders() to reflect the exact
        // extension origin. Two conflicting Allow-Origin headers break CORS.
        source: "/api/:path*",
        missing: [{ type: "header", key: "origin", value: "chrome-extension://.*" }],
        headers: [
          { key: "Access-Control-Allow-Origin", value: process.env.NEXT_PUBLIC_APP_URL ?? "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Hireoven-Extension" },
        ],
      },
      {
        // Embeddable widgets (Spec 07) are excluded from the negative lookahead
        // below so they are NOT pinned to SAMEORIGIN; this rule lets any site frame
        // /embed/v1/* while keeping the rest of the security headers.
        source: "/embed/v1/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Everything except /embed/v1/* (negative lookahead). Third-party framing
        // stays blocked here while first-party in-app embeds (Scout drawer) work.
        source: "/((?!embed/v1).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "cookie", key: "ho_session" }],
        destination: "/dashboard",
        permanent: false,
      },
      {
        // The methodology page is nested under /leaderboard, but many external
        // references (press, docs, Spec 02) point at the un-nested URL. Redirect
        // so those links don't 404.
        source: "/h1b-sponsors/methodology",
        destination: "/h1b-sponsors/leaderboard/methodology",
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
