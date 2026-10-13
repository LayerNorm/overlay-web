'use client'
import { useEffect, useState } from 'react'
import type { WorkPerson } from '@overlay/app-core/work'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

export function useWorkPeople(workspaceId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    workspaceId: string
    people: WorkPerson[]
    error: string | null
  }>({ workspaceId: '', people: [], error: null })
  useEffect(() => {
    if (!workspaceId) return
    const abort = new AbortController()
    void overlayAppClient.work
      .people({ signal: abort.signal, headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId } })
      .then((people) => {
        if (!abort.signal.aborted) setState({ workspaceId, people, error: null })
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            workspaceId,
            people: [],
            error: error instanceof Error ? error.message : 'Could not load people.',
          })
      })
    return () => abort.abort()
  }, [workspaceId, attempt])
  return {
    ...(state.workspaceId === workspaceId ? state : { workspaceId, people: [], error: null }),
    refresh: () => setAttempt((value) => value + 1),
  }
}
