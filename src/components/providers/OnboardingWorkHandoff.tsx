'use client'

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

type WorkHandoff = { taskId: string; onReady(): void; onTaskMissing(): void }
const WorkHandoffContext = createContext<WorkHandoff | null>(null)

export function OnboardingWorkHandoff({ pending, children }: { pending: WorkHandoff | null; children: ReactNode }) {
  return <WorkHandoffContext.Provider value={pending}>
    <div className={pending ? 'absolute inset-0 z-0' : 'contents'} aria-hidden={Boolean(pending)} inert={Boolean(pending)}>{children}</div>
  </WorkHandoffContext.Provider>
}

export function useOnboardingWorkReady(taskId: string | null, ready: boolean) {
  const pending = useContext(WorkHandoffContext)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pending || !ready) return
    if (taskId !== pending.taskId) {
      pending.onTaskMissing()
      return
    }
    let frame = 0
    const afterPaint = () => {
      const panel = content.current?.closest<HTMLElement>('[data-slot="app-screen-right-panel"]')
      if (panel && (panel.getAttribute('aria-hidden') === 'true'
        || Number(getComputedStyle(panel).opacity) < 1 || panel.getBoundingClientRect().width === 0)) {
        frame = requestAnimationFrame(afterPaint)
        return
      }
      frame = requestAnimationFrame(pending.onReady)
    }
    frame = requestAnimationFrame(afterPaint)
    return () => cancelAnimationFrame(frame)
  }, [pending, ready, taskId])
  return content
}
