import { isNativeThreadSafetyError } from '@/shared/chat/native-thread-safety'
import { toast } from '@overlay/ui/primitives'
import { stripAssistantAfterUserTurn } from '@overlay/chat-core'
import type { ChatMessageMetadata, ConversationRuntime } from '../chat-interface/types'

type CompleteSession = (chatId: string, active: boolean) => void
type RefreshAfterTurn = () => unknown | Promise<unknown>

export interface StartActTextStreamParams {
  chatId: string
  targetRuntime: ConversationRuntime
  textModelsForTurn: string[]
  selectedActModel: string
  turnId: string
  partsForModel: Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
  userMetadata?: ChatMessageMetadata
  commonBody: Record<string, unknown>
  isChatActive: (chatId: string) => boolean
  completeSession: CompleteSession
  loadSubscription: RefreshAfterTurn
  onError: (error: unknown, fallbackMessage: string) => void
  logPrefix: string
  isRuntimeCurrent?: (chatId: string, runtime: ConversationRuntime) => boolean
}

function finishTextTurn(params: Pick<
  StartActTextStreamParams,
  'chatId' | 'isChatActive' | 'completeSession' | 'loadSubscription'
>) {
  params.completeSession(params.chatId, params.isChatActive(params.chatId))
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
  /* eslint-disable @typescript-eslint/no-explicit-any -- AI SDK UIMessage payload */
  return params.targetRuntime.actChat
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
      const error = resolvedChatError(params.targetRuntime)
      if (error) failTextTurn(params, error, 'Could not complete Act request. Try again.')
      else finishTextTurn(params)
    })
    .catch((error) => {
      failTextTurn(params, error, 'Could not complete Act request. Try again.')
    })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function startActRetryStream(params: StartActTextStreamParams) {
  const retryOwner = {}
  retryOwners.set(params.targetRuntime, retryOwner)
  const actMessagesBeforeRetry = [...params.targetRuntime.actChat.messages]
  const askMessagesBeforeRetry = [...params.targetRuntime.askChats[0].messages]
  const actMessagesAfterRetry = stripAssistantAfterUserTurn(actMessagesBeforeRetry, params.turnId)
  const askMessagesAfterRetry = stripAssistantAfterUserTurn(askMessagesBeforeRetry, params.turnId)
  params.targetRuntime.actChat.messages = actMessagesAfterRetry
  params.targetRuntime.askChats[0].messages = askMessagesAfterRetry

  const restoreBeforeRetry = (error: unknown) => {
    if (!isNativeThreadSafetyError(error)) return
    if (params.isRuntimeCurrent?.(params.chatId, params.targetRuntime) === false) return
    if (retryOwners.get(params.targetRuntime) !== retryOwner) return
    if (params.targetRuntime.actChat.messages !== retryActMessages) return
    if (params.targetRuntime.askChats[0].messages !== retryAskMessages) return
    params.targetRuntime.actChat.messages = actMessagesBeforeRetry
    params.targetRuntime.askChats[0].messages = askMessagesBeforeRetry
  }

  /* eslint-disable @typescript-eslint/no-explicit-any -- AI SDK UIMessage payload */
  const completion = params.targetRuntime.actChat
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
  // The parts-based SDK send synchronously replaces the retried user message.
  const retryActMessages = params.targetRuntime.actChat.messages
  const retryAskMessages = params.targetRuntime.askChats[0].messages
  return completion.then(() => {
      const error = resolvedChatError(params.targetRuntime)
      if (!error) {
        finishTextTurn(params)
        return
      }
      restoreBeforeRetry(error)
      failTextTurn(params, error, 'Could not retry. Try again.')
    })
    .catch((error) => {
      restoreBeforeRetry(error)
      failTextTurn(params, error, 'Could not retry. Try again.')
    })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const retryOwners = new WeakMap<ConversationRuntime, object>()

function resolvedChatError(runtime: ConversationRuntime): unknown {
  const chat = runtime.actChat as unknown as { error?: unknown; status?: string }
  return chat.status === 'error'
    ? chat.error ?? new Error('The Act request failed.')
    : null
}

export function reportTextStreamError(
  error: unknown,
  fallbackMessage: string,
  onUsageExhaustedError?: (message: string) => boolean,
) {
  const message = error instanceof Error ? error.message : fallbackMessage
  if (onUsageExhaustedError?.(message)) return
  toast.error(message)
}
