'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export const WORK_TASK_PARAM = 'task'

/**
 * The part of the Work page that lives in the URL besides scope and view: the open task. It is
 * kept there so a link opens where it was copied, and Back closes a task instead of leaving the page.
 */
export function useWorkUrlState() {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const taskId = params?.get(WORK_TASK_PARAM) ?? null

  const update = useCallback((changes: Record<string, string | null>, mode: 'push' | 'replace' = 'replace') => {
    const next = new URLSearchParams(params?.toString() ?? '')
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    const href = query ? `${pathname}?${query}` : pathname
    if (mode === 'push') router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }, [params, pathname, router])

  return {
    taskId,
    openTask: (id: string) => update({ [WORK_TASK_PARAM]: id }, 'push'),
    closeTask: () => update({ [WORK_TASK_PARAM]: null }),
  }
}
