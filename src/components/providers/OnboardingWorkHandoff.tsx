'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'

type WorkHandoff = { taskId: string; onReady(): void; onTaskMissing(): void }
const WorkHandoffContext = createContext<WorkHandoff | null>(null)

export function OnboardingWorkHandoff({ pending, children }: { pending: WorkHandoff | null; children: ReactNode }) {
  return <WorkHandoffContext.Provider value={pending}>
    <div className={pending ? 'hidden' : 'contents'} hidden={Boolean(pending)} inert={Boolean(pending)}>{children}</div>
  </WorkHandoffContext.Provider>
}

export function useOnboardingWorkReady(taskId: string | null, ready: boolean) {
  const pending = useContext(WorkHandoffContext)
  useEffect(() => {
    if (!pending || !ready) return
    if (taskId === pending.taskId) pending.onReady()
    else pending.onTaskMissing()
  }, [pending, ready, taskId])
}
