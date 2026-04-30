"use client"

import { useEffect, useRef, useState } from "react"
import { Command, Search, X } from "lucide-react"
import {
  buildDisplayGroups,
  flattenGroups,
  GROUP_META,
  type ScoutCommand,
} from "@/lib/scout/commands"
import type { WorkspaceMode } from "@/lib/scout/workspace"
import { cn } from "@/lib/utils"

type Props = {
  isOpen: boolean
  onClose: () => void
  onSelect: (query: string, autoRun: boolean) => void
  workspaceMode: WorkspaceMode
}

export function ScoutCommandPalette({
  isOpen,
  onClose,
  onSelect,
  workspaceMode,
}: Props) {
  const [search,        setSearch]        = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef  = useRef<HTMLInputElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)
  const itemRefs   = useRef<(HTMLButtonElement | null)[]>([])

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setSearch("")
      setSelectedIndex(0)
      setTimeout(() => searchRef.current?.focus(), 30)
    }
  }, [isOpen])

  // Build display list
  const groups   = buildDisplayGroups(workspaceMode, search)
  const flatList = flattenGroups(groups)

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.min(i + 1, flatList.length - 1)
          itemRefs.current[next]?.scrollIntoView({ block: "nearest" })
          return next
        })
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.max(i - 1, 0)
          itemRefs.current[next]?.scrollIntoView({ block: "nearest" })
          return next
        })
      }

      if (e.key === "Enter") {
        e.preventDefault()
        const cmd = flatList[selectedIndex]
        if (cmd) handleSelect(cmd)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, flatList, selectedIndex, onClose])

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0)
    itemRefs.current = []
  }, [search])

  function handleSelect(cmd: ScoutCommand) {
    onSelect(cmd.query, cmd.autoRun)
    onClose()
  }

  if (!isOpen) return null

  let flatIndex = 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        className="fixed left-1/2 top-[14vh] z-50 w-full max-w-lg -translate-x-1/2 px-4"
        role="dialog"
        aria-modal
        aria-label="Scout command palette"
      >
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.24)] animate-in fade-in zoom-in-95 duration-150">

          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5">
            <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search commands…"
              className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            />
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <kbd className="inline-flex items-center rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                ESC
              </kbd>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Command list */}
          <div
            ref={listRef}
            className="max-h-[52vh] overflow-y-auto overscroll-contain py-1.5"
          >
            {flatList.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Command className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No commands match</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Try a different search term
                </p>
              </div>
            ) : (
              groups.map(({ group, commands }) => {
                const meta = GROUP_META[group]
                return (
                  <div key={group}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
                      <span className="text-[10px]">{meta.emoji}</span>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                        {meta.label}
                      </p>
                    </div>

                    {/* Commands */}
                    {commands.map((cmd) => {
                      const idx      = flatIndex++
                      const isActive = selectedIndex === idx

                      return (
                        <button
                          key={cmd.id}
                          ref={(el) => { itemRefs.current[idx] = el }}
                          type="button"
                          onClick={() => handleSelect(cmd)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            isActive
                              ? "bg-slate-950 text-white"
                              : "text-gray-700 hover:bg-gray-50"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-sm font-medium", isActive ? "text-white" : "text-gray-800")}>
                              {cmd.label}
                            </p>
                            {cmd.description && (
                              <p className={cn("truncate text-[11px]", isActive ? "text-white/60" : "text-gray-400")}>
                                {cmd.description}
                              </p>
                            )}
                          </div>

                          {/* autoRun hint */}
                          {cmd.autoRun ? (
                            <span className={cn(
                              "flex-shrink-0 text-[10px] font-medium",
                              isActive ? "text-white/50" : "text-gray-400"
                            )}>
                              ↵ run
                            </span>
                          ) : (
                            <span className={cn(
                              "flex-shrink-0 text-[10px] font-medium",
                              isActive ? "text-white/50" : "text-gray-400"
                            )}>
                              ↵ fill
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5">
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span><kbd className="font-medium">↑↓</kbd> navigate</span>
              <span><kbd className="font-medium">↵</kbd> select</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="font-medium text-[#FF5C18]">↵ run</span>
              <span className="text-gray-300">auto-submits</span>
              <span className="mx-1 text-gray-300">·</span>
              <span className="font-medium text-gray-500">↵ fill</span>
              <span className="text-gray-300">fills bar</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
