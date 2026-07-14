import { NextRequest, NextResponse } from "next/server"
import { Readable } from "stream"
import { getBlogImageObject, normalizeBlogImageKey } from "@/lib/blog/image-storage"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: { key?: string[] } }
) {
  const key = params.key?.join("/") ?? ""

  try {
    const safeKey = normalizeBlogImageKey(key)
    const object = await getBlogImageObject(safeKey)
    const body = Readable.toWeb(object.stream as Readable) as ReadableStream
    const headers = new Headers({
      "Content-Type": object.contentType ?? "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    })

    if (object.size !== null) headers.set("Content-Length", String(object.size))
    if (object.etag) headers.set("ETag", object.etag)
    if (object.lastModified) headers.set("Last-Modified", object.lastModified.toUTCString())

    return new NextResponse(body, { headers })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}
