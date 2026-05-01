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
      { hostname: "**.supabase.co" },
      { hostname: "**.supabase.in" },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ["hireoven.com", "localhost:3000"] },
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: process.env.NEXT_PUBLIC_APP_URL ?? "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          // Include X-Hireoven-Extension so the Scout Bridge can identify itself.
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Hireoven-Extension" },
        ],
      },
      // Extension routes handle their own per-request CORS (reflecting the
      // chrome-extension:// origin) so no static header override is needed here.
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
        has: [{ type: "cookie", key: "sb-access-token" }],
        destination: "/dashboard",
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
