/**
 * Streaming XLSX row reader for the giant DOL disclosure files.
 *
 * WHY THIS EXISTS: OFLC publishes LCA/PERM/PWD as XLSX only — no CSV, no JSON, no API. The
 * FY2026 Q3 LCA file is 252 MB compressed and **1.6 GB of XML** inflated. The `xlsx` package
 * (and pandas' read_excel, and openpyxl's default mode) materialise the whole sheet and die on
 * it. This reads the archive entry as a stream and yields one row at a time, so memory stays
 * flat regardless of file size.
 *
 * Approach: an XLSX is a ZIP. We parse the central directory to locate two entries, fully
 * inflate `xl/sharedStrings.xml` (tens of MB — fine), then stream-inflate the worksheet and
 * parse it with a small incremental scanner. The sheet XML is machine-generated and highly
 * regular, so a targeted scanner is reliable here and avoids a dependency.
 *
 * Handles: shared strings (including rich-text runs split across <r><t>), inline strings,
 * numbers/dates as raw values, and gaps — a cell's column index comes from its `r` attribute,
 * so skipped empty cells do not shift the row.
 */

import fs from "node:fs"
import zlib from "node:zlib"

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  dataStart: number
}

/** Read the ZIP central directory. Only small reads — never loads entry data. */
function readCentralDirectory(path: string): Map<string, ZipEntry> {
  const fd = fs.openSync(path, "r")
  try {
    const size = fs.fstatSync(fd).size

    // End-of-central-directory lives in the last 64KB (no ZIP comment in practice).
    const tailLen = Math.min(size, 66_000)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)

    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error("Not a ZIP/XLSX: no end-of-central-directory record")

    const entryCount = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)

    const cd = Buffer.alloc(cdSize)
    fs.readSync(fd, cd, 0, cdSize, cdOffset)

    const entries = new Map<string, ZipEntry>()
    let ptr = 0
    for (let i = 0; i < entryCount; i++) {
      if (cd.readUInt32LE(ptr) !== 0x02014b50) break
      const method = cd.readUInt16LE(ptr + 10)
      const compressedSize = cd.readUInt32LE(ptr + 20)
      const nameLen = cd.readUInt16LE(ptr + 28)
      const extraLen = cd.readUInt16LE(ptr + 30)
      const commentLen = cd.readUInt16LE(ptr + 32)
      const localOffset = cd.readUInt32LE(ptr + 42)
      const name = cd.toString("utf8", ptr + 46, ptr + 46 + nameLen)

      // The local header repeats name/extra with its own lengths; data begins after them.
      const lh = Buffer.alloc(30)
      fs.readSync(fd, lh, 0, 30, localOffset)
      const dataStart = localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)

      entries.set(name, { name, method, compressedSize, dataStart })
      ptr += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    fs.closeSync(fd)
  }
}

function entryStream(path: string, entry: ZipEntry): NodeJS.ReadableStream {
  const raw = fs.createReadStream(path, {
    start: entry.dataStart,
    end: entry.dataStart + entry.compressedSize - 1,
  })
  if (entry.method === 0) return raw
  if (entry.method === 8) return raw.pipe(zlib.createInflateRaw())
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`)
}

async function readEntryText(path: string, entry: ZipEntry): Promise<string> {
  const chunks: Buffer[] = []
  const stream = entryStream(path, entry)
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c)
  return Buffer.concat(chunks).toString("utf8")
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
}

function decodeXml(s: string): string {
  if (!s.includes("&")) return s
  return s.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (m) => {
    const named = XML_ENTITIES[m]
    if (named) return named
    const hex = m.startsWith("&#x") || m.startsWith("&#X")
    const code = Number.parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  })
}

/**
 * Parse sharedStrings.xml into an array. Each <si> may hold one <t> or several <r><t> runs
 * (rich text); all runs concatenate into one logical string.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml))) {
    const inner = m[1]
    let text = ""
    let t: RegExpExecArray | null
    tRe.lastIndex = 0
    while ((t = tRe.exec(inner))) text += t[1]
    out.push(decodeXml(text))
  }
  return out
}

/** 'BC12' -> 54 (0-based column index). */
function columnIndex(ref: string): number {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

export interface XlsxStreamOptions {
  /** Worksheet entry name. Defaults to the first sheet. DOL sheet NAMES are inconsistent. */
  sheetPath?: string
}

/**
 * Yield worksheet rows as string arrays. Empty trailing cells are omitted, so callers should
 * index defensively — DOL files pad with hundreds of thousands of blank rows (filter on a
 * required column such as CASE_NUMBER rather than trusting the row count).
 */
export async function* streamXlsxRows(
  path: string,
  options: XlsxStreamOptions = {}
): AsyncGenerator<string[]> {
  const entries = readCentralDirectory(path)

  const sharedEntry = entries.get("xl/sharedStrings.xml")
  const shared = sharedEntry ? parseSharedStrings(await readEntryText(path, sharedEntry)) : []

  const sheetPath =
    options.sheetPath ??
    [...entries.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort()[0]
  const sheetEntry = sheetPath ? entries.get(sheetPath) : undefined
  if (!sheetEntry) throw new Error(`No worksheet found in ${path}`)

  let buf = ""
  let row: string[] = []
  let maxCol = -1

  const flushRow = (): string[] | null => {
    if (maxCol < 0) return null
    const out = new Array<string>(maxCol + 1)
    for (let i = 0; i <= maxCol; i++) out[i] = row[i] ?? ""
    return out
  }

  for await (const chunk of entryStream(path, sheetEntry) as AsyncIterable<Buffer>) {
    buf += chunk.toString("utf8")

    // Process only complete rows; keep the remainder for the next chunk.
    let rowEnd: number
    while ((rowEnd = buf.indexOf("</row>")) !== -1) {
      const rowStart = buf.lastIndexOf("<row", 0) // guarded below
      const segment = buf.slice(0, rowEnd)
      buf = buf.slice(rowEnd + "</row>".length)

      const open = segment.indexOf("<row")
      if (open === -1) continue
      const rowXml = segment.slice(open)
      void rowStart

      row = []
      maxCol = -1

      // <c r="A1" t="s"><v>0</v></c>  |  <c r="B1" t="inlineStr"><is><t>x</t></is></c>
      const cellRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(rowXml))) {
        const attrs = cm[1]
        const inner = cm[3] ?? ""

        const refM = /r="([A-Z]+)\d+"/.exec(attrs)
        if (!refM) continue
        const col = columnIndex(refM[1])
        if (col < 0) continue

        const typeM = /t="([^"]+)"/.exec(attrs)
        const type = typeM ? typeM[1] : null

        let value = ""
        if (type === "inlineStr") {
          let t: RegExpExecArray | null
          const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
          while ((t = tRe.exec(inner))) value += t[1]
          value = decodeXml(value)
        } else {
          const vM = /<v>([\s\S]*?)<\/v>/.exec(inner)
          if (vM) {
            const rawVal = vM[1]
            if (type === "s") {
              const idx = Number.parseInt(rawVal, 10)
              value = Number.isFinite(idx) ? shared[idx] ?? "" : ""
            } else {
              value = decodeXml(rawVal)
            }
          }
        }

        row[col] = value
        if (col > maxCol) maxCol = col
      }

      const emitted = flushRow()
      if (emitted) yield emitted
    }
  }
}
