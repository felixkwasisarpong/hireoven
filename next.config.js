/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { hostname: "**.greenhouse.io" },
      { hostname: "**.lever.co" },
      { hostname: "**.ashbyhq.com" },
      { hostname: "logo.clearbit.com" },
      { hostname: "unavatar.io" },
      { hostname: "www.google.com" },
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
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
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
