# Apex Signal API Webhooks

## Delivery model
Apex Signal API delivers write-side events asynchronously to each active customer subscription.

Current event types:
- `signal.job_ingested`
- `signal.outcome_recorded`

Delivery behavior:
- Events are queued at write time and delivered by an async worker.
- Non-2xx responses are retried with backoff up to the subscription job's `max_attempts`.
- Failed jobs land in dead-letter state and can be replayed from `/admin/signal-api`.
- The same `event.id` may be delivered more than once. Treat it as your idempotency key.

## Request headers
Every webhook request includes:
- `X-Apex-Webhook-Id`: stable event UUID
- `X-Apex-Event-Type`: event name
- `X-Apex-Webhook-Attempt`: 1-based delivery attempt number
- `X-Apex-Webhook-Timestamp`: ISO-8601 timestamp used in the signature
- `X-Apex-Webhook-Signature`: `sha256=<hex-hmac>`

## Signature verification
Compute the expected HMAC over the raw request body:

```text
expected = hex(hmac_sha256(signing_secret, `${timestamp}.${rawBody}`))
```

Compare that value to the `X-Apex-Webhook-Signature` header after removing the `sha256=` prefix.

Important:
- Use the raw request body bytes, not a parsed/re-serialized JSON object.
- Reject missing timestamps or signatures.
- Use constant-time comparison.
- Optionally reject stale timestamps, for example older than 5 minutes.

## Node.js example

```ts
import { createHmac, timingSafeEqual } from "crypto"

export async function verifyApexWebhook(req: Request, signingSecret: string) {
  const timestamp = req.headers.get("x-apex-webhook-timestamp")
  const header = req.headers.get("x-apex-webhook-signature")
  if (!timestamp || !header?.startsWith("sha256=")) return false

  const rawBody = await req.text()
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")

  const provided = header.slice("sha256=".length)
  const expectedBuf = Buffer.from(expected, "hex")
  const providedBuf = Buffer.from(provided, "hex")
  if (expectedBuf.length !== providedBuf.length) return false

  return timingSafeEqual(expectedBuf, providedBuf)
}
```

## Python example

```python
import hmac
import hashlib


def verify_apex_webhook(raw_body: bytes, timestamp: str, signature_header: str, signing_secret: str) -> bool:
    if not signature_header.startswith("sha256="):
        return False

    provided = signature_header[len("sha256="):]
    payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(
        signing_secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, provided)
```

## Go example

```go
import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/hex"
)

func VerifyApexWebhook(rawBody []byte, timestamp, signatureHeader, signingSecret string) bool {
  const prefix = "sha256="
  if len(signatureHeader) <= len(prefix) || signatureHeader[:len(prefix)] != prefix {
    return false
  }

  mac := hmac.New(sha256.New, []byte(signingSecret))
  mac.Write([]byte(timestamp))
  mac.Write([]byte("."))
  mac.Write(rawBody)
  expected := hex.EncodeToString(mac.Sum(nil))
  provided := signatureHeader[len(prefix):]
  return hmac.Equal([]byte(expected), []byte(provided))
}
```

## Local testing
1. Create a subscription in `/admin/signal-api` pointing to a local receiver URL.
2. Trigger a test event or a real `jobs/ingest` or `feedback/outcomes` write.
3. Run the async worker through the admin panel or `GET /api/cron/signal-api-webhooks` with `CRON_SECRET`.
4. Verify the receiver saw the headers above and the signature matched the raw body.

## Operations
Use `/admin/signal-api` to:
- rotate signing secrets
- export delivery logs as CSV
- replay failed deliveries
- manually drain queued jobs
