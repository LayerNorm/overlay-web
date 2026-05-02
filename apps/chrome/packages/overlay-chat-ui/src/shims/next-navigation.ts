/**
 * `next/navigation` shim. The side panel uses `chrome.tabs` / `window.location`
 * for any URL work, so the typical Next router APIs are no-ops here. Keeping
 * the surface available lets us sync files verbatim from overlay-landing.
 */

export function useRouter() {
  return {
    push(_url: string) {
      /* side panel has no router; callers should use chrome APIs */
    },
    replace(_url: string) {
      /* no-op */
    },
    back() {
      /* no-op */
    },
    forward() {
      /* no-op */
    },
    refresh() {
      /* no-op */
    },
    prefetch(_url: string) {
      /* no-op */
    },
  }
}

export function usePathname(): string {
  return typeof window !== 'undefined' ? window.location.pathname : '/'
}

type SearchParamsLike = {
  get(name: string): string | null
  getAll(name: string): string[]
  has(name: string): boolean
  toString(): string
  entries(): IterableIterator<[string, string]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string>
}

export function useSearchParams(): SearchParamsLike {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}
