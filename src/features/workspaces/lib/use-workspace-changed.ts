'use client'

import { useEffect } from 'react'
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedEventDetail } from './workspace-events'

/**
 * Calls `callback` whenever the active workspace changes.
 * Uses the `overlay:workspace-changed` window event dispatched by WorkspaceProvider.
 */
export function useWorkspaceChanged(callback: (detail: WorkspaceChangedEventDetail) => void) {
  useEffect(() => {
    function handler(event: Event) {
      const detail = (event as CustomEvent<WorkspaceChangedEventDetail>).detail
      callback(detail)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handler)
  }, [callback])
}
