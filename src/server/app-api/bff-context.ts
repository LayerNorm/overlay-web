import type { CapabilityCheck } from '@overlay/app-core'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'

export type AppApiRouteContext = {
  params: Promise<Record<string, string | string[]>>
  auth: AuthenticatedAppUser
  parsedQuery: Record<string, unknown>
  parsedJson: Record<string, unknown>
  parsedFormData: FormData | null
  capabilities: CapabilityCheck
  appDataCapabilities: AppDataCapabilities
  requestFingerprint: string
  requestIdempotencyKey: string | null
  workspace: WorkspaceAccess
}

export type GrantedResource = {
  resourceId: string
  ownerUserId: string
}

/**
 * Returns the userId that owns the resource being accessed.
 * For own resources, this is the authenticated user.
 * For shared resources, this would be the resource owner's userId.
 * Until resource sharing is fully rolled out, this returns the authenticated user.
 */
export function getAuthorizedResourceUserId(context: AppApiRouteContext): string {
  return context.auth.userId
}

/**
 * Returns resources granted to the current user in the active workspace.
 * Until resource sharing is fully rolled out, this returns an empty array.
 */
export function getGrantedResources(_context: AppApiRouteContext): GrantedResource[] {
  return []
}
