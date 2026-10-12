'use client'

import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { isSoloWorkspace } from '@/shared/workspaces/solo-workspace'

/** Whether the active workspace has one person in it (false while that is not known). The interface simplifies for it. */
export function useIsSoloWorkspace(): boolean {
  return isSoloWorkspace(useOptionalWorkspace()?.activeWorkspace)
}
