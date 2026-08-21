/**
 * Whether a URL can be shown inside the link preview panel.
 *
 * The check runs server-side (see `/api/v1/link-preview`) because a frame
 * blocked by `X-Frame-Options` or `frame-ancestors` still fires `load` in the
 * browser — headers are the only reliable signal. Results are cached per URL so
 * reopening the same link is instant.
 */
const cache = new Map<string, Promise<boolean>>()
const MAX_CACHED = 32

export async function checkLinkEmbeddable(url: string): Promise<boolean> {
  const cached = cache.get(url)
  if (cached) return cached

  const pending = (async () => {
    try {
      const response = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, {
        credentials: 'same-origin',
      })
      if (!response.ok) return true
      const body = await response.json() as { embeddable?: boolean }
      return body.embeddable !== false
    } catch {
      // Assume it frames; the panel's load timeout is the backstop.
      return true
    }
  })()

  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(url, pending)
  return pending
}
