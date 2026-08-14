import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import type { ChatMessageMetadata, ChatOutput, ConversationRuntime } from '../chat-interface/types'

export type RawConversationMessage = {
  id: string
  turnId?: string
  mode?: 'ask' | 'act'
  role: 'user' | 'assistant'
  parts: Array<{
    type: string
    text?: string
    url?: string
    mediaType?: string
    fileName?: string
  }>
  model?: string
  metadata?: ChatMessageMetadata
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
  status?: 'generating' | 'completed' | 'error'
  variantIndex?: number
}

export interface ConversationMetaSnapshot {
  title?: string
  lastMode?: 'ask' | 'act'
  askModelIds?: string[]
  actModelId?: string
}

export type ConversationLoadSnapshot =
  | {
      status: 'ok'
      messages: RawConversationMessage[]
      outputs: ChatOutput[]
      meta: ConversationMetaSnapshot | null
    }
  | { status: 'missing' }
  | { status: 'error' }

export async function loadConversationSnapshot({
  chatId,
  loadGeneratedOutputs,
  shouldLoadMeta,
}: {
  chatId: string
  loadGeneratedOutputs: boolean
  shouldLoadMeta: boolean
}): Promise<ConversationLoadSnapshot> {
  const [messagesRes, outputsRes, metaRes] = await Promise.all([
    overlayAppClient.conversations.getResponse({
      conversationId: chatId,
      messages: true,
    }),
    loadGeneratedOutputs
      ? overlayAppClient.files.getResponse({ kind: 'output', conversationId: chatId, limit: 100, summary: true })
      : Promise.resolve(null),
    shouldLoadMeta
      ? overlayAppClient.conversations.getResponse({ conversationId: chatId })
      : Promise.resolve(null),
  ])

  if (metaRes?.status === 404 || messagesRes.status === 404) {
    return { status: 'missing' }
  }
  if (!messagesRes.ok) {
    return { status: 'error' }
  }

  const data = await messagesRes.json()
  const rawMessages = Array.isArray(data.messages)
    ? data.messages as RawConversationMessage[]
    : []

  const outputRows = outputsRes?.ok
    ? unwrapPaginatedData<{
        _id: string
        outputType?: string
        prompt?: string
        modelId?: string
        downloadUrl?: string
        createdAt?: number
        updatedAt?: number
        turnId?: string
      }>(await outputsRes.json())
    : []
  const outputs: ChatOutput[] = outputRows.map((file: {
        _id: string
        outputType?: string
        prompt?: string
        modelId?: string
        downloadUrl?: string
        createdAt?: number
        updatedAt?: number
        turnId?: string
      }) => ({
        _id: file._id,
        type: (file.outputType || 'document') as ChatOutput['type'],
        status: 'completed',
        prompt: file.prompt || 'Generated output',
        modelId: file.modelId || '',
        url: file.downloadUrl,
        createdAt: file.createdAt ?? file.updatedAt ?? 0,
        turnId: file.turnId,
      }))

  const meta = metaRes?.ok
    ? await metaRes.json() as ConversationMetaSnapshot
    : null

  return {
    status: 'ok',
    messages: rawMessages,
    outputs,
    meta,
  }
}

export function normalizeReplyMetadata(messages: RawConversationMessage[]): RawConversationMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'user' || !msg.replyToTurnId?.trim()) return msg
    return {
      ...msg,
      metadata: {
        ...(msg.metadata ?? {}),
        replyToTurnId: msg.replyToTurnId.trim(),
        ...(msg.replySnippet ? { replySnippet: msg.replySnippet } : {}),
      },
    }
  })
}

type CompleteSession = (chatId: string, active: boolean) => void
type RefreshAfterTurn = () => unknown | Promise<unknown>

export interface StartActTextStreamParams {
  chatId: string
  targetRuntime: ConversationRuntime
  textModelsForTurn: string[]
  textSlotCount: number
  selectedActModel: string
  turnId: string
  partsForModel: Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
  userMetadata?: ChatMessageMetadata
  commonBody: Record<string, unknown>
  isChatActive: (chatId: string) => boolean
  completeSession: CompleteSession
  loadChats: RefreshAfterTurn
  loadSubscription: RefreshAfterTurn
  onError: (error: unknown, fallbackMessage: string) => void
  logPrefix: string
  personalChatMode?: 'chat' | 'work'
  onWorkAccepted?: () => Promise<unknown>
}

function finishTextTurn(params: Pick<
  StartActTextStreamParams,
  'chatId' | 'isChatActive' | 'completeSession' | 'loadChats' | 'loadSubscription'
>) {
  params.completeSession(params.chatId, params.isChatActive(params.chatId))
  void params.loadChats()
  void params.loadSubscription()
}

function failTextTurn(
  params: Pick<StartActTextStreamParams, 'chatId' | 'isChatActive' | 'completeSession' | 'onError' | 'logPrefix'>,
  error: unknown,
  fallbackMessage: string,
) {
  params.completeSession(params.chatId, params.isChatActive(params.chatId))
  if (params.isChatActive(params.chatId)) {
    params.onError(error, fallbackMessage)
  }
}

export function startActTextStream(params: StartActTextStreamParams) {
  if (params.personalChatMode === 'work') {
    const messages = params.targetRuntime.actChat.messages
    void overlayAppClient.conversations.actResponse({
      ...params.commonBody,
      messages,
      modelId: params.selectedActModel,
      personalChatMode: 'work',
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
        throw new Error(payload.message ?? payload.error ?? `Work mode failed (${response.status})`)
      }
      await params.onWorkAccepted?.()
      finishTextTurn(params)
    }).catch((error) => {
      failTextTurn(params, error, 'Could not start Work mode. Try again.')
    })
    return
  }
  const multiText = params.textModelsForTurn.length > 1

  /* eslint-disable @typescript-eslint/no-explicit-any -- AI SDK UIMessage payload */
  if (multiText) {
    const sends = params.textModelsForTurn.map((modelId, slotIdx) =>
      params.targetRuntime.askChats[slotIdx]!.sendMessage(
        {
          role: 'user',
          parts: params.partsForModel as any,
          messageId: params.turnId,
          ...(params.userMetadata ? { metadata: params.userMetadata } : {}),
        } as any,
        {
          body: {
            ...params.commonBody,
            modelId,
            multiModelSlotIndex: slotIdx,
            multiModelTotal: params.textSlotCount,
          },
        },
      ),
    )
    void Promise.all(sends)
      .then(() => {
        params.targetRuntime.actChat.messages = [...params.targetRuntime.askChats[0]!.messages]
        finishTextTurn(params)
      })
      .catch((error) => {
        failTextTurn(params, error, 'Could not complete Act request. Try again.')
      })
    return
  }

  void params.targetRuntime.actChat
    .sendMessage(
      {
        role: 'user',
        parts: params.partsForModel as any,
        messageId: params.turnId,
        ...(params.userMetadata ? { metadata: params.userMetadata } : {}),
      } as any,
      {
        body: {
          ...params.commonBody,
          modelId: params.selectedActModel,
        },
      },
    )
    .then(() => {
      finishTextTurn(params)
    })
    .catch((error) => {
      failTextTurn(params, error, 'Could not complete Act request. Try again.')
    })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function startActRetryStream(params: StartActTextStreamParams) {
  const retrySlots = params.textSlotCount
  const multiRetry = params.textModelsForTurn.length > 1

  /* eslint-disable @typescript-eslint/no-explicit-any -- AI SDK UIMessage payload */
  if (multiRetry) {
    const sends = params.textModelsForTurn.slice(0, retrySlots).map((modelId, slotIdx) =>
      params.targetRuntime.askChats[slotIdx]!.sendMessage(
        {
          role: 'user',
          parts: params.partsForModel as any,
          messageId: params.turnId,
          ...(params.userMetadata && Object.keys(params.userMetadata).length > 0
            ? { metadata: params.userMetadata }
            : {}),
        } as any,
        {
          body: {
            ...params.commonBody,
            modelId,
            multiModelSlotIndex: slotIdx,
            multiModelTotal: retrySlots,
          },
        },
      ),
    )
    void Promise.all(sends)
      .then(() => {
        params.targetRuntime.actChat.messages = [...params.targetRuntime.askChats[0]!.messages]
        finishTextTurn(params)
      })
      .catch((error) => {
        failTextTurn(params, error, 'Could not retry. Try again.')
      })
    return
  }

  void params.targetRuntime.actChat
    .sendMessage(
      {
        role: 'user',
        parts: params.partsForModel as any,
        messageId: params.turnId,
        ...(params.userMetadata && Object.keys(params.userMetadata).length > 0
          ? { metadata: params.userMetadata }
          : {}),
      } as any,
      {
        body: {
          ...params.commonBody,
          modelId: params.selectedActModel,
        },
      },
    )
    .then(() => {
      finishTextTurn(params)
    })
    .catch((error) => {
      failTextTurn(params, error, 'Could not retry. Try again.')
    })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function reportTextStreamError(
  setComposerNotice: (notice: string | null | ((current: string | null) => string | null)) => void,
  error: unknown,
  fallbackMessage: string,
) {
  setComposerNotice(error instanceof Error ? error.message : fallbackMessage)
  window.setTimeout(() => setComposerNotice(null), 8000)
}
