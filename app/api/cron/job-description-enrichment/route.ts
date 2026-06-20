import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { processPendingDescriptionEnrichmentBatch } from "@/lib/jobs/description-enrichment"
import {
  getErrorMessage,
  getPostgresErrorCode,
  isTransientPostgresError,
} from "@/lib/postgres/server"

const TRANSIENT_RETRY_DELAY_MS = 750

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const search = request.nextUrl.searchParams
  const batchSize = Number.parseInt(search.get("batch") ?? "", 10)
  const concurrency = Number.parseInt(search.get("concurrency") ?? "", 10)
  const maxAttempts = Number.parseInt(search.get("maxAttempts") ?? "", 10)
  const timeoutMs = Number.parseInt(search.get("timeoutMs") ?? "", 10)

  const options = {
    batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
    concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
    maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
  }

  let transientRetries = 0
  let result: Awaited<ReturnType<typeof processPendingDescriptionEnrichmentBatch>>
  try {
    result = await processPendingDescriptionEnrichmentBatch(options)
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      console.error("[job-description-enrichment] failed:", error)
      return NextResponse.json(
        {
          success: false,
          error: "job_description_enrichment_failed",
          message: getErrorMessage(error),
          processedAt: new Date().toISOString(),
        },
        { status: 500 }
      )
    }

    transientRetries = 1
    const code = getPostgresErrorCode(error)
    console.warn("[job-description-enrichment] transient postgres failure; retrying once", {
      code,
      message: getErrorMessage(error),
    })

    await sleep(TRANSIENT_RETRY_DELAY_MS)
    try {
      result = await processPendingDescriptionEnrichmentBatch(options)
    } catch (retryError) {
      if (!isTransientPostgresError(retryError)) {
        console.error("[job-description-enrichment] retry failed:", retryError)
        return NextResponse.json(
          {
            success: false,
            error: "job_description_enrichment_failed",
            message: getErrorMessage(retryError),
            processedAt: new Date().toISOString(),
          },
          { status: 500 }
        )
      }

      return NextResponse.json(
        {
          success: false,
          retryable: true,
          error: "transient_postgres_failure",
          code: getPostgresErrorCode(retryError),
          message: getErrorMessage(retryError),
          processedAt: new Date().toISOString(),
        },
        { status: 503 }
      )
    }
  }

  return NextResponse.json({
    success: true,
    mode: "non_ai",
    transientRetries,
    ...result,
    processedAt: new Date().toISOString(),
  })
}
