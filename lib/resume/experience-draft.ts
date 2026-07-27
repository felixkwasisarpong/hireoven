// The Resume Studio's experience textarea mixes prose lines with
// bullet-prefixed ("-"/"•") achievement lines. The live preview, the saved
// resume record, and the downloaded document must all split description vs.
// achievements the same way — they previously didn't, so what a user saw
// while editing didn't match what they downloaded (bug: the live preview
// bulleted every line regardless of prefix, while save/download split them).
export function splitDescriptionAndAchievements(raw: string): {
  description: string
  achievements: string[]
} {
  const lines = raw.split(/\r?\n/)
  return {
    description: lines
      .filter((line) => !/^[-•]\s/.test(line.trim()))
      .join("\n")
      .trim(),
    achievements: lines
      .filter((line) => /^[-•]\s/.test(line.trim()))
      .map((line) => line.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean),
  }
}

// A multi-line prose description (no bullet prefixes) still needs to render
// as separate lines — the site preview does this with CSS (`whitespace-pre-line`).
// Consumers that can't rely on that CSS (e.g. DOCX generation, where an
// embedded "\n" inside one text run does not produce a visual line break)
// should render one unit per entry from this split instead of the whole
// blob as a single line.
export function splitDescriptionIntoLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
