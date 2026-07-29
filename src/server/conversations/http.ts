import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { ActContextService } from './ActContextService'
import { ActEntitlementService, ActConversationServiceError } from './ActEntitlementService'
import { ActGeneratingMessageService } from './ActGeneratingMessageService'
import { ActMessagePersistenceService } from './ActMessagePersistenceService'
import { ActUsageBudgetService } from './ActUsageBudgetService'
import type { ActConversationRepository } from './ActConversationRepository'

export const actConversationRepository = repositoryProxy<ActConversationRepository>(
  () => getOverlayServerContext().appData.repositories.conversations,
)

const actUsagePolicy = repositoryProxy(
  () => getOverlayServerContext().chatUsagePolicy,
)

export const actContextService = new ActContextService({
  repository: actConversationRepository,
  resolveConversationKnowledgeBaseIds: async (args) => (
    (await getOverlayServerContext().knowledgeBaseService.listConversationKnowledgeBases(args))
      .map(({ id }) => id)
  ),
  resolveProjectKnowledgeBaseIds: async (args) => (
    (await getOverlayServerContext().knowledgeBaseService.listProjectKnowledgeBases(args))
      .map(({ id }) => id)
  ),
  resolveDefaultKnowledgeBaseIds: async ({ userId }) => (
    (await getOverlayServerContext().knowledgeBaseService.listDefaultKnowledgeBasesForUser(userId))
      .map(({ id }) => id)
  ),
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
