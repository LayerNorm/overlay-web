import { cloneGenerationResultsMap } from '@overlay/chat-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { VideoSubMode } from '@/shared/ai/gateway/model-types'
import { buildMediaSummary } from '@overlay/chat-core'
import type { ConversationRuntime, ConversationUiState, GenerationResult } from '../chat-interface/types'

type MediaKind = 'image' | 'video'
type CompleteSession = (chatId: string, active: boolean) => void
type RefreshAfterTurn = () => unknown | Promise<unknown>
type UpdateRuntimeUiState = (
  chatId: string,
  updater: (prev: ConversationUiState) => ConversationUiState,
) => void

interface MediaGenerationBaseParams {
  chatId: string
  temporaryChat?: boolean
  turnId: string
  exchIdx: number
  promptForModel: string
  userPromptText: string
  modelId: string
  targetRuntime: ConversationRuntime
  isChatActive: (chatId: string) => boolean
  updateRuntimeUiState: UpdateRuntimeUiState
  completeSession: CompleteSession
  loadChats: RefreshAfterTurn
  loadSubscription: RefreshAfterTurn
}

export interface RunImageGenerationBatchParams extends MediaGenerationBaseParams {
  imageUrl?: string | null
}

export interface RunVideoGenerationBatchParams extends MediaGenerationBaseParams {
  videoSubMode: VideoSubMode
  imageUrl?: string | null
}

export interface ScheduleMediaUpgradeFailureParams {
  chatId: string
  exchIdx: number
  kind: MediaKind
  isChatActive: (chatId: string) => boolean
  updateRuntimeUiState: UpdateRuntimeUiState
  completeSession: CompleteSession
  delayMs?: number
}

export function buildImageGenerationRequestBody(params: {
  promptForModel: string
  modelId: string
  temporaryChat?: boolean
  chatId: string
  turnId: string
  imageUrl?: string | null
}): Record<string, unknown> {
  return {
    prompt: params.promptForModel,
    modelId: params.modelId,
    ...(params.temporaryChat ? { temporaryChat: true } : { conversationId: params.chatId }),
    turnId: params.turnId,
    ...(typeof params.imageUrl === 'string' && params.imageUrl.trim() ? { imageUrl: params.imageUrl } : {}),
  }
}

function updateMediaSlot(params: {
  chatId: string
  exchIdx: number
  kind: MediaKind
  result: GenerationResult
  updateRuntimeUiState: UpdateRuntimeUiState
}) {
  params.updateRuntimeUiState(params.chatId, (prev) => {
    const next = cloneGenerationResultsMap(prev.generationResults)
    next.set(params.exchIdx, [params.result])
    return {
      ...prev,
      generationResults: next,
      lastGeneratedImageUrl:
        params.kind === 'image' &&
        params.result.status === 'completed' &&
        params.result.url
          ? params.result.url
          : prev.lastGeneratedImageUrl,
    }
  })
}

function appendMediaSummary(
  kind: MediaKind,
  params: Pick<
    MediaGenerationBaseParams,
    | 'chatId'
    | 'temporaryChat'
    | 'turnId'
    | 'userPromptText'
    | 'modelId'
    | 'targetRuntime'
    | 'isChatActive'
    | 'completeSession'
    | 'loadChats'
    | 'loadSubscription'
  >,
  results: Array<{ ok: boolean; modelId: string }>,
) {
  const completed = results.filter((result) => result.ok)
  const summary = buildMediaSummary(
    kind,
    params.userPromptText,
    [params.modelId],
    completed.length,
    results.length - completed.length,
  )
  const assistantMessage = {
    id: `gen-summary-${Date.now()}`,
    role: 'assistant',
    parts: [{ type: 'text', text: summary }],
  }
  params.targetRuntime.askChats[0].messages = [
    ...params.targetRuntime.askChats[0].messages,
    assistantMessage as never,
  ]
  if (!params.temporaryChat) {
    void overlayAppClient.conversations.addMessageResponse(
      {
        conversationId: params.chatId,
        turnId: params.turnId,
        mode: 'act',
        role: 'assistant',
        variantIndex: 0,
        content: summary,
        contentType: 'text',
        parts: [{ type: 'text', text: summary }],
      },
      { idempotencyKey: `${params.turnId}:assistant` },
    )
  }
  params.completeSession(params.chatId, params.isChatActive(params.chatId))
  if (!params.temporaryChat) void params.loadChats()
  void params.loadSubscription()
}

export function scheduleMediaGenerationUpgradeFailure({
  delayMs = 5000,
  ...params
}: ScheduleMediaUpgradeFailureParams) {
  window.setTimeout(() => {
    params.updateRuntimeUiState(params.chatId, (prev) => {
      const next = cloneGenerationResultsMap(prev.generationResults)
      next.set(
        params.exchIdx,
        [{
          type: params.kind,
          status: 'failed' as const,
          upgradeRequired: true,
        }],
      )
      return { ...prev, generationResults: next }
    })
    params.completeSession(params.chatId, params.isChatActive(params.chatId))
  }, delayMs)
}

export function runImageGenerationBatch(params: RunImageGenerationBatchParams) {
  void overlayAppClient.chat.generateImageResponse(buildImageGenerationRequestBody(params))
    .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Generation failed' }))
          updateMediaSlot({
            ...params,
            kind: 'image',
            result: {
              type: 'image',
              status: 'failed',
              error: (err as { message?: string }).message,
            },
          })
          return { ok: false as const, modelId: params.modelId }
        }
        const data = await res.json() as { url?: string; modelUsed?: string; outputId?: string }
        updateMediaSlot({
          ...params,
          kind: 'image',
          result: {
            type: 'image',
            status: 'completed',
            url: data.url,
            modelUsed: data.modelUsed,
            outputId: data.outputId,
          },
        })
        return { ok: true as const, modelId: data.modelUsed ?? params.modelId }
    })
    .catch((error) => {
        updateMediaSlot({
          ...params,
          kind: 'image',
          result: { type: 'image', status: 'failed', error: String(error) },
        })
        return { ok: false as const, modelId: params.modelId }
    })
    .then((result) => appendMediaSummary('image', params, [result]))
    .catch((error) => {
      console.error('[ChatInterface] Image generation failed', error)
      params.completeSession(params.chatId, params.isChatActive(params.chatId))
    })
}

export function runVideoGenerationBatch(params: RunVideoGenerationBatchParams) {
  void overlayAppClient.chat.generateVideoResponse({
    prompt: params.promptForModel,
    modelId: params.modelId,
    ...(params.temporaryChat ? { temporaryChat: true } : { conversationId: params.chatId }),
    turnId: params.turnId,
    videoSubMode: params.videoSubMode,
    imageUrl: params.imageUrl,
  })
    .then(async (res) => {
        if (!res.ok) {
          updateMediaSlot({
            ...params,
            kind: 'video',
            result: { type: 'video', status: 'failed', error: 'Request failed' },
          })
          return { ok: false as const, modelId: params.modelId }
        }
        const reader = res.body?.getReader()
        if (!reader) return { ok: false as const, modelId: params.modelId }
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(line.slice(6)) as {
                type: string
                url?: string
                modelUsed?: string
                outputId?: string
                error?: string
              }
              if (evt.type === 'completed') {
                updateMediaSlot({
                  ...params,
                  kind: 'video',
                  result: {
                    type: 'video',
                    status: 'completed',
                    url: evt.url,
                    modelUsed: evt.modelUsed,
                    outputId: evt.outputId,
                  },
                })
                return { ok: true as const, modelId: evt.modelUsed ?? params.modelId }
              }
              if (evt.type === 'failed') {
                updateMediaSlot({
                  ...params,
                  kind: 'video',
                  result: { type: 'video', status: 'failed', error: evt.error },
                })
                return { ok: false as const, modelId: params.modelId }
              }
            } catch {
              /* ignore malformed SSE chunks */
            }
          }
        }
        return { ok: false as const, modelId: params.modelId }
    })
    .catch((error) => {
        updateMediaSlot({
          ...params,
          kind: 'video',
          result: { type: 'video', status: 'failed', error: String(error) },
        })
        return { ok: false as const, modelId: params.modelId }
    })
    .then((result) => appendMediaSummary('video', params, [result]))
    .catch((error) => {
      console.error('[ChatInterface] Video generation failed', error)
      params.completeSession(params.chatId, params.isChatActive(params.chatId))
    })
}
