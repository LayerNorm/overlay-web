import { useMemo, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '')
  return useMemo(() => new URLSearchParams(search), [search])
}

export function usePathname() {
  return '/app/work'
}

export function useRouter() {
  return useMemo(() => ({
    push: (href: string) => { window.history.pushState(null, '', href); emit() },
    replace: (href: string) => { window.history.replaceState(null, '', href); emit() },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => undefined,
    prefetch: () => undefined,
  }), [])
}
