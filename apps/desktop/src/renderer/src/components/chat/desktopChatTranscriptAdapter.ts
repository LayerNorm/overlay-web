import {
  groupTranscriptMessages,
  normalizeTranscriptAssistantParts,
  selectTranscriptResponse,
  transcriptResponseId
} from '@overlay/chat-core'
import type {
  ChatMode,
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptView,
  GenerationMode,
  GenerationResult
} from '@overlay/chat-core'
import { desktopMessageToConversation } from './messageAdapter'
import type { Message, ProviderResponse } from './types'
import { deriveDesktopProviderResponseStatus } from './desktopRuntimeStatus'
import { screenshotUrl } from '../../utils/chatMediaPersistence'

export interface DesktopChatTranscriptAdapterInput {
  messages: readonly Message[]
  streamingAssistantMessageId?: string | null
  interruptedAssistantMessageId?: string | null
  defaultModelId?: string
  exchangeModes?: readonly ChatMode[]
  exchangeGenTypes?: readonly GenerationMode[]
  generationResults?: ReadonlyMap<number, readonly GenerationResult[]>
}

type ResponseSource = Message | ProviderResponse
type ExchangeCacheEntry = {
  signature: string
  responseSources: readonly ResponseSource[]
  generationResults: readonly GenerationResult[] | undefined
  assistantMessages: readonly Message[]
  exchange: ChatTranscriptExchangeView
}

type DesktopResponseCandidate = {
  modelId: string
  source: ResponseSource
  message: Message
  isLoading: boolean
  error: string | null
  status: ReturnType<typeof deriveDesktopProviderResponseStatus>
  renderParts: ProviderResponse['renderParts']
}

function sameIdentityList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function statusFromMedia(results: readonly GenerationResult[]) {
  if (results.some((result) => result.status === 'failed')) return 'error' as const
  if (results.some((result) => result.status === 'generating')) return 'streaming' as const
  if (results.length > 0 && results.every((result) => result.status === 'completed'))
    return 'completed' as const
  return 'idle' as const
}

function responseCandidates(
  assistantMessages: readonly Message[],
  defaultModelId: string
): DesktopResponseCandidate[] {
  const candidates: DesktopResponseCandidate[] = []
  for (const assistant of assistantMessages) {
    if (assistant.responses?.length) {
      for (const response of assistant.responses) {
        const candidateMessage = {
          ...assistant,
          content: response.content,
          selectedModelId: response.modelId
        }
        candidates.push({
          modelId: response.modelId,
          source: response,
          message: candidateMessage,
          isLoading: response.isLoading,
          error: response.error?.trim() || null,
          status: deriveDesktopProviderResponseStatus(response),
          renderParts: response.renderParts ?? assistant.renderParts
        })
      }
      continue
    }

    const agentError = assistant.agentSteps
      ?.findLast((step) => step.type === 'error' && step.error)
      ?.error?.trim()
    candidates.push({
      modelId: assistant.selectedModelId ?? defaultModelId,
      source: assistant,
      message: assistant,
      isLoading: false,
      error: agentError || null,
      status: assistant.status ?? (agentError ? 'error' : 'completed'),
      renderParts: assistant.renderParts
    })
  }
  return candidates
}

export function createDesktopChatTranscriptAdapter() {
  const exchangeCache = new WeakMap<Message, ExchangeCacheEntry>()

  return function desktopChatTranscriptAdapter(
    input: DesktopChatTranscriptAdapterInput
  ): ChatTranscriptView {
    const groups = groupTranscriptMessages(input.messages).filter(
      (group): group is typeof group & { user: Message } => Boolean(group.user)
    )
    const defaultModelId = input.defaultModelId ?? 'unknown-model'
    const exchanges = groups.map((group, exchangeIndex) => {
      const user = group.user
      const mode =
        input.exchangeModes?.[exchangeIndex] ??
        (group.assistants.some((message) => message.isAgentMessage) ? 'act' : 'ask')
      const generationMode =
        input.exchangeGenTypes?.[exchangeIndex] ?? group.user.generation?.kind ?? 'text'
      const mediaResults =
        input.generationResults?.get(exchangeIndex) ?? group.user.generation?.results
      const candidates = responseCandidates(group.assistants, defaultModelId)
      const responseSources = candidates.map((candidate) => candidate.source)
      const selectedModelId =
        group.assistants
          .map((assistant) => assistant.selectedModelId)
          .find((modelId): modelId is string => Boolean(modelId)) ??
        candidates[0]?.modelId ??
        null
      const responseStatuses = candidates.map((candidate) =>
        deriveDesktopProviderResponseStatus(
          {
            content: candidate.message.content,
            error: candidate.error ?? undefined,
            isLoading: candidate.isLoading,
            renderParts: candidate.renderParts,
            status: candidate.status
          },
          {
            // Message-level streaming is only a legacy fallback. Multi-model
            // responses own their individual isLoading/status fields.
            streaming:
              'role' in candidate.source &&
              candidate.message.id === input.streamingAssistantMessageId,
            interrupted:
              candidate.message.id === input.interruptedAssistantMessageId &&
              (candidate.isLoading || 'role' in candidate.source)
          }
        )
      )
      const selectedCandidate = selectTranscriptResponse(candidates, { selectedModelId })
      const exchangeStatus =
        generationMode === 'text'
          ? (responseStatuses[selectedCandidate.index] ?? 'idle')
          : statusFromMedia(mediaResults ?? [])
      const signature = JSON.stringify({
        exchangeIndex,
        mode,
        generationMode,
        selectedModelId,
        statuses: responseStatuses,
        responses: candidates.map((candidate) => ({
          modelId: candidate.modelId,
          content: candidate.message.content,
          renderPartsLength: candidate.renderParts?.length ?? 0,
          agentStepsLength: candidate.message.agentSteps?.length ?? 0,
          error: candidate.error
        })),
        exchangeStatus
      })
      const cached = exchangeCache.get(user)
      const isActivelyChanging =
        exchangeStatus === 'submitted' ||
        exchangeStatus === 'streaming' ||
        exchangeStatus === 'executing-tool'
      if (
        !isActivelyChanging &&
        cached?.signature === signature &&
        cached.generationResults === mediaResults &&
        sameIdentityList(cached.responseSources, responseSources) &&
        sameIdentityList(cached.assistantMessages, group.assistants)
      ) {
        return cached.exchange
      }

      const responses: ChatTranscriptResponseView[] = candidates.map((candidate, responseIndex) => {
        const conversationMessage = desktopMessageToConversation(candidate.message)
        const normalized = normalizeTranscriptAssistantParts(conversationMessage.parts)
        return {
          id: transcriptResponseId(group.turnId, candidate.modelId, responseIndex),
          modelId: candidate.modelId,
          blocks: normalized.blocks,
          sources: normalized.sources,
          status: responseStatuses[responseIndex] ?? 'completed',
          errorMessage: candidate.error
        }
      })
      const selected = selectTranscriptResponse(responses, { selectedModelId })
      const screenshots = user.screenshots ?? []
      const documentMentions = (user.mentions ?? []).filter(
        (mention) => mention.type === 'document'
      )
      const images = [
        ...(user.imageData
          ? [{ url: user.imageData, name: 'image-1.png', mediaType: 'image/png' }]
          : []),
        ...screenshots.map((screenshot) => ({
          url: screenshotUrl(screenshot),
          name: screenshot.name,
          mediaType: screenshot.cachedMedia?.mimeType ?? 'image/png',
          status: screenshot.loadStatus
        }))
      ].filter((image) => Boolean(image.url))
      const exchange: ChatTranscriptExchangeView = {
        id: group.turnId,
        turnId: group.turnId,
        index: exchangeIndex,
        mode,
        generationMode,
        user: {
          id: user.id,
          text: user.content,
          documentNames: documentMentions.map((mention) => mention.title),
          indexedAttachments: documentMentions.map((mention) => ({
            name: mention.title,
            fileIds: [mention.id]
          })),
          images,
          mentions: (user.mentions ?? []).map((mention) => ({
            id: mention.id,
            type: mention.type,
            name: mention.title
          })),
          replyThread: null,
          createdAt: user.timestamp
        },
        responses,
        selectedResponseIndex: selected.index,
        selectedModelId: selected.response?.modelId ?? selectedModelId,
        status: exchangeStatus,
        media:
          generationMode === 'image' || generationMode === 'video'
            ? { kind: generationMode, results: mediaResults ? [...mediaResults] : [] }
            : null
      }

      exchangeCache.set(user, {
        signature,
        responseSources,
        generationResults: mediaResults,
        assistantMessages: group.assistants,
        exchange
      })
      return exchange
    })

    return { version: 1, exchanges }
  }
}

const defaultDesktopChatTranscriptAdapter = createDesktopChatTranscriptAdapter()

export const desktopChatTranscriptAdapter = defaultDesktopChatTranscriptAdapter
