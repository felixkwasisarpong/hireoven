"use client"

import { useEffect, useRef, useState } from "react"
import type { WorkspaceMode } from "@/lib/scout/workspace"

// Transition timings — fast and understated (no bounce, no spring)
const LEAVE_MS  = 110  // fade out old mode
const ENTER_MS  = 160  // fade in new mode

type Props = {
  mode: WorkspaceMode
  /** Render callback receives the *displayed* mode (lags during transition) */
  render: (mode: WorkspaceMode) => React.ReactNode
}

/**
 * Persistent container that transitions between workspace modes without
 * full React remounting. When `mode` changes:
 *   1. Fade out current content (LEAVE_MS)
 *   2. Swap displayed mode
 *   3. Fade in new content (ENTER_MS)
 *
 * The `render` callback re-runs on every parent render — including when
 * activeResponse, chips, or other state updates — so mode content stays
 * live even while displaying the same mode.
 */
export function WorkspaceSurface({ mode, render }: Props) {
  const [displayedMode, setDisplayedMode] = useState<WorkspaceMode>(mode)
  const [opacity, setOpacity] = useState(1)
  const pendingModeRef = useRef<WorkspaceMode>(mode)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (mode === pendingModeRef.current) return

    pendingModeRef.current = mode

    // Cancel any in-progress transition
    if (timerRef.current) clearTimeout(timerRef.current)

    // 1. Fade out
    setOpacity(0)

    // 2. After leave: swap + fade in
    timerRef.current = setTimeout(() => {
      setDisplayedMode(mode)
      setOpacity(1)
    }, LEAVE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [mode])

  return (
    <div
      style={{
        opacity,
        transition: `opacity ${opacity === 0 ? LEAVE_MS : ENTER_MS}ms ease-in-out`,
        willChange: "opacity",
      }}
    >
      {render(displayedMode)}
    </div>
  )
}
