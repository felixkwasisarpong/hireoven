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
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
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
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Allow first-party in-app embeds (Scout side preview drawer), while
          // still blocking third-party framing.
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
    ]
  },
}

module.exports = nextConfig
