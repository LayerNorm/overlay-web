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

const actConversationRepository = repositoryProxy<ActConversationRepository>(
  () => getOverlayServerContext().appData.repositories.conversations,
)

export const actContextService = new ActContextService({
  repository: actConversationRepository,
})

export const actEntitlementService = new ActEntitlementService({
  repository: actConversationRepository,
})

export const actGeneratingMessageService = new ActGeneratingMessageService({
  repository: actConversationRepository,
})

export const actMessagePersistenceService = new ActMessagePersistenceService({
  generatingMessages: actGeneratingMessageService,
  repository: actConversationRepository,
})

export const actUsageBudgetService = new ActUsageBudgetService({
  repository: actConversationRepository,
})

export function actConversationErrorResponse(error: unknown) {
  if (error instanceof ActConversationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return null
}
