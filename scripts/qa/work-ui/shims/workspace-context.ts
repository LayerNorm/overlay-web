const solo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('solo') === '1'
const role = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('role')) || 'owner'
const activeWorkspace = { id: 'ws-1', role, humanMemberCount: solo ? 1 : 3 }
export function useWorkspace() {
  return { activeWorkspaceId: 'ws-1', activeWorkspace }
}
export function useOptionalWorkspace() {
  return useWorkspace()
}
