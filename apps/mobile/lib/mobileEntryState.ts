export function mobileEntryState({
  boot,
  authLoading,
  authenticated,
  membershipsLoading,
  membershipError,
  membershipCount,
}: {
  boot: boolean
  authLoading: boolean
  authenticated: boolean
  membershipsLoading: boolean
  membershipError: string | null
  membershipCount: number
}): 'boot' | 'error' | 'workspace-required' | 'ready' {
  if (boot || authLoading || (authenticated && membershipsLoading)) return 'boot'
  if (authenticated && membershipError && membershipCount === 0) return 'error'
  if (authenticated && membershipCount === 0) return 'workspace-required'
  return 'ready'
}
