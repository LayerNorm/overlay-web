'use client'

import type { UseChatHelpers } from '@/components/providers/ai-chat-client'
import { type ComponentProps, memo } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
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
import { normalizeAgentAssistantText } from '@/shared/chat/agent-assistant-text'
import {
  assistantBlocksToPlainText,
  buildAssistantVisualSequence,
  errorLabel,
  getMessageImageAttachments,
  getMessageText,
  getRoutedModelId,
  getUserMessageDocNames,
  getUserReplyThreadMeta,
  getUserTurnId,
  persistedGenerationErrorMessage,
  resolveActAssistant,
  splitUserDisplayText,
} from '@overlay/chat-core'
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
  selectedTabPerExchange: number[]
  selectedModels: string[]
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  interruptedExchangeIdx: number | null
  sourcesPanel: { turnId: string } | null
  getResponseForExchangeForModel: (modelId: string, exchangeIndex: number, slotOrder?: string[]) => UIMessage | null
  onTabSelect: (exchangeIndex: number, tabIndex: number) => void
  onReplyToAssistantText: (assistantText: string, turnId: string | null) => void
  onBranch: (turnId: string | null) => void | Promise<void>
  onSaveAssistantToKnowledge?: (args: {
    content: string
    messageId: string
    turnId: string | null
  }) => void | Promise<void>
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: Extract<DraftModalState, { kind: 'automation' }>) => void | Promise<void>
  onOpenSources: Parameters<typeof ChatToolSurface>[0]['onOpenSources']
  onRetry: (message: UIMessage, exchangeIndex: number, isActExchange: boolean, exchangeModels: string[]) => void | Promise<void>
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

function areTextChatMessagePropsEqual(prev: TextChatMessageProps, next: TextChatMessageProps): boolean {
  if (prev.message !== next.message || prev.exchangeIndex !== next.exchangeIndex) return false
  if (prev.latestExchangeIndex !== next.latestExchangeIndex) return false

  const exchangeIndex = next.exchangeIndex
  if (exchangeIndex === next.latestExchangeIndex) return false

  if (prev.exchangeModes[exchangeIndex] !== next.exchangeModes[exchangeIndex]) return false
  if (prev.selectedTabPerExchange[exchangeIndex] !== next.selectedTabPerExchange[exchangeIndex]) return false
  if (!sameStringArray(prev.exchangeModels[exchangeIndex], next.exchangeModels[exchangeIndex])) return false
  if (!sameStringArray(prev.selectedModels, next.selectedModels)) return false
  if (prev.interruptedExchangeIdx !== next.interruptedExchangeIdx) return false
  if (isTurnInList(prev.message, prev.exitingTurnIds) !== isTurnInList(next.message, next.exitingTurnIds)) return false
  if (isSourcesOpenForMessage(prev.message, prev.sourcesPanel) !== isSourcesOpenForMessage(next.message, next.sourcesPanel)) return false

  return true
}

function TextChatMessage(props: TextChatMessageProps) {
  recordRender('TextChatMessage')
  const {
    message,
    exchangeIndex,
    primaryMessages,
    latestExchangeIndex,
    actChat,
    chatInstances,
    exchangeModes,
    exchangeModels,
    selectedTabPerExchange,
    selectedModels,
    isActiveLoading,
    isOptimisticLoading,
    interruptedExchangeIdx,
    exitingTurnIds,
    sourcesPanel,
  } = props
  const modelList = exchangeModels[exchangeIndex] ?? []
  const selectedTab = selectedTabPerExchange[exchangeIndex] ?? 0
  const selectedModelId = modelList[selectedTab] ?? selectedModels[0] ?? ''
  const isLatest = exchangeIndex === latestExchangeIndex
  const isActExchange = (exchangeModes[exchangeIndex] ?? 'ask') === 'act'
  const isMultiAct = isActExchange && modelList.length > 1
  const streamSlotIndex = !selectedModelId ? -1 : isMultiAct ? modelList.indexOf(selectedModelId) : isActExchange ? -1 : selectedModels.indexOf(selectedModelId)
  const slotInstance = streamSlotIndex >= 0 ? chatInstances[streamSlotIndex] : null
  const initialResponseMsg = props.getResponseForExchangeForModel(selectedModelId, exchangeIndex, isMultiAct ? modelList : undefined)
  const responseMsg = (isActExchange && !isMultiAct
    ? resolveActAssistant(primaryMessages, actChat.messages, message.id)
    : initialResponseMsg) as UIMessage | null
  const responseText = responseMsg ? getMessageText(responseMsg) : ''

  const multiActInstance = streamSlotIndex >= 0 ? chatInstances[streamSlotIndex] : null
  const persistedStatus = (responseMsg as { status?: 'generating' | 'completed' | 'error' } | null)?.status
  const activeHttpLoading = isLatest && (
    (isActExchange
      ? (isMultiAct
          ? (multiActInstance?.status === 'streaming' || multiActInstance?.status === 'submitted')
          : (actChat.status === 'streaming' || actChat.status === 'submitted'))
      : !!slotInstance && (slotInstance.status === 'streaming' || slotInstance.status === 'submitted')) ||
    isOptimisticLoading
  )
  const instLoading = activeHttpLoading || persistedStatus === 'generating'
  const persistedErrorText = persistedStatus === 'error'
    ? persistedGenerationErrorMessage(responseText)
    : 'Generation failed'
  const instError = isLatest
    ? persistedStatus === 'error'
      ? new Error(persistedErrorText)
      : isActExchange
        ? isMultiAct && streamSlotIndex >= 0
          ? chatInstances[streamSlotIndex]?.error ?? null
          : isMultiAct ? null : actChat.error
        : slotInstance?.error ?? null
    : null
  const responseParts = responseMsg && Array.isArray((responseMsg as { parts?: unknown[] }).parts)
    ? (responseMsg as { parts: unknown[] }).parts
    : undefined
  const responseMessageId = responseMsg && typeof (responseMsg as { id?: unknown }).id === 'string'
    ? (responseMsg as { id: string }).id
    : null
  const assistantVisualBlocks = (() => {
    const blocks = buildAssistantVisualSequence(responseParts)
    if (blocks.length === 0 && responseText.trim()) {
      return [{ kind: 'text' as const, text: normalizeAgentAssistantText(responseText) }]
    }
    return blocks
  })()
  const hasAssistantText = assistantVisualBlocks.some((block) => block.kind === 'text' && block.text.trim().length > 0)
  const hasAssistantActivity = assistantVisualBlocks.length > 0
  const isStreaming = (activeHttpLoading || persistedStatus === 'generating') && hasAssistantActivity
  const isTextStreaming = activeHttpLoading && hasAssistantText
  const rawUserText = getMessageText(message)
  const metaDocs = getUserMessageDocNames(message)
  const { bodyText, docNames: parsedDocNames } = splitUserDisplayText(rawUserText)
  const turnId = getUserTurnId(message)
  const isExiting = !!turnId && exitingTurnIds.includes(turnId)
  const assistantPlainForReply = assistantBlocksToPlainText(assistantVisualBlocks)
  const errLabelForTurn = errorLabel(instError)
  const interruptedHere = interruptedExchangeIdx === exchangeIndex && !errLabelForTurn
  const replyPlain = interruptedHere && assistantPlainForReply.trim()
    ? `${assistantPlainForReply}\n\nResponse was interrupted.`
    : interruptedHere ? 'Response was interrupted.' : assistantPlainForReply
  const routedModelId = responseMsg ? getRoutedModelId(responseMsg) : null
  const routedModelName = selectedModelId === FREE_TIER_AUTO_MODEL_ID && routedModelId ? getChatModelDisplayName(routedModelId) : null
  const modelLabelSingle = selectedModelId === FREE_TIER_AUTO_MODEL_ID && routedModelName ? `Free · ${routedModelName}` : getChatModelDisplayName(selectedModelId)

  return (
    <ChatToolSurface
      userMsgId={message.id}
      userBodyText={metaDocs.length > 0 ? rawUserText.trim() : bodyText}
      userDocumentNames={metaDocs.length > 0 ? metaDocs : parsedDocNames}
      userIndexedAttachments={(message as { metadata?: { indexedAttachments?: { name: string; fileIds: string[] }[] } }).metadata?.indexedAttachments ?? []}
      userImages={getMessageImageAttachments(message)}
      exchIdx={exchangeIndex}
      responseModelId={selectedModelId}
      assistantVisualBlocks={assistantVisualBlocks}
      isStreaming={isStreaming}
      isTextStreaming={isTextStreaming}
      errorMessage={errLabelForTurn}
      exchModelList={modelList}
      selectedTab={selectedTab}
      onTabSelect={(tabIndex) => props.onTabSelect(exchangeIndex, tabIndex)}
      isLoadingTabs={false}
      responseInProgress={instLoading}
      status={props.status}
      sourceCitations={(responseMsg as { metadata?: { sourceCitations?: SourceCitationMap } } | undefined)?.metadata?.sourceCitations}
      turnIdForActions={turnId}
      modelLabel={modelList.length > 1 ? `${modelLabelSingle} · ${modelList.length} models` : modelLabelSingle}
      onDeleteTurn={() => turnId && props.onDeleteTurn(turnId)}
      onReply={() => props.onReplyToAssistantText(replyPlain, turnId)}
      onBranch={() => props.onBranch(turnId)}
      onSaveToKnowledge={responseMessageId && assistantPlainForReply.trim()
        ? () => props.onSaveAssistantToKnowledge?.({
            content: assistantPlainForReply,
            messageId: responseMessageId,
            turnId,
          })
        : undefined}
      interrupted={interruptedHere}
      actionsLocked={isLatest && isActiveLoading}
      isExiting={isExiting}
      replyThreadMeta={getUserReplyThreadMeta(message)}
      onJumpToReply={props.onJumpToReply}
      onOpenDraft={props.onOpenDraft}
      onCreateAutomationDraft={props.onCreateAutomationDraft}
      onOpenSources={props.onOpenSources}
      isSourcesOpenForThis={!!sourcesPanel && sourcesPanel.turnId === (turnId ?? message.id)}
      onRetry={() => props.onRetry(message, exchangeIndex, isActExchange, modelList)}
      retryDisabled={!turnId || isExiting || (isLatest && isActiveLoading) || instLoading}
      onOpenFilePreview={props.onOpenFilePreview}
      onOpenAttachmentPreview={props.onOpenAttachmentPreview}
      userMentions={(message as { metadata?: { mentions?: Array<{ type: string; id: string; name: string }> } }).metadata?.mentions}
      onContinue={(['[Request timed out after 300s. Continue?]', '[Interrupted by user. Continue?]'] as const).some((s) => assistantPlainForReply.includes(s)) ? props.onContinue : undefined}
      getModelDisplayName={getChatModelDisplayName}
      onGeneratedUiChange={responseMessageId ? (partId, data) => props.onGeneratedUiChange(responseMessageId, partId, data) : undefined}
      generatedUiConnectorActions={props.generatedUiConnectorActions}
      presentation={props.presentation}
    />
  )
}
