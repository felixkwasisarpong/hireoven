import { ImageResponse } from "next/og"

export const runtime = "edge"

const teal = "#1D9E75"
const bg = "#F8FAFC"

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: `linear-gradient(145deg, ${bg} 0%, #ffffff 45%, #E8F7F2 100%)`,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: -1.5,
              color: "#0f172a",
            }}
          >
            Hireoven
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: teal,
            }}
          >
            Jobs served fresh
          </div>
          <div style={{ fontSize: 20, color: "#64748b", maxWidth: 720 }}>
            Real-time career pages · Fresh listings in minutes
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { co: "S", c: "#0D9488", t: "Software Engineer, Backend", when: "Just now" },
            { co: "N", c: "#0f172a", t: "Product Designer", when: "1 min ago" },
            { co: "L", c: "#7C3AED", t: "Senior Frontend Engineer", when: "3 min ago" },
          ].map((job) => (
            <div
              key={job.t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "14px 18px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid #e2e8f0",
                boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: job.c,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {job.co}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 650, color: "#0f172a" }}>
                  {job.t}
                </div>
                <div style={{ fontSize: 15, color: teal, fontWeight: 600 }}>
                  {job.when}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
