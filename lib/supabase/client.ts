import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types"

let _client: ReturnType<typeof createBrowserClient<Database>> | undefined
const authLockQueues = new Map<string, Promise<unknown>>()

async function inTabAuthLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>
) {
  const previous = authLockQueues.get(name) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(fn)
  const queued = current.catch(() => undefined).then(() => {
    if (authLockQueues.get(name) === queued) {
      authLockQueues.delete(name)
    }
  })

  authLockQueues.set(name, queued)

  return current
}

export function createClient() {
  if (!_client) {
    _client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {},
        auth: {
          lock: inTabAuthLock,
        },
      }
    )
  }
  return _client
}
