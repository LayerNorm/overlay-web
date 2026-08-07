export const WORKSPACE_CHANGED_EVENT = 'overlay:workspace-changed'

export type WorkspaceChangedEventDetail = {
  previousWorkspaceId: string | null
  workspaceId: string
}

export function dispatchWorkspaceChanged(detail: WorkspaceChangedEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<WorkspaceChangedEventDetail>(WORKSPACE_CHANGED_EVENT, {
    detail,
  }))
}
