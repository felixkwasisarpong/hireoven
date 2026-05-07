"use client"

import dynamic from "next/dynamic"
import type { editor } from "monaco-editor"

// Monaco must not run SSR
const MonacoEditorBase = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type Props = {
  language: "python" | "javascript"
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}

const MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  tabSize: 4,
  insertSpaces: true,
  wordWrap: "on",
  padding: { top: 12, bottom: 12 },
  scrollbar: { verticalScrollbarSize: 6 },
  overviewRulerLanes: 0,
}

export default function MonacoEditor({ language, value, onChange, readOnly }: Props) {
  return (
    <MonacoEditorBase
      height="100%"
      language={language === "python" ? "python" : "javascript"}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme="vs-dark"
      options={{ ...MONACO_OPTIONS, readOnly: readOnly ?? false }}
    />
  )
}
