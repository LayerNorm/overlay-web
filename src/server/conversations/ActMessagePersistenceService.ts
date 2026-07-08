import 'server-only'

import { logger } from '@/server/observability/logger'
import type { StepResult, ToolSet } from 'ai'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  buildAssistantPersistenceFromSteps,
  compactAssistantPersistenceForConvex,
  replaceAssistantTextForPersistence,
} from '@/shared/chat/persist-assistant-turn'
import { maybeRepairFreeTierLeakedPerplexityText } from '@/shared/chat/leaked-perplexity-tool-repair'
import {
  buildPersistedMessageContent,
  sanitizeMessagePartsForPersistence,
} from '@/server/chat/chat-message-persistence'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { UIMessage } from '@/server/ai/sdk'
import type { ActConversationRepository } from './ActConversationRepository'
import type { ActGeneratingMessageService } from './ActGeneratingMessageService'
import type { Id } from '../../../convex/_generated/dataModel'

type ActMessagePersistenceEvents = {
  completed(params: {
    conversationId: Id<'conversations'>
    modelId: string
    turnId: string
    userId: string
  }): void
}

const defaultEvents: ActMessagePersistenceEvents = {
  completed: (params) => {
    void import('@/server/shared/webhooks')
      .then(({ emitChatCompleted }) => emitChatCompleted(params))
      .catch((error) => logger.warn('[conversations/act] Chat completed webhook emitter unavailable:', summarizeErrorForLog(error)))
  },
}

export type ActLatestUserPersistence = {
  latestUserContent: string | undefined
  latestUserMessage?: UIMessage
  latestUserParts?: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; url?: string; mediaType?: string }
  >
  latestUserText: string | undefined
}

export type ActAssistantFinishEvent = {
  steps: StepResult<ToolSet>[]
  text: string
  totalUsage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export type ActToolFailure = {
  error: string
  toolName: string
}

export class ActMessagePersistenceService {
  private readonly events: ActMessagePersistenceEvents

  constructor(private readonly deps: {
    events?: ActMessagePersistenceEvents
    generatingMessages: ActGeneratingMessageService
    repository: ActConversationRepository
  }) {
    this.events = deps.events ?? defaultEvents
  }

  getLatestUserPersistence(args: {
    attachmentNames?: string[]
    messages: UIMessage[]
  }): ActLatestUserPersistence {
    const latestUserMessage = [...args.messages].reverse().find((m) => m.role === 'user')
    const latestUserText = latestUserMessage?.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => (p as { type: string; text?: string }).text || '')
      .join('')
      .trim()
    const latestUserParts = latestUserMessage?.parts
      ?.filter((p) => p.type === 'text' || p.type === 'file')
      .map((part) => {
        if (part.type === 'text') {
          return { type: 'text' as const, text: 'text' in part ? part.text || '' : '' }
        }
        return {
          type: 'file' as const,
          url: 'url' in part ? part.url : undefined,
          mediaType: 'mediaType' in part ? part.mediaType : undefined,
        }
      })
    const latestUserContent = buildPersistedMessageContent(undefined, latestUserParts, {
      attachmentNames: args.attachmentNames,
    }) || latestUserText

    return {
      latestUserContent,
      latestUserMessage,
      latestUserParts,
      latestUserText,
    }
  }

  async persistUserMessage(args: {
    conversationId?: Id<'conversations'>
    latestUserContent?: string
    latestUserParts?: ActLatestUserPersistence['latestUserParts']
    latestUserText?: string
    modelId: string
    skip: boolean
    skipMemoryExtraction?: boolean
    turnId: string
    userId: string
    attachmentNames?: string[]
  }): Promise<void> {
    if (args.skip || !args.conversationId || !args.latestUserContent) return
    try {
      await this.deps.repository.addMessage({
        conversationId: args.conversationId,
        userId: args.userId,
        turnId: args.turnId,
        role: 'user',
        mode: 'act',
        content: args.latestUserText || args.latestUserContent,
        contentType: 'text',
        parts: sanitizeMessagePartsForPersistence(args.latestUserParts, {
          attachmentNames: args.attachmentNames,
        }) as Array<Record<string, unknown>>,
        modelId: args.modelId,
        skipMemoryExtraction: args.skipMemoryExtraction,
      })
    } catch (err) {
      logger.error('[conversations/act] Failed to save user message:', summarizeErrorForLog(err))
    }
  }

  async persistAssistantFinish(args: {
    accessToken?: string
    attemptModelId: string
    conversationId?: Id<'conversations'>
    emitWebhook: boolean
    event: ActAssistantFinishEvent
    fallbackNotice?: string
    finishedToolCallIds: Set<string>
    generatingMessageId?: Id<'conversationMessages'>
    multiModelSlotIndex: number
    multiModelTotal: number
    routedModelId?: string
    timedOut: boolean
    timeoutMs: number
    toolFailuresByCallId: Map<string, ActToolFailure>
    turnId: string
    userId: string
  }): Promise<void> {
    if (!args.conversationId) return
    const totalUsage = args.event.totalUsage
    const totalInputTokens = totalUsage?.inputTokens ?? 0
    const totalOutputTokens = totalUsage?.outputTokens ?? 0

    try {
      let assistantPersistence = buildAssistantPersistenceFromSteps(
        args.event.steps,
        args.event.text,
      )
      if (args.attemptModelId === FREE_TIER_AUTO_MODEL_ID) {
        const repaired = await maybeRepairFreeTierLeakedPerplexityText({
          modelId: args.attemptModelId,
          steps: args.event.steps,
          text: args.event.text,
          accessToken: args.accessToken,
        })
        if (repaired) {
          assistantPersistence = replaceAssistantTextForPersistence(
            assistantPersistence,
            repaired,
          )
        }
      }
      const { content: rawPersistContent, parts: persistParts } = assistantPersistence
      let persistContent = args.fallbackNotice
        ? `${args.fallbackNotice}\n\n${rawPersistContent}`
        : rawPersistContent
      let normalizedPersistParts = persistParts.map((part) => {
        if (part.type !== 'tool-invocation') return part
        const invocation = part.toolInvocation as
          | {
              toolCallId?: string
              toolName?: string
              state?: string
              toolInput?: unknown
              toolOutput?: unknown
            }
          | undefined
        const failure = invocation?.toolCallId
          ? args.toolFailuresByCallId.get(invocation.toolCallId)
          : undefined
        if (!failure) return part
        return {
          ...part,
          toolInvocation: {
            ...invocation,
            toolName: invocation?.toolName ?? failure.toolName,
            state: 'output-error',
            toolOutput: {
              error: failure.error,
            },
          },
        }
      }).map((part) => {
        if (part.type !== 'tool-invocation') return part
        const invocation = part.toolInvocation as
          | {
              toolCallId?: string
              toolName?: string
              state?: string
              toolInput?: unknown
              toolOutput?: unknown
            }
          | undefined
        if (
          invocation?.toolCallId &&
          args.finishedToolCallIds.has(invocation.toolCallId) &&
          invocation.state !== 'output-available' &&
          invocation.state !== 'output-error' &&
          invocation.state !== 'output-denied'
        ) {
          return {
            ...part,
            toolInvocation: {
              ...invocation,
              state: 'output-available',
            },
          }
        }
        return part
      })
      if (args.fallbackNotice) {
        normalizedPersistParts = [
          { type: 'text', text: `${args.fallbackNotice}\n\n` },
          ...normalizedPersistParts,
        ]
      }

      if (args.timedOut) {
        const timedOutAfterSeconds = Math.round(args.timeoutMs / 1000)
        const sentinel = `\n\n[Request timed out after ${timedOutAfterSeconds}s. Continue?]`
        persistContent = persistContent.trimEnd() + sentinel
        normalizedPersistParts = [...normalizedPersistParts, { type: 'text', text: sentinel }]
      }

      const compactedPersistence = compactAssistantPersistenceForConvex({
        content: persistContent,
        parts: normalizedPersistParts,
      })
      persistContent = compactedPersistence.content
      normalizedPersistParts = compactedPersistence.parts

      const routedModelId =
        args.attemptModelId === FREE_TIER_AUTO_MODEL_ID
          ? (args.routedModelId || args.event.steps.at(-1)?.response.modelId)
          : undefined
      const finalParts = (
        normalizedPersistParts.length > 0
          ? normalizedPersistParts
          : [{ type: 'text', text: persistContent }]
      )
      if (args.generatingMessageId) {
        await this.deps.generatingMessages.finalize({
          messageId: args.generatingMessageId,
          content: persistContent,
          parts: finalParts,
          routedModelId,
          tokens: { input: totalInputTokens, output: totalOutputTokens },
        })
      } else {
        await this.deps.repository.addMessage({
          conversationId: args.conversationId,
          userId: args.userId,
          turnId: args.turnId,
          role: 'assistant',
          mode: 'act',
          content: persistContent,
          contentType: 'text',
          parts: finalParts,
          modelId: args.attemptModelId,
          routedModelId,
          tokens: { input: totalInputTokens, output: totalOutputTokens },
          variantIndex: args.multiModelTotal > 1 ? args.multiModelSlotIndex : undefined,
        })
      }
      if (args.emitWebhook) {
        this.events.completed({
          userId: args.userId,
          conversationId: args.conversationId,
          turnId: args.turnId,
          modelId: args.attemptModelId,
        })
      }
    } catch (err) {
      logger.error('[conversations/act] Failed to save assistant message:', summarizeErrorForLog(err))
    }
  }
}
