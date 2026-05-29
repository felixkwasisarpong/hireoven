"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

interface FeedbackModalState {
  isOpen: boolean
  open: () => void
  close: () => void
}

const FeedbackModalContext = createContext<FeedbackModalState | null>(null)

export function FeedbackModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo<FeedbackModalState>(
    () => ({ isOpen, open, close }),
    [isOpen, open, close]
  )

  return (
    <FeedbackModalContext.Provider value={value}>
      {children}
    </FeedbackModalContext.Provider>
  )
}

export function useFeedbackModal(): FeedbackModalState {
  const ctx = useContext(FeedbackModalContext)
  if (!ctx) throw new Error("useFeedbackModal must be used inside FeedbackModalProvider")
  return ctx
}
