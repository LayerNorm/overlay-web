'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export const WORK_TASK_PARAM = 'task'
export const WORK_ASSIGNMENT_PARAM = 'assignment'

/**
 * The part of the Work page that lives in the URL besides scope and view: the open task or agent assignment. It is
 * kept there so a link opens where it was copied, and Back closes the panel instead of leaving the page.
 */
export function useWorkUrlState() {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const taskId = params?.get(WORK_TASK_PARAM) ?? null
  const assignmentId = params?.get(WORK_ASSIGNMENT_PARAM) ?? null

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
    assignmentId,
    openTask: (id: string) => update({ [WORK_TASK_PARAM]: id, [WORK_ASSIGNMENT_PARAM]: null }, 'push'),
    closeTask: () => update({ [WORK_TASK_PARAM]: null }),
    openAssignment: (id: string) => update({ [WORK_ASSIGNMENT_PARAM]: id, [WORK_TASK_PARAM]: null }, 'push'),
    closeAssignment: () => update({ [WORK_ASSIGNMENT_PARAM]: null }),
  }
}
