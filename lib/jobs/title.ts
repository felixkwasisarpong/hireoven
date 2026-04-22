const TITLE_NOISE_PATTERNS = [
  /\bapplication deadline\s*:.*$/i,
  /\bsave for later\b.*$/i,
  /\breq(?:uisition)?(?:\s+id)?\s*[:#]?\s*[a-z0-9-]+.*$/i,
  /\bjob(?:\s+id)?\s*[:#]?\s*[a-z0-9-]+.*$/i,
]

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
}

function collapseDuplicateTail(value: string): string {
  const repeatedLocation = value.match(
    /^(.*?)(\s*-\s*[A-Za-z .'-]+,\s?[A-Z]{2})(?:\s+\2)+$/i
  )
  if (repeatedLocation) {
    return `${repeatedLocation[1]}${repeatedLocation[2]}`.trim()
  }

  const repeatedRemote = value.match(/^(.*?)(\s*-\s*remote)(?:\s+\2)+$/i)
  if (repeatedRemote) {
    return `${repeatedRemote[1]}${repeatedRemote[2]}`.trim()
  }

  return value
}

export function cleanJobTitle(title: string): string {
  let cleaned = decodeHtmlEntities(title)
    .replace(/\s+/g, " ")
    .trim()

  for (const pattern of TITLE_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim()
  }

  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-|/]\s*$/, "")
    .trim()

  cleaned = collapseDuplicateTail(cleaned)

  return cleaned || title.trim()
}
