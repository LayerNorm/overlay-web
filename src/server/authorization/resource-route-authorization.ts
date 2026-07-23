import 'server-only'

import type { AuthorizationDecision } from '@overlay/authz-contracts'
import type { AuthorizationService } from './AuthorizationService'
import type {
  AuthorizationEnforcementMode,
  AuthorizationRouteEvaluation,
} from './authorization-enforcement'
import type { AuthorizationRoutePolicy } from './authorization-route-policy'

const RESOURCE_ID_KEYS: Record<string, readonly string[]> = {
  conversation: ['conversationId'],
  file: ['fileId'],
  note: ['noteId'],
  output: ['outputId'],
  project: ['projectId'],
}

export type ResourceRouteAuthorization = {
  grantedResources?: Array<{ ownerUserId: string; resourceId: string }>
  decision?: AuthorizationDecision
  ownerUserId?: string
  resourceId?: string
}

export async function evaluateResourceRoute(args: {
  authorization: AuthorizationService
  evaluation: AuthorizationRouteEvaluation
  mode: AuthorizationEnforcementMode
  params: Record<string, string | string[]>
  parsedJson: Record<string, unknown>
  parsedQuery: Record<string, unknown>
  policy: AuthorizationRoutePolicy
}): Promise<ResourceRouteAuthorization> {
  const resource = args.policy.resource
  const subject = args.evaluation.subject
  if (args.policy.access !== 'resource' || !resource || !subject) return {}

  const resourceId = firstString(
    resource.identifiers ?? RESOURCE_ID_KEYS[resource.type] ?? [],
    args.params,
    args.parsedJson,
    args.parsedQuery,
  )
  if (!resourceId) {
    if (!resource.optional) return {}
    if (args.evaluation.decisions.some(({ allowed }) => !allowed)) return {}
    return {
      grantedResources: await args.authorization.listAccessibleResources({
        action: resource.action,
        resourceType: resource.type,
        subject,
      }),
    }
  }

  const ownerUserId = await args.authorization.getResourceOwner({
    resourceId,
    resourceType: resource.type,
  })
  if (!ownerUserId) {
    return {
      resourceId,
      decision: {
        allowed: false,
        capability: args.policy.capabilities?.[0] ?? resourceCapability(resource.type),
        reason: 'resource_access_missing',
        resourceType: resource.type,
        resourceId,
        requiredAction: resource.action,
      },
    }
  }

  const decision = await args.authorization.checkResolvedResourceAccess({
    action: resource.action,
    capability: args.policy.capabilities?.[0] ?? resourceCapability(resource.type),
    ownerUserId,
    resourceId,
    resourceType: resource.type,
    subject,
  })
  return {
    decision,
    ownerUserId: decision.allowed ? ownerUserId : undefined,
    resourceId,
  }
}

function firstString(
  keys: readonly string[],
  ...sources: Array<Record<string, unknown>>
): string | undefined {
  for (const key of keys) {
    for (const source of sources) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
        return value[0].trim()
      }
    }
  }
  return undefined
}

function resourceCapability(resourceType: string) {
  switch (resourceType) {
    case 'conversation': return 'conversations.read' as const
    case 'file': return 'files.read' as const
    case 'note': return 'notes.read' as const
    case 'output': return 'outputs.read' as const
    case 'project': return 'projects.read' as const
    default: throw new Error(`No authorization capability for resource type ${resourceType}`)
  }
}
