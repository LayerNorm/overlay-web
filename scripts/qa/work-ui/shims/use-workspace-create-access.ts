const role = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('role')) || 'owner'
const policy = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('policy') === 'admins' ? 'admins' : 'members'
export function useWorkspaceCreateAccess() {
  return {
    access: {
      scope: { workspaceExtensionsEditors: 'members', workspaceContentEditors: policy, memberCanMoveScope: true },
      memberCanCreateChannels: true,
      memberCanCreateAgents: true,
    },
    viewer: { userId: '', role },
    canCreate: () => true,
  }
}
