import type { CapabilityCheck } from '@overlay/app-core'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import type {
  AuthorizationDecision,
} from '@overlay/authz-contracts'
import type {
  AuthorizationRouteEvaluation,
  AuthorizationRoutePolicy,
} from '@/server/authorization'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'

export type AppApiRouteContext = {
  params: Promise<Record<string, string | string[]>>
  auth: AuthenticatedAppUser
  parsedQuery: Record<string, unknown>
  parsedJson: Record<string, unknown>
  parsedFormData: FormData | null
  capabilities: CapabilityCheck
  appDataCapabilities: AppDataCapabilities
  workspace: WorkspaceAccess
  authorization?: {
    evaluation: AuthorizationRouteEvaluation
    policy: AuthorizationRoutePolicy
    resourceDecision?: AuthorizationDecision
    resourceId?: string
    resourceOwnerUserId?: string
    grantedResources?: Array<{ ownerUserId: string; resourceId: string }>
  }
  requestFingerprint: string
  requestIdempotencyKey: string | null
}

export function getAuthorizedResourceUserId(context: AppApiRouteContext): string {
  return context.authorization?.resourceOwnerUserId ?? context.auth.userId
}

export function getGrantedResources(context: AppApiRouteContext) {
  return context.authorization?.grantedResources ?? []
}
