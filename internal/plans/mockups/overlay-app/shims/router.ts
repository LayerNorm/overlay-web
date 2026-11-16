import { useSyncExternalStore } from 'react'

/** The mockup's router: the app path lives in the URL hash, so the single HTML file can be opened from disk. */
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', emit)
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history)
    window.history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
      if (url == null) return original(state, unused)
      const text = String(url)
      if (text.startsWith('#')) return original(state, unused, text)
      const target = toAppHref(text)
      if (/^https?:/.test(target)) return original(state, unused)
      original(state, unused, '#' + target)
      queueMicrotask(emit)
    }
  }
}

export const DEFAULT_PATH = '/app/work'

export function currentHref(): string {
  const raw = typeof window === 'undefined' ? '' : globalThis.location.hash.slice(1)
  return raw.startsWith('/') ? raw : DEFAULT_PATH
}

export function splitHref(href: string): { pathname: string; search: string } {
  const index = href.indexOf('?')
  const withoutHash = href.split('#')[0]
  return index === -1 ? { pathname: withoutHash, search: '' } : { pathname: withoutHash.slice(0, index), search: withoutHash.slice(index) }
}

export function toAppHref(href: string): string {
  if (href.startsWith('?')) return splitHref(currentHref()).pathname + href
  try {
    const url = new URL(href, 'https://mockup.overlay')
    if (url.origin !== 'https://mockup.overlay') return href
    return url.pathname + url.search
  } catch {
    return href
  }
}

export function navigate(href: string, replace = false) {
  const target = toAppHref(href)
  if (/^https?:/.test(target)) return
  const next = '#' + target
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
  emit()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined') window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function useHref(): string {
  return useSyncExternalStore(subscribe, currentHref, () => DEFAULT_PATH)
}
