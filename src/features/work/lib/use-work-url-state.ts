'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { WORK_FILTER_PARAM, parseWorkFilter, type WorkFilter } from '@/shared/work/query'

export const WORK_TASK_PARAM = 'task'

/**
 * The parts of the Work page that live in the URL besides scope and view: the filter chip and the open task. They are
 * kept there so a link opens where it was copied, and Back closes a task instead of leaving the page.
 */
export function useWorkUrlState() {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const filter = parseWorkFilter(params?.get(WORK_FILTER_PARAM))
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
    filter,
    taskId,
    setFilter: (next: WorkFilter) => update({ [WORK_FILTER_PARAM]: next === 'all' ? null : next }),
    openTask: (id: string) => update({ [WORK_TASK_PARAM]: id }, 'push'),
    closeTask: () => update({ [WORK_TASK_PARAM]: null }),
  }
}
