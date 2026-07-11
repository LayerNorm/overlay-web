import 'server-only'

import { logger } from '@/server/observability/logger'
import { userFacingOpenRouterError } from '@/server/ai/model-runtime'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { ActConversationRepository } from './ActConversationRepository'
import type { Id } from '../../../convex/_generated/dataModel'

type ActGeneratingMessageEvents = {
  failed(params: {
    conversationId?: Id<'conversations'>
    error: string
    turnId?: string
    userId: string
  }): void
}

const defaultEvents: ActGeneratingMessageEvents = {
  failed: (params) => {
    void import('@/server/shared/webhooks')
      .then(({ emitChatFailed }) => emitChatFailed(params))
      .catch((error) => logger.warn('[conversations/act] Chat failed webhook emitter unavailable:', summarizeErrorForLog(error)))
  },
}

export class ActGeneratingMessageService {
  private readonly events: ActGeneratingMessageEvents

  constructor(private readonly deps: {
    events?: ActGeneratingMessageEvents
    repository: ActConversationRepository
  }) {
    this.events = deps.events ?? defaultEvents
  }

  async start(args: {
    conversationId?: Id<'conversations'>
    modelId: string
    multiModelSlotIndex: number
    multiModelTotal: number
    turnId: string
    userId: string
  }): Promise<Id<'conversationMessages'> | undefined> {
    if (!args.conversationId) return undefined
    try {
      return await this.deps.repository.startGeneratingMessage({
        conversationId: args.conversationId,
        userId: args.userId,
        turnId: args.turnId,
        mode: 'act',
        modelId: args.modelId,
        variantIndex: args.multiModelTotal > 1 ? args.multiModelSlotIndex : undefined,
      }) ?? undefined
    } catch (err) {
      logger.error('[conversations/act] Failed to start generating assistant message:', summarizeErrorForLog(err))
      return undefined
    }
  }

  async finalize(args: {
    content: string
    messageId: Id<'conversationMessages'>
    parts: Array<Record<string, unknown>>
    routedModelId?: string
    tokens: { input: number; output: number }
  }): Promise<void> {
    await this.deps.repository.finalizeGeneratingMessage(args)
  }

  async appendTextDelta(args: {
    messageId: Id<'conversationMessages'>
    textDelta: string
  }): Promise<boolean> {
    if (!args.textDelta) return true
    try {
      return await this.deps.repository.appendGeneratingMessageDelta(args)
    } catch (err) {
      logger.warn('[conversations/act] Failed to persist generating message delta:', summarizeErrorForLog(err))
      return true
    }
  }

  async fail(args: {
    conversationId?: Id<'conversations'>
    emitWebhook: boolean
    error: unknown
    messageId?: Id<'conversationMessages'>
    turnId?: string
    userId?: string
  }): Promise<void> {
    if (!args.messageId) return
    const errorText = userFacingOpenRouterError(args.error)
    try {
      await this.deps.repository.failGeneratingMessage({
        messageId: args.messageId,
        errorText,
      })
      if (args.emitWebhook && args.userId) {
        this.events.failed({
          userId: args.userId,
          conversationId: args.conversationId,
          turnId: args.turnId,
          error: errorText,
        })
      }
    } catch (err) {
      logger.error('[conversations/act] Failed to mark generating message failed:', summarizeErrorForLog(err))
    }
  }
}
