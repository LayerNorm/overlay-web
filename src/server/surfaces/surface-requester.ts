import type { ResolvedInboundBinding } from './SurfaceService'

export function resolveSurfaceRequester(source: Pick<ResolvedInboundBinding, 'creatorUserId' | 'creatorPrincipalId'>) {
  return { userId: source.creatorUserId, principalId: source.creatorPrincipalId }
}
