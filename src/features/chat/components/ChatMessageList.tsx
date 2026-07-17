'use client'

import type { ReactNode, RefObject } from 'react'
import { useEffect, useState } from 'react'
import type { UseChatHelpers } from '@/components/providers/ai-chat-client'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { WebSourceItem } from '@/shared/web/web-sources'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
  GeneratedUiConnectorActions,
} from '@overlay/chat-react'
import type { DraftModalState, GenerationResult } from './chat-interface/types'
import { streamingReservedSpacerHeight } from '../lib/constrain-streaming-scroll'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { ChatMessage } from './ChatMessage'

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
  state,
  runtime,
  actions,
}: ChatMessageListProps) {
  // Size the reserved tail spacer to the viewport so the scroll limit is a
  // natural boundary. This keeps the streaming exchange's tail visible without
  // correcting scrollTop on every scroll event (which fights inertial scrolling
  // and makes the stream flicker, especially near the header).
  const [reservedSpacerHeight, setReservedSpacerHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!reserveLatestExchangeStartSpace) return
    const container = messagesScrollRef.current
    if (!container) return
    // ResizeObserver fires once immediately on observe() with the current size,
    // then on every resize. Setting state only from this callback keeps the
    // measurement in sync without a synchronous setState in the effect body.
    const observer = new ResizeObserver(() => {
      setReservedSpacerHeight(streamingReservedSpacerHeight(container.clientHeight))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [reserveLatestExchangeStartSpace, messagesScrollRef])

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
          {reserveLatestExchangeStartSpace ? (
            <div
              aria-hidden
              className="shrink-0"
              style={{ height: reservedSpacerHeight ?? undefined }}
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
  const blocks: ReactNode[] = []
  let exchangeIndex = 0

  for (const message of state.primaryMessages) {
    if (message.role !== 'user') continue
    const currentExchangeIndex = exchangeIndex++
    const generationType = state.exchangeGenTypes[currentExchangeIndex]

    if (generationType === 'image' || generationType === 'video') {
      blocks.push(
        <ChatMessage
          key={message.id}
          kind={generationType}
          message={message}
          exchangeIndex={currentExchangeIndex}
          generationResults={state.generationResults.get(currentExchangeIndex)}
          exchangeModels={state.exchangeModels[currentExchangeIndex] ?? []}
          selectedImageModels={state.selectedImageModels}
          selectedVideoModels={state.selectedVideoModels}
          exitingTurnIds={runtime.exitingTurnIds}
          onJumpToReply={actions.onJumpToReply}
          onDeleteTurn={actions.onDeleteTurn}
          onReplyToMediaPrompt={actions.onReplyToMediaPrompt}
          onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
        />,
      )
      continue
    }

    blocks.push(
      <ChatMessage
        key={message.id}
        kind="text"
        message={message}
        exchangeIndex={currentExchangeIndex}
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
      />,
    )
  }

  return blocks
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
