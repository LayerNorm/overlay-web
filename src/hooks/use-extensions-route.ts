'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

/**
 * URL state for the Extensions catalog: the open Browse section (`category`), plus one-shot `add` and `id` params
 * that open an add dialog or an item (from global search or another Extensions page). Keeping the section in the URL
 * makes the back button and the breadcrumb return to the overview.
 */
export function useExtensionsRoute() {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/tools'
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''

  const hrefWith = useCallback((change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(query)
    change(params)
    return `${pathname}${params.size ? `?${params}` : ''}`
  }, [pathname, query])

  const openCategory = useCallback((category: string | null) => {
    router.push(hrefWith(params => { if (category) params.set('category', category); else params.delete('category') }))
  }, [hrefWith, router])

  /** Opens another Extensions page, optionally asking it to open its add dialog. */
  const openView = useCallback((view: 'connectors' | 'skills' | 'mcps', options?: { add?: boolean }) => {
    router.push(hrefWith(params => {
      params.set('view', view)
      for (const key of ['category', 'add', 'id']) params.delete(key)
      if (options?.add) params.set('add', '1')
    }))
  }, [hrefWith, router])

  /** Drops the one-shot `add`/`id` params once they have been acted on. */
  const clearIntent = useCallback(() => {
    router.replace(hrefWith(params => { params.delete('add'); params.delete('id') }))
  }, [hrefWith, router])

  return {
    category: searchParams?.get('category') ?? null,
    addRequested: searchParams?.get('add') === '1',
    requestedId: searchParams?.get('id') ?? null,
    overviewHref: hrefWith(params => params.delete('category')),
    openCategory,
    openView,
    clearIntent,
  }
}

/**
 * Acts once on the page's `add`/`id` request: `resolve` returns what to open, `null` to ignore the request, or
 * `undefined` to wait (the list is still loading). The request is then dropped from the URL.
 */
export function useExtensionsIntent<Target>(
  route: ReturnType<typeof useExtensionsRoute>,
  resolve: (intent: { add: boolean; id: string | null }) => Target | null | undefined,
  open: (target: Target) => void,
) {
  const key = route.addRequested ? 'add' : route.requestedId ? `id:${route.requestedId}` : null
  const [handled, setHandled] = useState<string | null>(null)
  if (!key && handled) setHandled(null)
  if (key && key !== handled) {
    const target = resolve({ add: route.addRequested, id: route.requestedId })
    if (target !== undefined) {
      setHandled(key)
      if (target !== null) open(target)
    }
  }
  const { clearIntent } = route
  useEffect(() => {
    if (key && key === handled) clearIntent()
  }, [key, handled, clearIntent])
}
