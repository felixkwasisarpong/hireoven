"use client"

import { useEffect, useRef } from "react"

type Particle = {
  originX: number
  originY: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  amber: boolean
}

const GREEN = "56, 224, 138"
const AMBER = "245, 166, 35"

export default function LandingParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvasElement = canvasRef.current
    if (!canvasElement) return

    const context = canvasElement.getContext("2d", { alpha: true })
    if (!context) return
    const ctx: CanvasRenderingContext2D = context
    const canvasEl: HTMLCanvasElement = canvasElement

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const pointer = {
      x: -10000,
      y: -10000,
      active: false,
    }
    let particles: Particle[] = []
    let width = 0
    let height = 0
    let frame = 0

    function makeParticles() {
      const area = width * height
      const count = Math.min(132, Math.max(46, Math.round(area / 18500)))

      particles = Array.from({ length: count }, (_, index) => {
        const originX = Math.random() * width
        const originY = Math.random() * height

        return {
          originX,
          originY,
          x: originX,
          y: originY,
          vx: 0,
          vy: 0,
          size: 0.85 + Math.random() * 1.75,
          phase: Math.random() * Math.PI * 2,
          amber: index % 9 === 0,
        }
      })
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight

      canvasEl.width = Math.floor(width * dpr)
      canvasEl.height = Math.floor(height * dpr)
      canvasEl.style.width = `${width}px`
      canvasEl.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      makeParticles()
      if (reducedMotion) {
        draw(performance.now())
      }
    }

    function draw(timestamp: number) {
      ctx.clearRect(0, 0, width, height)

      const pointerRadius = Math.min(230, Math.max(145, width * 0.13))
      const pointerRadiusSq = pointerRadius * pointerRadius
      const lineDistance = width < 640 ? 82 : 112
      const lineDistanceSq = lineDistance * lineDistance

      for (const particle of particles) {
        const driftX = Math.cos(timestamp * 0.00026 + particle.phase) * 0.12
        const driftY = Math.sin(timestamp * 0.00032 + particle.phase) * 0.12

        if (!reducedMotion) {
          const dx = particle.x - pointer.x
          const dy = particle.y - pointer.y
          const distanceSq = dx * dx + dy * dy

          if (pointer.active && distanceSq < pointerRadiusSq) {
            const distance = Math.max(Math.sqrt(distanceSq), 1)
            const force = (1 - distance / pointerRadius) ** 2
            particle.vx += (dx / distance) * force * 1.65
            particle.vy += (dy / distance) * force * 1.65
          }

          particle.vx += (particle.originX - particle.x) * 0.012 + driftX
          particle.vy += (particle.originY - particle.y) * 0.012 + driftY
          particle.vx *= 0.88
          particle.vy *= 0.88
          particle.x += particle.vx
          particle.y += particle.vy
        }
      }

      ctx.lineWidth = 1
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i]

        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distanceSq = dx * dx + dy * dy

          if (distanceSq > lineDistanceSq) continue

          const distance = Math.sqrt(distanceSq)
          const midX = (a.x + b.x) / 2
          const midY = (a.y + b.y) / 2
          const pointerDx = midX - pointer.x
          const pointerDy = midY - pointer.y
          const pointerDistanceSq = pointerDx * pointerDx + pointerDy * pointerDy
          const pointerBoost = pointer.active && pointerDistanceSq < pointerRadiusSq ? 0.12 : 0
          const alpha = (1 - distance / lineDistance) * (0.075 + pointerBoost)

          ctx.strokeStyle = `rgba(${a.amber || b.amber ? AMBER : GREEN}, ${alpha})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      for (const particle of particles) {
        const dx = particle.x - pointer.x
        const dy = particle.y - pointer.y
        const distanceSq = dx * dx + dy * dy
        const isNearPointer = pointer.active && distanceSq < pointerRadiusSq
        const proximity = isNearPointer ? 1 - Math.sqrt(distanceSq) / pointerRadius : 0
        const alpha = 0.22 + proximity * 0.5
        const size = particle.size + proximity * 1.8

        ctx.fillStyle = `rgba(${particle.amber ? AMBER : GREEN}, ${alpha})`
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      if (!reducedMotion) {
        frame = requestAnimationFrame(draw)
      }
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

      if (reducedMotion) {
        draw(performance.now())
      } else {
        frame = requestAnimationFrame(draw)
      }
    }

    resize()
    if (!reducedMotion) {
      frame = requestAnimationFrame(draw)
    }

    window.addEventListener("resize", resize)
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerleave", handlePointerLeave)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerleave", handlePointerLeave)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-70 mix-blend-screen"
    />
  )
}
