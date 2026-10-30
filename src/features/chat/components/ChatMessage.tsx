'use client'

import type { UseChatHelpers } from '@/components/providers/ai-chat-client'
import { type ComponentProps, memo } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import {
  getChatModelDisplayName,
} from '@/shared/ai/gateway/model-data'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { ChatExchangeStatus } from '@overlay/chat-core'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
  GeneratedUiConnectorActions,
  ChatTranscriptPresentation,
} from '@overlay/chat-react'
import { appendInterruptionNotice, INTERRUPTED_RESPONSE_NOTICE, normalizeAgentAssistantText } from '@/shared/chat/agent-assistant-text'
import {
  assistantBlocksToPlainText,
  errorLabel,
  getMessageImageAttachments,
  getMessageText,
  getRoutedModelId,
  getUserMessageDocNames,
  getUserReplyThreadMeta,
  getUserTurnId,
  looksLikeStoredGenerationError,
  persistedGenerationErrorMessage,
  resolveActAssistant,
  splitUserDisplayText,
  normalizeTranscriptAssistantParts,
} from '@overlay/chat-core'
import { assistantSnapshotKey } from './chat/chat-runtime-helpers'
import type { DraftModalState } from './chat-interface/types'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { ChatToolSurface } from './ChatToolSurface'
import { ChatMediaMessage } from './ChatMediaMessage'

type ChatInstance = UseChatHelpers<UIMessage>

type CommonMessageProps = {
  message: UIMessage
  exchangeIndex: number
  exitingTurnIds: string[]
  onJumpToReply: (turnId: string) => void
  onDeleteTurn: (turnId: string) => void | Promise<void>
}

type TextChatMessageProps = CommonMessageProps & {
  kind: 'text'
  primaryMessages: UIMessage[]
  latestExchangeIndex: number
  actChat: ChatInstance
  chatInstances: ChatInstance[]
  exchangeModes: ('ask' | 'act')[]
  exchangeModels: string[][]
  selectedModels: string[]
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  interruptedExchangeIdx: number | null
  sourcesPanel: { turnId: string } | null
  getResponseForExchange: (exchangeIndex: number) => UIMessage | null
  onReplyToAssistantText: (assistantText: string, turnId: string | null) => void
  onBranch: (turnId: string | null) => void | Promise<void>
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: Extract<DraftModalState, { kind: 'automation' }>) => void | Promise<void>
  onOpenSources: Parameters<typeof ChatToolSurface>[0]['onOpenSources']
  onRetry: (message: UIMessage, exchangeIndex: number, isActExchange: boolean, modelId: string) => void | Promise<void>
  onOpenFilePreview: (name: string, fileIds: string[]) => void | Promise<void>
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  onContinue: () => void
  onGeneratedUiChange: (messageId: string, partId: string, data: GeneratedUiData) => void
  generatedUiConnectorActions?: GeneratedUiConnectorActions
  presentation?: Partial<ChatTranscriptPresentation>
  status: ChatExchangeStatus
}

export type ChatMessageProps = ComponentProps<typeof ChatMediaMessage> | TextChatMessageProps

export function ChatMessage(props: ChatMessageProps) {
  if (props.kind === 'text') return <MemoTextChatMessage {...props} />
  return <ChatMediaMessage {...props} />
}

const MemoTextChatMessage = memo(TextChatMessage, areTextChatMessagePropsEqual)

function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  const al = a?.length ?? 0
  const bl = b?.length ?? 0
  if (al !== bl) return false
  for (let i = 0; i < al; i++) {
    if (a![i] !== b![i]) return false
  }
  return true
}

function messageTurnKey(message: UIMessage): string {
  return getUserTurnId(message) ?? (typeof (message as { id?: unknown }).id === 'string' ? (message as { id: string }).id : '')
}

function isTurnInList(message: UIMessage, turnIds: string[]): boolean {
  const turnId = messageTurnKey(message)
  return !!turnId && turnIds.includes(turnId)
}

function isSourcesOpenForMessage(message: UIMessage, sourcesPanel: TextChatMessageProps['sourcesPanel']): boolean {
  const turnId = messageTurnKey(message)
  return !!turnId && sourcesPanel?.turnId === turnId
}

export function areTextChatMessagePropsEqual(prev: TextChatMessageProps, next: TextChatMessageProps): boolean {
  if (prev.message !== next.message || prev.exchangeIndex !== next.exchangeIndex) return false
  if (prev.latestExchangeIndex !== next.latestExchangeIndex) return false
  if (prev.isActiveLoading !== next.isActiveLoading) return false

  const exchangeIndex = next.exchangeIndex
  if (exchangeIndex === next.latestExchangeIndex) return false

  if (prev.exchangeModes[exchangeIndex] !== next.exchangeModes[exchangeIndex]) return false
  if (!sameStringArray(prev.exchangeModels[exchangeIndex], next.exchangeModels[exchangeIndex])) return false
  if (!sameStringArray(prev.selectedModels, next.selectedModels)) return false
  if (prev.interruptedExchangeIdx !== next.interruptedExchangeIdx) return false
  if (isTurnInList(prev.message, prev.exitingTurnIds) !== isTurnInList(next.message, next.exitingTurnIds)) return false
  if (isSourcesOpenForMessage(prev.message, prev.sourcesPanel) !== isSourcesOpenForMessage(next.message, next.sourcesPanel)) return false
  if (
    assistantSnapshotKey(prev.primaryMessages, exchangeIndex)
    !== assistantSnapshotKey(next.primaryMessages, exchangeIndex)
  ) return false
  if (
    assistantSnapshotKey(prev.actChat.messages as UIMessage[], exchangeIndex)
    !== assistantSnapshotKey(next.actChat.messages as UIMessage[], exchangeIndex)
  ) return false

  return true
}

function resolveStreamSelection(props: TextChatMessageProps) {
  const {
    exchangeIndex,
    chatInstances,
    exchangeModes,
    exchangeModels,
    selectedModels,
  } = props
  const selectedModelId = exchangeModels[exchangeIndex]?.[0] ?? selectedModels[0] ?? ''
  const isActExchange = (exchangeModes[exchangeIndex] ?? 'ask') === 'act'
  const slotInstance = isActExchange ? null : chatInstances[0] ?? null
  return { selectedModelId, isActExchange, slotInstance }
}

type StreamSelection = ReturnType<typeof resolveStreamSelection>

function resolveExchangeResponse(props: TextChatMessageProps, selection: StreamSelection) {
  const { message, exchangeIndex, latestExchangeIndex, primaryMessages, actChat } = props
  const isLatest = exchangeIndex === latestExchangeIndex
  const initialResponseMsg = props.getResponseForExchange(exchangeIndex)
  const actResponseMsg = selection.isActExchange
    ? resolveActAssistant(primaryMessages, actChat.messages, message.id)
    : null
  const responseMsg = (selection.isActExchange
    ? (isLatest ? (actResponseMsg ?? initialResponseMsg) : (initialResponseMsg ?? actResponseMsg))
    : initialResponseMsg) as UIMessage | null
  const responseText = responseMsg ? getMessageText(responseMsg) : ''
  const persistedStatus = (responseMsg as { status?: 'generating' | 'completed' | 'error' } | null)?.status
  const responseParts = responseMsg && Array.isArray((responseMsg as { parts?: unknown[] }).parts)
    ? (responseMsg as { parts: unknown[] }).parts
    : undefined
  const responseMessageId = responseMsg && typeof (responseMsg as { id?: unknown }).id === 'string'
    ? (responseMsg as { id: string }).id
    : null
  // Persisted turn time: the assistant row is written with status 'generating'
  // at turn start and patched through settle, so createdAt→updatedAt spans it.
  const responseTimestamps = responseMsg as { createdAt?: number; updatedAt?: number } | null
  const workedDurationMs = responseTimestamps?.updatedAt && responseTimestamps.createdAt
    && responseTimestamps.updatedAt > responseTimestamps.createdAt
    ? responseTimestamps.updatedAt - responseTimestamps.createdAt
    : null
  return { isLatest, responseMsg, responseText, persistedStatus, responseParts, responseMessageId, workedDurationMs }
}

type ExchangeResponse = ReturnType<typeof resolveExchangeResponse>

function resolveStreamLoadState(props: TextChatMessageProps, selection: StreamSelection, response: ExchangeResponse) {
  const { actChat, isActiveLoading, isOptimisticLoading } = props
  const { isActExchange, slotInstance } = selection
  const { isLatest, persistedStatus, responseText } = response
  const activeHttpLoading = isLatest && (
    (isActExchange
      ? (actChat.status === 'streaming' || actChat.status === 'submitted')
      : !!slotInstance && (slotInstance.status === 'streaming' || slotInstance.status === 'submitted')) ||
    isOptimisticLoading ||
    (isActExchange && isActiveLoading && persistedStatus !== 'completed')
  )
  const persistedErrorText = persistedStatus === 'error'
    ? persistedGenerationErrorMessage(responseText)
    : 'Generation failed'
  const instError = isLatest
    ? persistedStatus === 'error'
      ? new Error(persistedErrorText)
      : isActExchange
        ? actChat.error
        : slotInstance?.error ?? null
    : null
  return { instLoading: activeHttpLoading, instError }
}

function buildNormalizedAssistant({
  persistedStatus,
  responseText,
  responseParts,
  status,
}: {
  persistedStatus: 'generating' | 'completed' | 'error' | undefined
  responseText: string
  responseParts: unknown[] | undefined
  status: ChatExchangeStatus
}) {
  if (persistedStatus === 'error' && looksLikeStoredGenerationError(responseText)) {
    return { blocks: [], sources: [] }
  }
  const terminalState = persistedStatus === 'completed'
    ? 'completed'
    : persistedStatus === 'error'
      ? 'error'
      : status === 'completed'
        ? 'completed'
        : status === 'error'
        ? 'error'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'interrupted'
            ? 'interrupted'
            : undefined
  const normalized = normalizeTranscriptAssistantParts(responseParts, terminalState ? { terminalState } : undefined)
  const blocks = normalized.blocks
  if (blocks.length === 0 && responseText.trim()) {
    return {
      blocks: [{ kind: 'text' as const, text: normalizeAgentAssistantText(responseText) }],
      sources: normalized.sources,
    }
  }
  return normalized
}

function resolveTurnReplyState(
  props: TextChatMessageProps,
  instError: Error | null | undefined,
  assistantPlainForReply: string,
) {
  const { message, exitingTurnIds, interruptedExchangeIdx, exchangeIndex } = props
  const turnId = getUserTurnId(message)
  const isExiting = !!turnId && exitingTurnIds.includes(turnId)
  const errLabelForTurn = errorLabel(instError)
  const interruptedHere = interruptedExchangeIdx === exchangeIndex && !errLabelForTurn
  const replyPlain = interruptedHere
    ? appendInterruptionNotice(assistantPlainForReply)
    : assistantPlainForReply
  return { turnId, isExiting, errLabelForTurn, interruptedHere, replyPlain }
}

function resolveModelLabel(responseMsg: UIMessage | null, selectedModelId: string): string {
  const routedModelId = responseMsg ? getRoutedModelId(responseMsg) : null
  const routedModelName = isFreeTierChatModelId(selectedModelId) && routedModelId ? getChatModelDisplayName(routedModelId) : null
  return isFreeTierChatModelId(selectedModelId) && routedModelName ? `Free · ${routedModelName}` : getChatModelDisplayName(selectedModelId)
}

function resolveUserDisplayParts(message: UIMessage) {
  const rawUserText = getMessageText(message)
  const metaDocs = getUserMessageDocNames(message)
  const { bodyText, docNames: parsedDocNames } = splitUserDisplayText(rawUserText)
  return {
    userBodyText: metaDocs.length > 0 ? rawUserText.trim() : bodyText,
    userDocumentNames: metaDocs.length > 0 ? metaDocs : parsedDocNames,
    userIndexedAttachments: (message as { metadata?: { indexedAttachments?: { name: string; fileIds: string[] }[] } }).metadata?.indexedAttachments ?? [],
    userImages: getMessageImageAttachments(message),
    userMentions: (message as { metadata?: { mentions?: Array<{ type: string; id: string; name: string }> } }).metadata?.mentions,
    replyThreadMeta: getUserReplyThreadMeta(message),
  }
}

function computeSourcesOpen(sourcesPanel: { turnId: string } | null, turnId: string | null | undefined, messageId: string): boolean {
  return !!sourcesPanel && sourcesPanel.turnId === (turnId ?? messageId)
}

function computeRetryDisabled({
  turnId,
  isExiting,
  isLatest,
  isActiveLoading,
  instLoading,
}: {
  turnId: string | null | undefined
  isExiting: boolean
  isLatest: boolean
  isActiveLoading: boolean
  instLoading: boolean
}): boolean {
  return !turnId || isExiting || (isLatest && isActiveLoading) || instLoading
}

const CONTINUE_PROMPTS = [
  '[Request timed out after 300s. Continue?]',
  '[Interrupted by user. Continue?]',
  INTERRUPTED_RESPONSE_NOTICE,
] as const

function resolveContinueHandler(assistantPlainForReply: string, onContinue: () => void): (() => void) | undefined {
  return CONTINUE_PROMPTS.some((s) => assistantPlainForReply.includes(s)) ? onContinue : undefined
}

function TextChatMessage(props: TextChatMessageProps) {
  recordRender('TextChatMessage')
  const { message, exchangeIndex } = props
  const selection = resolveStreamSelection(props)
  const response = resolveExchangeResponse(props, selection)
  const { instLoading, instError } = resolveStreamLoadState(props, selection, response)
  const normalizedAssistant = buildNormalizedAssistant({
    persistedStatus: response.persistedStatus,
    responseText: response.responseText,
    responseParts: response.responseParts,
    status: props.status,
  })
  const assistantVisualBlocks = normalizedAssistant.blocks
  const hasAssistantText = assistantVisualBlocks.some((block) => block.kind === 'text' && block.text.trim().length > 0)
  const hasAssistantActivity = assistantVisualBlocks.length > 0
  const isStreaming = instLoading && hasAssistantActivity
  const isTextStreaming = instLoading && hasAssistantText
  const assistantPlainForReply = assistantBlocksToPlainText(assistantVisualBlocks)
  const turn = resolveTurnReplyState(props, instError, assistantPlainForReply)
  const modelLabel = resolveModelLabel(response.responseMsg, selection.selectedModelId)
  const userDisplay = resolveUserDisplayParts(message)
  const responseMessageId = response.responseMessageId

  return (
    <ChatToolSurface
      userMsgId={message.id}
      userBodyText={userDisplay.userBodyText}
      userDocumentNames={userDisplay.userDocumentNames}
      userIndexedAttachments={userDisplay.userIndexedAttachments}
      userImages={userDisplay.userImages}
      exchIdx={exchangeIndex}
      responseModelId={selection.selectedModelId}
      assistantVisualBlocks={assistantVisualBlocks}
      responseSources={normalizedAssistant.sources}
      isStreaming={isStreaming}
      isTextStreaming={isTextStreaming}
      workedDurationMs={response.workedDurationMs}
      errorMessage={turn.errLabelForTurn}
      responseInProgress={instLoading}
      status={props.status}
      sourceCitations={(response.responseMsg as { metadata?: { sourceCitations?: SourceCitationMap } } | undefined)?.metadata?.sourceCitations}
      turnIdForActions={turn.turnId}
      modelLabel={modelLabel}
      onDeleteTurn={() => turn.turnId && props.onDeleteTurn(turn.turnId)}
      onReply={() => props.onReplyToAssistantText(turn.replyPlain, turn.turnId)}
      onBranch={() => props.onBranch(turn.turnId)}
      interrupted={turn.interruptedHere}
      actionsLocked={response.isLatest && props.isActiveLoading}
      isExiting={turn.isExiting}
      replyThreadMeta={userDisplay.replyThreadMeta}
      onJumpToReply={props.onJumpToReply}
      onOpenDraft={props.onOpenDraft}
      onCreateAutomationDraft={props.onCreateAutomationDraft}
      onOpenSources={props.onOpenSources}
      isSourcesOpenForThis={computeSourcesOpen(props.sourcesPanel, turn.turnId, message.id)}
      onRetry={() => props.onRetry(message, exchangeIndex, selection.isActExchange, selection.selectedModelId)}
      retryDisabled={computeRetryDisabled({
        turnId: turn.turnId,
        isExiting: turn.isExiting,
        isLatest: response.isLatest,
        isActiveLoading: props.isActiveLoading,
        instLoading,
      })}
      onOpenFilePreview={props.onOpenFilePreview}
      onOpenAttachmentPreview={props.onOpenAttachmentPreview}
      userMentions={userDisplay.userMentions}
      onContinue={resolveContinueHandler(assistantPlainForReply, props.onContinue)}
      onGeneratedUiChange={responseMessageId ? (partId, data) => props.onGeneratedUiChange(responseMessageId, partId, data) : undefined}
      generatedUiConnectorActions={props.generatedUiConnectorActions}
      presentation={props.presentation}
    />
  )
}
