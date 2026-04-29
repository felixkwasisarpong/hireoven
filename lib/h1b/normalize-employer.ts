const LEGAL_SUFFIX_RE =
  /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|systems|solutions|services)\b/g

export function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(LEGAL_SUFFIX_RE, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

