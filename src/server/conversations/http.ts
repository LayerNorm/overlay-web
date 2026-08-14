import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { ActContextService } from './ActContextService'
import { ActEntitlementService, ActConversationServiceError } from './ActEntitlementService'
import { ActGeneratingMessageService } from './ActGeneratingMessageService'
import { ActMessagePersistenceService } from './ActMessagePersistenceService'
import { ActUsageBudgetService } from './ActUsageBudgetService'
import { AgentRunService } from './AgentRunService'
import type { ActConversationRepository } from './ActConversationRepository'

export const actConversationRepository = repositoryProxy<ActConversationRepository>(
  () => getOverlayServerContext().appData.repositories.conversations,
)

const actUsagePolicy = repositoryProxy(
  () => getOverlayServerContext().chatUsagePolicy,
)

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

export const actGeneratingMessageService = new ActGeneratingMessageService({
  repository: actConversationRepository,
})

export const agentRunService = new AgentRunService(actConversationRepository)

export const actMessagePersistenceService = new ActMessagePersistenceService({
  generatingMessages: actGeneratingMessageService,
  repository: actConversationRepository,
})

export const actUsageBudgetService = new ActUsageBudgetService({
  policy: actUsagePolicy,
  repository: actConversationRepository,
})

export function actConversationErrorResponse(error: unknown) {
  if (error instanceof ActConversationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return null
}
