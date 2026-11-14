export function isWorkspaceSetupRequired(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'status' in error && error.status === 409
    && 'code' in error && error.code === 'workspace_setup_required'
}
