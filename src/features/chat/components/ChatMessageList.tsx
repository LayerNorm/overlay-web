'use client'

import type { ReactNode, RefObject } from 'react'
import { useCallback, useMemo } from 'react'
import type { UseChatHelpers } from '@/components/providers/ai-chat-client'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { WebSourceItem } from '@/shared/web/web-sources'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
  GeneratedUiConnectorActions,
} from '@overlay/chat-react'
import {
  ChatTranscript,
  type ChatTranscriptPresentation,
  useTranscriptScroll,
} from '@overlay/chat-react/transcript'
import type { ChatTranscriptExchangeView } from '@overlay/chat-core'
import type { DraftModalState, GenerationResult } from './chat-interface/types'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { ChatMessage } from './ChatMessage'
import { toChatTranscriptView } from './chat/toChatTranscriptView'

type ChatInstance = UseChatHelpers<UIMessage>

export type ChatMessageListState = {
  primaryMessages: UIMessage[]
  latestExchangeIndex: number
  generationResults: Map<number, GenerationResult[]>
  exchangeGenTypes: ('text' | 'image' | 'video')[]
  exchangeModels: string[][]
  selectedImageModels: string[]
  selectedVideoModels: string[]
  selectedTabPerExchange: number[]
  selectedModels: string[]
  exchangeModes: ('ask' | 'act')[]
}

export type ChatMessageListRuntime = {
  actChat: ChatInstance
  chatInstances: ChatInstance[]
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  interruptedExchangeIdx: number | null
  exitingTurnIds: string[]
  sourcesPanel: { turnId: string; sources: WebSourceItem[] } | null
  getResponseForExchangeForModel: (modelId: string, exchangeIndex: number, slotOrder?: string[]) => UIMessage | null
}

export type ChatMessageListActions = {
  onTabSelect: (exchangeIndex: number, tabIndex: number) => void
  onJumpToReply: (turnId: string) => void
  onDeleteTurn: (turnId: string) => void | Promise<void>
  onReplyToMediaPrompt: (prompt: string, kind: 'image' | 'video', turnId: string | null) => void
  onReplyToAssistantText: (assistantText: string, turnId: string | null) => void
  onBranch: (turnId: string | null) => void | Promise<void>
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: Extract<DraftModalState, { kind: 'automation' }>) => void | Promise<void>
  onOpenSources: (turnId: string, sources: WebSourceItem[]) => void
  onRetry: (message: UIMessage, exchangeIndex: number, isActExchange: boolean, exchangeModels: string[]) => void | Promise<void>
  onOpenFilePreview: (name: string, fileIds: string[]) => void | Promise<void>
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  onContinue: () => void
  onGeneratedUiChange: (messageId: string, partId: string, data: GeneratedUiData) => void
  generatedUiConnectorActions?: GeneratedUiConnectorActions
}

type ChatMessageListProps = {
  messagesScrollRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  floatingControl?: ReactNode
  showLoadingState: boolean
  reserveLatestExchangeStartSpace?: boolean
  transcriptKey?: string | null
  state: ChatMessageListState
  runtime: ChatMessageListRuntime
  actions: ChatMessageListActions
}

export function ChatMessageList({
  messagesScrollRef,
  messagesEndRef,
  floatingControl,
  showLoadingState,
  reserveLatestExchangeStartSpace = false,
  transcriptKey,
  state,
  runtime,
  actions,
}: ChatMessageListProps) {
  const submittedTurnCount = useMemo(
    () => state.primaryMessages.filter((message) => message.role === 'user').length,
    [state.primaryMessages],
  )
  const { reservedSpace } = useTranscriptScroll({
    containerRef: messagesScrollRef,
    endRef: messagesEndRef,
    submittedTurnCount,
    active: reserveLatestExchangeStartSpace,
    transcriptKey,
  })

  return (
    <div className="overlay-chat-surface relative min-h-0 flex-1">
      <div
        ref={messagesScrollRef}
        className="h-full min-h-0 w-full overscroll-contain overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4"
      >
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-5 sm:gap-6">
          {showLoadingState ? (
            <ChatMessageListSkeleton />
          ) : (
            <ChatMessages
              state={state}
              runtime={runtime}
              actions={actions}
            />
          )}
          <div ref={messagesEndRef} className="h-px shrink-0" />
          {reservedSpace !== null ? (
            <div
              aria-hidden
              className="shrink-0"
              style={{ height: reservedSpace }}
            />
          ) : null}
        </div>
      </div>
      {floatingControl ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto">{floatingControl}</div>
        </div>
      ) : null}
    </div>
  )
}

function ChatMessages({
  state,
  runtime,
  actions,
}: Pick<ChatMessageListProps, 'state' | 'runtime' | 'actions'>) {
  recordRender('ChatMessages(list)')
  const userMessages = useMemo(
    () => state.primaryMessages.filter((message) => message.role === 'user'),
    [state.primaryMessages],
  )
  const transcriptView = useMemo(
    () => toChatTranscriptView({
      primaryMessages: state.primaryMessages,
      exchangeModes: state.exchangeModes,
      exchangeModels: state.exchangeModels,
      selectedTabPerExchange: state.selectedTabPerExchange,
      selectedModels: state.selectedModels,
      exchangeGenTypes: state.exchangeGenTypes,
      generationResults: state.generationResults,
      latestExchangeIndex: state.latestExchangeIndex,
      isActiveLoading: runtime.isActiveLoading,
      isOptimisticLoading: runtime.isOptimisticLoading,
      interruptedExchangeIdx: runtime.interruptedExchangeIdx,
      getResponseForExchangeForModel: runtime.getResponseForExchangeForModel,
    }),
    [
      runtime.getResponseForExchangeForModel,
      runtime.interruptedExchangeIdx,
      runtime.isActiveLoading,
      runtime.isOptimisticLoading,
      state.exchangeGenTypes,
      state.exchangeModels,
      state.exchangeModes,
      state.generationResults,
      state.latestExchangeIndex,
      state.primaryMessages,
      state.selectedModels,
      state.selectedTabPerExchange,
    ],
  )

  const renderExchange = useCallback((
    exchange: ChatTranscriptExchangeView,
    presentation: ChatTranscriptPresentation,
  ) => {
    const message = userMessages[exchange.index]
    if (!message) return null
    const generationType = exchange.generationMode

    if (generationType === 'image' || generationType === 'video') {
      return (
        <ChatMessage
          kind={generationType}
          message={message}
          exchangeIndex={exchange.index}
          generationResults={state.generationResults.get(exchange.index)}
          exchangeModels={state.exchangeModels[exchange.index] ?? []}
          selectedImageModels={state.selectedImageModels}
          selectedVideoModels={state.selectedVideoModels}
          exitingTurnIds={runtime.exitingTurnIds}
          onJumpToReply={actions.onJumpToReply}
          onDeleteTurn={actions.onDeleteTurn}
          onReplyToMediaPrompt={actions.onReplyToMediaPrompt}
          onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
          presentation={presentation}
        />
      )
    }

    return (
      <ChatMessage
        kind="text"
        message={message}
        exchangeIndex={exchange.index}
        primaryMessages={state.primaryMessages}
        latestExchangeIndex={state.latestExchangeIndex}
        actChat={runtime.actChat}
        chatInstances={runtime.chatInstances}
        exchangeModes={state.exchangeModes}
        exchangeModels={state.exchangeModels}
        selectedTabPerExchange={state.selectedTabPerExchange}
        selectedModels={state.selectedModels}
        isActiveLoading={runtime.isActiveLoading}
        isOptimisticLoading={runtime.isOptimisticLoading}
        interruptedExchangeIdx={runtime.interruptedExchangeIdx}
        exitingTurnIds={runtime.exitingTurnIds}
        sourcesPanel={runtime.sourcesPanel}
        getResponseForExchangeForModel={runtime.getResponseForExchangeForModel}
        onTabSelect={actions.onTabSelect}
        onJumpToReply={actions.onJumpToReply}
        onDeleteTurn={actions.onDeleteTurn}
        onReplyToAssistantText={actions.onReplyToAssistantText}
        onBranch={actions.onBranch}
        onOpenDraft={actions.onOpenDraft}
        onCreateAutomationDraft={actions.onCreateAutomationDraft}
        onOpenSources={(turnId: string, sources: WebSourceItem[]) => actions.onOpenSources(turnId, sources)}
        onRetry={actions.onRetry}
        onOpenFilePreview={actions.onOpenFilePreview}
        onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
        onContinue={actions.onContinue}
        onGeneratedUiChange={actions.onGeneratedUiChange}
        generatedUiConnectorActions={actions.generatedUiConnectorActions}
        presentation={presentation}
        status={exchange.status}
      />
    )
  }, [actions, runtime, state, userMessages])
  const transcriptActions = useMemo(() => ({ renderExchange }), [renderExchange])

  return (
    <ChatTranscript
      view={transcriptView}
      actions={transcriptActions}
    />
  )
}

function ChatMessageListSkeleton() {
  return (
    <div className="flex min-h-full flex-col justify-start pt-4 sm:pt-6">
      <div className="max-w-2xl space-y-4">
        <div className="tool-line-shimmer w-fit text-sm font-medium">Loading conversation</div>
        <div className="space-y-2.5">
          <div className="ui-skeleton-line h-3 w-[min(72%,34rem)]" />
          <div className="ui-skeleton-line h-3 w-[min(88%,42rem)]" />
          <div className="ui-skeleton-line h-3 w-[min(54%,26rem)]" />
        </div>
      </div>
    </div>
  )
}
