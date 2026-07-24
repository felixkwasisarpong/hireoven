"use client"

import { useEffect, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Banknote,
  BrainCircuit,
  Briefcase,
  Building2,
  Calculator,
  ClipboardCheck,
  Code2,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Gavel,
  GraduationCap,
  LineChart,
  Megaphone,
  Microscope,
  Palette,
  PenTool,
  Plane,
  Search,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Users,
  Wrench,
} from "lucide-react"

type ProfessionGlyph = {
  label: string
  Icon: LucideIcon
  x: number
  y: number
  size: number
  drift: number
  phase: number
  accent?: "amber" | "green"
}

const GREEN = "56, 224, 138"
const AMBER = "245, 166, 35"

const GLYPHS: ProfessionGlyph[] = [
  { label: "Software engineer", Icon: Code2, x: 9, y: 18, size: 36, drift: 8, phase: 0.2 },
  { label: "Data analyst", Icon: LineChart, x: 23, y: 13, size: 32, drift: 7, phase: 1.1 },
  { label: "Healthcare", Icon: Stethoscope, x: 44, y: 16, size: 34, drift: 9, phase: 2.4 },
  { label: "Finance", Icon: Banknote, x: 65, y: 13, size: 34, drift: 7, phase: 3.2, accent: "amber" },
  { label: "Legal", Icon: Gavel, x: 84, y: 18, size: 32, drift: 8, phase: 4.4 },
  { label: "Education", Icon: GraduationCap, x: 96, y: 28, size: 36, drift: 7, phase: 5.1 },
  { label: "AI engineer", Icon: BrainCircuit, x: 35, y: 44, size: 40, drift: 10, phase: 2.8, accent: "amber" },
  { label: "Designer", Icon: Palette, x: 32, y: 27, size: 34, drift: 8, phase: 0.6 },
  { label: "Research", Icon: Microscope, x: 58, y: 35, size: 36, drift: 9, phase: 1.8 },
  { label: "Product", Icon: ClipboardCheck, x: 78, y: 36, size: 34, drift: 7, phase: 3.8 },
  { label: "Operations", Icon: Wrench, x: 93, y: 46, size: 32, drift: 8, phase: 4.9 },
  { label: "Recruiting", Icon: Users, x: 6, y: 63, size: 34, drift: 7, phase: 5.7 },
  { label: "Cybersecurity", Icon: ShieldCheck, x: 22, y: 56, size: 36, drift: 10, phase: 2.2 },
  { label: "Cloud", Icon: Database, x: 42, y: 58, size: 32, drift: 8, phase: 1.4 },
  { label: "Hardware", Icon: Cpu, x: 61, y: 56, size: 34, drift: 8, phase: 0.9 },
  { label: "Marketing", Icon: Megaphone, x: 83, y: 59, size: 34, drift: 9, phase: 3.6, accent: "amber" },
  { label: "Consulting", Icon: Briefcase, x: 15, y: 82, size: 34, drift: 8, phase: 4.1 },
  { label: "Accounting", Icon: Calculator, x: 34, y: 78, size: 32, drift: 7, phase: 5.4 },
  { label: "Writing", Icon: PenTool, x: 51, y: 84, size: 34, drift: 9, phase: 2.9 },
  { label: "Travel", Icon: Plane, x: 71, y: 80, size: 36, drift: 10, phase: 1.7 },
  { label: "Business", Icon: Building2, x: 91, y: 82, size: 34, drift: 8, phase: 0.3 },
  { label: "Terminal", Icon: Terminal, x: 3, y: 28, size: 30, drift: 6, phase: 1.9, accent: "amber" },
  { label: "Resume", Icon: FileText, x: 73, y: 24, size: 30, drift: 7, phase: 5.9 },
  { label: "Search", Icon: Search, x: 49, y: 72, size: 30, drift: 7, phase: 4.8 },
  { label: "Science", Icon: FlaskConical, x: 97, y: 66, size: 32, drift: 8, phase: 3.1 },
]

function baseColor(glyph: ProfessionGlyph, alpha: number) {
  const color = glyph.accent === "amber" ? AMBER : GREEN
  return `rgba(${color}, ${alpha})`
}

export default function LandingParticleBackground() {
  const glyphRefs = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const pointer = {
      x: -10000,
      y: -10000,
      active: false,
    }

    let frame = 0
    let width = window.innerWidth
    let height = window.innerHeight

    function animate(timestamp: number) {
      const radius = Math.min(265, Math.max(155, width * 0.16))

      GLYPHS.forEach((glyph, index) => {
        const node = glyphRefs.current[index]
        if (!node) return

        const originX = (glyph.x / 100) * width
        const originY = (glyph.y / 100) * height
        const idleX = reducedMotion ? 0 : Math.cos(timestamp * 0.00034 + glyph.phase) * glyph.drift
        const idleY = reducedMotion ? 0 : Math.sin(timestamp * 0.0003 + glyph.phase) * glyph.drift

        let pushX = 0
        let pushY = 0
        let scale = 1
        let rotate = Math.sin(timestamp * 0.00024 + glyph.phase) * 3
        let alpha = 0.25
        let shadowAlpha = 0

        if (pointer.active && !reducedMotion) {
          const dx = originX - pointer.x
          const dy = originY - pointer.y
          const distance = Math.max(Math.hypot(dx, dy), 1)

          if (distance < radius) {
            const proximity = (1 - distance / radius) ** 2
            pushX = (dx / distance) * proximity * 82
            pushY = (dy / distance) * proximity * 82
            scale = 1 + proximity * 0.64
            rotate += (dx / radius) * 18
            alpha = 0.32 + proximity * 0.58
            shadowAlpha = proximity * 0.32
          }
        }

        node.style.transform = `translate3d(calc(-50% + ${(idleX + pushX).toFixed(2)}px), calc(-50% + ${(idleY + pushY).toFixed(2)}px), 0) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(3)})`
        node.style.color = baseColor(glyph, alpha)
        node.style.borderColor = baseColor(glyph, 0.12 + shadowAlpha)
        node.style.boxShadow = shadowAlpha > 0 ? `0 0 26px rgba(${glyph.accent === "amber" ? AMBER : GREEN}, ${shadowAlpha})` : "none"
      })

      if (!reducedMotion) {
        frame = requestAnimationFrame(animate)
      }
    }

    function resize() {
      width = window.innerWidth
      height = window.innerHeight
      animate(performance.now())
    }

    function handlePointerMove(event: PointerEvent) {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
    }

    function handlePointerLeave() {
      pointer.active = false
      pointer.x = -10000
      pointer.y = -10000
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        return
      }

      animate(performance.now())
    }

    resize()
    if (!reducedMotion) {
      frame = requestAnimationFrame(animate)
    }

    window.addEventListener("resize", resize)
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerleave", handlePointerLeave)
    window.addEventListener("blur", handlePointerLeave)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerleave", handlePointerLeave)
      window.removeEventListener("blur", handlePointerLeave)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-80 mix-blend-screen"
    >
      {GLYPHS.map((glyph, index) => {
        const Icon = glyph.Icon

        return (
          <span
            key={`${glyph.label}-${index}`}
            ref={(node) => {
              glyphRefs.current[index] = node
            }}
            className="absolute flex items-center justify-center rounded-full border bg-[#0a0e0c]/45 backdrop-blur-[1px] will-change-transform"
            style={{
              left: `${glyph.x}%`,
              top: `${glyph.y}%`,
              width: glyph.size,
              height: glyph.size,
              color: baseColor(glyph, 0.25),
              borderColor: baseColor(glyph, 0.12),
              transform: "translate3d(-50%, -50%, 0)",
            }}
          >
            <Icon
              aria-hidden="true"
              strokeWidth={1.7}
              style={{ width: glyph.size * 0.52, height: glyph.size * 0.52 }}
            />
          </span>
        )
      })}
    </div>
  )
}
