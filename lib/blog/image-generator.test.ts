import assert from "node:assert/strict"
import { test } from "node:test"
import sharp from "sharp"
import {
  applyBlogHeroTextOverlay,
  assertUsableGeneratedBlogImage,
  buildBlogHeroOverlaySvg,
  inspectGeneratedBlogImageBuffer,
  wrapHeroOverlayText,
} from "./image-generator"
import type { BlogImageInput } from "./image-generator"

const sampleInput: BlogImageInput = {
  postId: "post-1",
  category: {
    id: 1,
    slug: "h1b-visa-intel",
    name: "H1B & Visa Intel",
    description: "Visa and hiring policy updates",
    day_of_week: 1,
  },
  title: "USCIS RFE Deadlines Collapse to 30 Days: File Perfect From Day One",
  excerpt: "A shorter review window changes how candidates and employers should prepare evidence before filing.",
}

async function patternedImageBuffer(): Promise<Buffer> {
  const width = 1200
  const height = 800
  const channels = 3
  const data = Buffer.alloc(width * height * channels)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      data[i] = (x * 3 + y) % 256
      data[i + 1] = (x + y * 2) % 256
      data[i + 2] = x < width / 2 ? 24 : 245
    }
  }

  return sharp(data, { raw: { width, height, channels } })
    .webp({ quality: 85 })
    .toBuffer()
}

test("accepts a sufficiently detailed generated blog image", async () => {
  const buffer = await patternedImageBuffer()
  const inspection = await assertUsableGeneratedBlogImage(buffer)

  assert.equal(inspection.width, 1200)
  assert.equal(inspection.height, 800)
  assert.ok(inspection.nonWhiteRatio > 0.5)
  assert.ok(inspection.lumaStdDev > 20)
})

test("wraps hero overlay text with a visible overflow marker", () => {
  const lines = wrapHeroOverlayText(
    "A very long title about visa policy evidence timing and employer response planning",
    24,
    2,
  )

  assert.equal(lines.length, 2)
  assert.ok(lines.every((line) => line.length <= 24))
  assert.ok(lines[1].endsWith("..."))
})

test("builds an overlay svg using escaped article copy", () => {
  const svg = buildBlogHeroOverlaySvg(
    {
      ...sampleInput,
      title: "H-1B <policy> & offers",
      excerpt: "Use employer evidence before RFE windows shrink.",
    },
    1536,
    1024,
  )

  assert.match(svg, /H1B &amp; VISA INTEL/)
  assert.match(svg, /H-1B &lt;policy&gt; &amp; offers/)
  assert.doesNotMatch(svg, /<policy>/)
})

test("applies article text overlay while preserving hero dimensions", async () => {
  const buffer = await patternedImageBuffer()
  const output = await applyBlogHeroTextOverlay(buffer, sampleInput, "webp")
  const inspection = await assertUsableGeneratedBlogImage(output)

  assert.equal(inspection.width, 1200)
  assert.equal(inspection.height, 800)
  assert.ok(output.length > 2048)
})

test("rejects a response that is too small to be a real hero image", async () => {
  await assert.rejects(
    () => inspectGeneratedBlogImageBuffer(Buffer.alloc(16)),
    /too small/i,
  )
})

test("rejects a blank white hero image", async () => {
  const buffer = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer()

  await assert.rejects(
    () => assertUsableGeneratedBlogImage(buffer),
    /blank|detail|too small/i,
  )
})

test("rejects a transparent hero image", async () => {
  const buffer = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .png()
    .toBuffer()

  await assert.rejects(
    () => assertUsableGeneratedBlogImage(buffer),
    /transparent|too small/i,
  )
})
