export const PERSONAL_WORKSPACE_NOT_COLLABORATIVE_CODE = 'personal_workspace_not_collaborative'

export const PERSONAL_WORKSPACE_NOT_COLLABORATIVE_MESSAGE =
  'Create a workspace to collaborate with other people.'

export const OPEN_CREATE_WORKSPACE_EVENT = 'overlay:open-create-workspace'

export function requestCreateWorkspace(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_WORKSPACE_EVENT))
}
