import type { CapabilityCheck } from '@overlay/app-core'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'

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
  authorization?: AuthorizationService
}

/**
 * Returns the user id that owns the resource being mutated. Until workspace
 * sharing is fully wired, this is the authenticated user's own id.
 */
export function getAuthorizedResourceUserId(context: AppApiRouteContext): string {
  return context.auth.userId
}

/**
 * Returns resources the caller can see via workspace sharing grants. Until
 * workspace sharing is fully wired, returns an empty list.
 */
export function getGrantedResources(_context: AppApiRouteContext): Array<{ ownerUserId: string; resourceId: string }> {
  return []
}

export function getBillingProgrammaticSubjectId(
  context: AppApiRouteContext,
  explicitResourceId?: string | null,
): string | undefined {
  const explicit = explicitResourceId?.trim()
  if (explicit) return explicit
  return context.auth.apiKeyId ? `api-key:${context.auth.apiKeyId}` : undefined
}

export function getTrustedAutomationBillingSubjectId(
  context: AppApiRouteContext,
): string | undefined {
  if (context.auth.authType !== 'service') return undefined
  const automationId = typeof context.parsedJson.automationId === 'string'
    ? context.parsedJson.automationId.trim()
    : ''
  return automationId ? `automation:${automationId}` : undefined
}
