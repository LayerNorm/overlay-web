/**
 * Generic single-flight request coalescer.
 *
 * Ensures only one in-flight request for a given key exists at a time.
 * Multiple callers sharing the same key receive the same promise.
 *
 * This is the canonical pattern used across the codebase for:
 * - Chat list cache (src/shared/chat/chat-list-cache.ts)
 * - Gateway model catalog (src/components/providers/useGatewayModelCatalog.ts)
 * - BYOK models (src/components/providers/useByokModels.ts)
 * - Mention search (src/components/mentions/mention-search.ts)
 *
 * Now extracted here so chat-suggestions, billing, and capabilities can
 * share the same pattern without re-implementing it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPromise = Promise<any>

const inFlightRequests = new Map<string, AnyPromise>()

/**
 * Coalesce a request so concurrent callers share the same in-flight promise.
 * The key uniquely identifies the request (e.g. "chat-suggestions",
 * "billing:workspace-xxx").  After the promise settles, the key is cleared
 * so the next call will fetch fresh data.
 */
export function coalesceRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = inFlightRequests.get(key)
  if (existing) return existing as Promise<T>

  const promise = fetcher().finally(() => {
    inFlightRequests.delete(key)
  })
  inFlightRequests.set(key, promise)
  return promise
}
