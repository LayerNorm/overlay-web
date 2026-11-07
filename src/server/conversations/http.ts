import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexActConversationRepository } from './ConvexActConversationRepository'
import { lazyService } from '@/server/lazy-service'
import { ActContextService } from './ActContextService'
import { ActEntitlementService, ActConversationServiceError } from './ActEntitlementService'
import { ActMessagePersistenceService } from './ActMessagePersistenceService'
import { ActUsageBudgetService } from './ActUsageBudgetService'
import { AgentRunService } from './AgentRunService'
import type { ActConversationRepository } from './ActConversationRepository'
import { nativeRunRetirementErrorResponse } from './native-run-retirement-http'

export const actConversationRepository: ActConversationRepository = new ConvexActConversationRepository()

const actUsagePolicy = lazyService(() => getOverlayServerContext().chatUsagePolicy)

export const actContextService = new ActContextService({
  repository: actConversationRepository,
  loadDocumentFile: async (args) => (
    await getOverlayServerContext().appData.repositories.files.getFile(args)
  ),
})

export const actEntitlementService = new ActEntitlementService({
  repository: actConversationRepository,
  usagePolicy: actUsagePolicy,
})

export const agentRunService = new AgentRunService(actConversationRepository)

export const actMessagePersistenceService = new ActMessagePersistenceService({
  repository: actConversationRepository,
})

export const actUsageBudgetService = new ActUsageBudgetService({
  policy: actUsagePolicy,
  repository: actConversationRepository,
})

export function actConversationErrorResponse(error: unknown) {
  const retirement = nativeRunRetirementErrorResponse(error)
  if (retirement) return retirement
  if (error instanceof ActConversationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return null
}
