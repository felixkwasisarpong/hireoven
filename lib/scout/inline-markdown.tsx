import type { ReactNode } from "react"

/**
 * Render a string with the small subset of inline markdown Scout actually uses:
 *
 *   **bold**         → <strong>
 *   *italic* / _italic_ → <em>
 *   `code`           → <code>
 *   [label](url)     → <a target="_blank" rel="noreferrer">
 *
 * Everything else is rendered as plain text. Newlines are preserved by the
 * caller via `whitespace-pre-wrap` on the surrounding element.
 *
 * This is intentionally tiny and dependency-free — Scout output should stay
 * legible if the regex misses an edge case.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  if (!text) return []

  // Order matters: bold (** **) before italic (*), code before everything else.
  // Single regex with an alternation keeps the walk linear.
  const TOKEN_RE = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*|_([^_\n]+)_)/g

  const out: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index))
    }

    if (match[2] !== undefined) {
      out.push(<strong key={`m-${key++}`}>{match[2]}</strong>)
    } else if (match[3] !== undefined) {
      out.push(
        <code
          key={`m-${key++}`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-slate-800"
        >
          {match[3]}
        </code>
      )
    } else if (match[4] !== undefined && match[5] !== undefined) {
      out.push(
        <a
          key={`m-${key++}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#FF5C18] underline-offset-2 hover:underline"
        >
          {match[4]}
        </a>
      )
    } else if (match[6] !== undefined) {
      out.push(<em key={`m-${key++}`}>{match[6]}</em>)
    } else if (match[7] !== undefined) {
      out.push(<em key={`m-${key++}`}>{match[7]}</em>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex))
  }

  return out
}
