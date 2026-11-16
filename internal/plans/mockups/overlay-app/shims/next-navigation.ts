import { useMemo } from 'react'
import { navigate, splitHref, useHref } from './router'

export function useSearchParams() {
  const href = useHref()
  const { search } = splitHref(href)
  return useMemo(() => new URLSearchParams(search), [search])
}

export function usePathname() {
  return splitHref(useHref()).pathname
}

export function useParams() {
  return {}
}

export function useSelectedLayoutSegment() {
  return null
}

export function useSelectedLayoutSegments() {
  return []
}

const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => undefined,
  prefetch: () => undefined,
}

export function useRouter() {
  return router
}

export function redirect(href: string): never {
  navigate(href, true)
  throw new Error('redirect ' + href)
}

export function notFound(): never {
  throw new Error('not found')
}

export const RedirectType = { push: 'push', replace: 'replace' }
