import 'server-only'

import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import {
  authorizeCapability,
  authorizeCatalogResource,
} from '@/server/authorization'
import { normalizeIntegrationProviderKey } from '@overlay/app-core'
import { actConversationRepository } from '@/server/conversations/http'
import { readProjectSettings } from '@/shared/projects/project-settings'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import type { ConversationId } from '@/server/conversations/ActConversationRepository'

/**
 * Dynamic catalog authorization for an act turn: model catalog access plus the
 * capability requirements implied by requested tools and @mentions. Returns a
 * ready-to-send denial response, or null when the turn is allowed.
 *
 * Shared by the interactive act route and the durable automation turn runner —
 * an automation execution runs under service auth, so the same policy checks
 * have to be re-evaluated inside the workflow rather than trusted from input.
 */
export async function authorizeActRequest(args: {
  authorization: AuthorizationService
  context: AppApiRouteContext
  effectiveModelId: string
  memoryEnabled: boolean
  mentions: unknown
  requestedToolIds: readonly string[]
}): Promise<NextResponse | null> {
  const modelDenied = await authorizeCatalogResource({
    authorization: args.authorization,
    capability: 'models.use',
    context: args.context,
    resourceId: args.effectiveModelId,
    resourceType: 'model',
  })
  if (modelDenied) return modelDenied

  const capabilityRequirements = new Set<AuthorizationCapability>()
  if (args.requestedToolIds.length > 0) capabilityRequirements.add('tools.use')
  if (args.requestedToolIds.includes('web_search')) capabilityRequirements.add('web_search.use')
  if (args.memoryEnabled || args.requestedToolIds.includes('memory')) capabilityRequirements.add('memory.use')
  for (const mention of Array.isArray(args.mentions) ? args.mentions : []) {
    if (!mention || typeof mention !== 'object') continue
    const type = 'type' in mention ? mention.type : undefined
    if (type === 'connector') capabilityRequirements.add('integrations.use')
    if (type === 'knowledge') capabilityRequirements.add('knowledge.read')
    if (type === 'skill') capabilityRequirements.add('skills.use')
    if (type === 'mcp') capabilityRequirements.add('mcp.use')
    if (type === 'automation') capabilityRequirements.add('automations.use')
  }
  for (const mention of Array.isArray(args.mentions) ? args.mentions : []) {
    if (!mention || typeof mention !== 'object') continue
    const type = 'type' in mention ? mention.type : undefined
    const id = 'id' in mention && typeof mention.id === 'string'
      ? normalizeIntegrationProviderKey(mention.id)
      : ''
    if (type !== 'connector' || !id) continue
    const denied = await authorizeCatalogResource({
      authorization: args.authorization,
      capability: 'integrations.use',
      context: args.context,
      resourceId: id,
      resourceType: 'connector',
    })
    if (denied) return denied
  }
  for (const capability of capabilityRequirements) {
    const denied = await authorizeCapability({
      authorization: args.authorization,
      capability,
      context: args.context,
    })
    if (denied) return denied
  }
  for (const toolId of args.requestedToolIds) {
    const denied = await authorizeCatalogResource({
      authorization: args.authorization,
      capability: 'tools.use',
      context: args.context,
      resourceId: toolId,
      resourceType: 'tool',
    })
    if (denied) return denied
  }
  return null
}

export async function resolveProjectPreferredModelId(args: {
  conversationId?: ConversationId
  projectId?: string
  userId: string
}): Promise<string | undefined> {
  try {
    const conversation = args.conversationId
      ? await actConversationRepository.getConversation({
          conversationId: args.conversationId,
          userId: args.userId,
        })
      : null
    const projectId = args.projectId?.trim() || conversation?.projectId
    if (!projectId) return undefined
    const project = await actConversationRepository.getProject({
      projectId: projectId as Id<'projects'>,
      userId: args.userId,
    })
    if (!project || project.archivedAt) return undefined
    return readProjectSettings(project.settings).preferredModelId
  } catch (_error) {
    return undefined
  }
}
