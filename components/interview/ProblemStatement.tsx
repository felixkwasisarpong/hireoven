import { cn } from "@/lib/utils"

const DIFFICULTY_COLORS = {
  easy:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  hard:   "bg-red-50 text-red-700 border-red-200",
}

// Very small markdown-to-JSX renderer for the limited set of patterns in problem prompts.
// Handles: **bold**, `code`, ``` code blocks ```, ### headers, and line breaks.
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n")
  const result: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let key = 0

  const renderLine = (line: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    let remaining = line
    let partKey = 0

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
      const codeMatch = remaining.match(/`([^`]+)`/)

      if (!boldMatch && !codeMatch) {
        parts.push(remaining)
        break
      }

      const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : Infinity
      const codeIdx = codeMatch ? remaining.indexOf(codeMatch[0]) : Infinity

      if (boldIdx < codeIdx && boldMatch) {
        if (boldIdx > 0) parts.push(remaining.slice(0, boldIdx))
        parts.push(<strong key={partKey++} className="font-semibold text-slate-900">{boldMatch[1]}</strong>)
        remaining = remaining.slice(boldIdx + boldMatch[0].length)
      } else if (codeMatch) {
        if (codeIdx > 0) parts.push(remaining.slice(0, codeIdx))
        parts.push(<code key={partKey++} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-800">{codeMatch[1]}</code>)
        remaining = remaining.slice(codeIdx + codeMatch[0].length)
      } else {
        parts.push(remaining)
        break
      }
    }

    return parts
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        result.push(
          <pre key={key++} className="overflow-x-auto rounded-lg bg-slate-800 p-3 font-mono text-[12px] text-slate-200">
            <code>{codeLines.join("\n")}</code>
          </pre>
        )
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) { codeLines.push(line); continue }

    if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
      const text = line.replace(/^#+\s+/, "")
      result.push(<h3 key={key++} className="mt-3 text-[13px] font-bold text-slate-800">{renderLine(text)}</h3>)
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      result.push(
        <li key={key++} className="ml-4 list-disc text-[13px] leading-relaxed text-slate-700">
          {renderLine(line.slice(2))}
        </li>
      )
    } else if (line.trim() === "") {
      result.push(<div key={key++} className="h-2" />)
    } else {
      result.push(<p key={key++} className="text-[13px] leading-relaxed text-slate-700">{renderLine(line)}</p>)
    }
  }

  return result
}

type Problem = {
  title: string
  difficulty: string
  prompt: string
  tags: string[]
  targetMinutes: number
}

type Props = { problem: Problem }

export default function ProblemStatement({ problem }: Props) {
  const diffCls = DIFFICULTY_COLORS[problem.difficulty as keyof typeof DIFFICULTY_COLORS] ?? "bg-slate-100 text-slate-600 border-slate-200"

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-slate-900">{problem.title}</h2>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", diffCls)}>
          {problem.difficulty}
        </span>
        <span className="text-[11px] text-slate-400">{problem.targetMinutes} min</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {problem.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {tag}
          </span>
        ))}
      </div>

      <div className="space-y-1">{renderMarkdown(problem.prompt)}</div>
    </div>
  )
}
