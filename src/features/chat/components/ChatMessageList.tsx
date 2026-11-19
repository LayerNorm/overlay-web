'use client'

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@overlay/ui/ai'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranscriptCacheScope, transcriptCache } from '@/components/providers/transcript-cache-client'
import { transcriptCacheKey } from '@/shared/chat/transcript-cache'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
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
} from '@overlay/chat-react/transcript'
import type { ChatTranscriptExchangeView } from '@overlay/chat-core'
import { getUserTurnId } from '@overlay/chat-core'
import type { DraftModalState, GenerationResult } from './chat-interface/types'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { ChatMessage } from './ChatMessage'
import { toChatTranscriptView } from './chat/toChatTranscriptView'
import { reconcileTranscriptIdentity } from './chat/chat-transcript-identity'
import { useChatRowCallbacks } from './chat/useChatRowCallbacks'

const readOnlyAction = () => {}

type ChatInstance = UseChatHelpers<UIMessage>

export type ChatMessageListState = {
  primaryMessages: UIMessage[]
  latestExchangeIndex: number
  generationResults: Map<number, GenerationResult[]>
  exchangeGenTypes: ('text' | 'image' | 'video')[]
  exchangeModels: string[][]
  selectedImageModels: string[]
  selectedVideoModels: string[]
  selectedModels: string[]
  exchangeModes: ('ask' | 'act')[]
}

export type ChatMessageListRuntime = {
  readOnly?: boolean
  actChat: ChatInstance
  chatInstances: ChatInstance[]
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  interruptedExchangeIdx: number | null
  exitingTurnIds: string[]
  sourcesPanel: { turnId: string; sources: WebSourceItem[] } | null
  getResponseForExchange: (exchangeIndex: number) => UIMessage | null
  getResponsesForExchange?: (exchangeIndex: number) => readonly UIMessage[]
  canonicalTranscript?: boolean
  transcriptPagination?: {
    hasMore: boolean
    loadingMore: boolean
    loadMore(): void
  }
}

export type ChatMessageListActions = {
  onJumpToReply: (turnId: string) => void
  onDeleteTurn: (turnId: string) => void | Promise<void>
  onReplyToMediaPrompt: (prompt: string, kind: 'image' | 'video', turnId: string | null) => void
  onReplyToAssistantText: (assistantText: string, turnId: string | null) => void
  onBranch: (turnId: string | null) => void | Promise<void>
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: Extract<DraftModalState, { kind: 'automation' }>) => void | Promise<void>
  onOpenSources: (turnId: string, sources: WebSourceItem[]) => void
  onRetry: (message: UIMessage, exchangeIndex: number, isActExchange: boolean, modelId: string) => void | Promise<void>
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
  /** @deprecated Message Scroller anchors the submitted turn; kept for host compatibility. */
  reserveLatestExchangeStartSpace?: boolean
  transcriptKey?: string | null
  afterMessages?: ReactNode
  state: ChatMessageListState
  runtime: ChatMessageListRuntime
  actions: ChatMessageListActions
}

export function ChatMessageList({
  messagesScrollRef,
  messagesEndRef,
  floatingControl,
  showLoadingState,
  transcriptKey,
  afterMessages,
  state,
  runtime,
  actions,
}: ChatMessageListProps) {
  recordRender('ChatMessageList')
  const conversationId = transcriptKey ?? null
  const paginationAnchorRef = useRef<{ conversationId: string | null; turnId: string; top: number } | null>(null)
  const loadingMoreRef = useRef(false)
  const wasLoadingMoreRef = useRef(false)
  const firstUserMessage = state.primaryMessages.find((message) => message.role === 'user')
  const firstTurnId = firstUserMessage ? getUserTurnId(firstUserMessage) ?? firstUserMessage.id : null
  const [identity, setIdentity] = useState({ conversationId, firstTurnId, key: 0 })
  const nextIdentity = reconcileTranscriptIdentity(identity, conversationId, firstTurnId)
  if (nextIdentity !== identity) setIdentity(nextIdentity)
  const cacheScope = useTranscriptCacheScope()
  const scrollKey = cacheScope && conversationId
    ? transcriptCacheKey(cacheScope, { kind: 'personal', conversationId })
    : null
  useTranscriptScrollMemory(messagesScrollRef, scrollKey, nextIdentity.key, state.primaryMessages.length)
  useLayoutEffect(() => {
    const anchor = paginationAnchorRef.current
    if (!runtime.transcriptPagination?.loadingMore) loadingMoreRef.current = false
    if (!anchor) return
    if (anchor.conversationId !== conversationId) {
      paginationAnchorRef.current = null
      wasLoadingMoreRef.current = false
      return
    }
    if (runtime.transcriptPagination?.loadingMore) {
      wasLoadingMoreRef.current = true
      return
    }
    if (!wasLoadingMoreRef.current) return
    const viewport = messagesScrollRef.current
    const element = viewport
      ? Array.from(viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]'))
        .find((candidate) => candidate.dataset.exchangeTurn === anchor.turnId)
      : undefined
    if (viewport && element) {
      const delta = element.getBoundingClientRect().top - anchor.top
      viewport.scrollTop += delta
    }
    paginationAnchorRef.current = null
    wasLoadingMoreRef.current = false
  }, [conversationId, messagesScrollRef, runtime.transcriptPagination?.loadingMore, state.primaryMessages])

  const loadEarlier = () => {
    const pagination = runtime.transcriptPagination
    if (!pagination?.hasMore || pagination.loadingMore || loadingMoreRef.current) return
    const viewport = messagesScrollRef.current
    const firstVisible = viewport
      ? Array.from(viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]'))
        .find((element) => {
          const rect = element.getBoundingClientRect()
          const viewportRect = viewport.getBoundingClientRect()
          return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
        })
      : undefined
    if (firstVisible) {
      paginationAnchorRef.current = {
        conversationId,
        turnId: firstVisible.dataset.exchangeTurn ?? '',
        top: firstVisible.getBoundingClientRect().top,
      }
    }
    loadingMoreRef.current = true
    wasLoadingMoreRef.current = true
    pagination.loadMore()
  }

  return (
    <MessageScrollerProvider key={nextIdentity.key} defaultScrollPosition="end" autoScroll>
      <MessageScroller className="overlay-chat-surface min-h-0 flex-1">
        <MessageScrollerViewport
          ref={messagesScrollRef}
          aria-label="Conversation"
          className="overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4"
        >
          <MessageScrollerContent data-chat-transcript className="mx-auto w-full min-w-0 max-w-4xl gap-5 sm:gap-6">
            {runtime.transcriptPagination?.hasMore ? (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={runtime.transcriptPagination.loadingMore}
                  onClick={loadEarlier}
                  aria-label={runtime.transcriptPagination.loadingMore ? 'Loading earlier messages' : 'Load earlier messages'}
                >
                  {runtime.transcriptPagination.loadingMore ? 'Loading earlier messages…' : 'Load earlier messages'}
                </Button>
              </div>
            ) : null}
            {showLoadingState ? (
              <ChatMessageListSkeleton />
            ) : (
              <ChatMessages
                state={state}
                runtime={runtime}
                actions={actions}
              />
            )}
            {afterMessages ? <div className="px-1 py-1">{afterMessages}</div> : null}
            <div ref={messagesEndRef} className="h-px shrink-0" />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {floatingControl ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <div className="pointer-events-auto">{floatingControl}</div>
          </div>
        ) : null}
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

const RESTORE_SETTLE_FRAMES = 45
const RESTORE_CANCEL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

function exchangeAnchor(viewport: HTMLElement) {
  const top = viewport.getBoundingClientRect().top
  for (const element of viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom > top && element.dataset.exchangeTurn) return { anchorId: element.dataset.exchangeTurn, offset: rect.top - top }
  }
  return null
}

/**
 * Remembers where the reader was in each personal conversation and, on a
 * revisit, returns them to that exchange once it is rendered. A reader who was
 * following the newest message keeps the scroller's default end position.
 */
function useTranscriptScrollMemory(
  viewportRef: ChatMessageListProps['messagesScrollRef'],
  scrollKey: string | null,
  viewportKey: number,
  rowCount: number,
) {
  const restoredKeyRef = useRef<string | null>(null)
  const stopRestoreRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRestoreRef.current?.(), [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !scrollKey || restoredKeyRef.current === scrollKey || rowCount === 0) return
    restoredKeyRef.current = scrollKey
    stopRestoreRef.current?.()
    stopRestoreRef.current = null
    const snapshot = transcriptCache.scroll(scrollKey)
    if (!snapshot || snapshot.atBottom || !snapshot.anchorId) return
    const anchorId = snapshot.anchorId
    const align = () => {
      const element = Array.from(viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]'))
        .find((candidate) => candidate.dataset.exchangeTurn === anchorId)
      if (!element) return
      viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - snapshot.offset
    }
    // The scroller settles its default end position and rows change height for a few frames
    // after layout; keep the anchor in place until then unless the reader takes over.
    let frame = 0
    let frames = 0
    const stop = () => {
      window.cancelAnimationFrame(frame)
      for (const type of RESTORE_CANCEL_EVENTS) viewport.removeEventListener(type, stop, { capture: true })
    }
    const settle = () => {
      align()
      frames += 1
      frame = frames < RESTORE_SETTLE_FRAMES ? window.requestAnimationFrame(settle) : 0
    }
    for (const type of RESTORE_CANCEL_EVENTS) viewport.addEventListener(type, stop, { capture: true, passive: true })
    stopRestoreRef.current = stop
    settle()
  }, [rowCount, scrollKey, viewportKey, viewportRef])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !scrollKey) return
    let frame: number | null = null
    const save = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 96
        const anchor = atBottom ? null : exchangeAnchor(viewport)
        transcriptCache.saveScroll(scrollKey, {
          atBottom: atBottom || !anchor, anchorId: anchor?.anchorId ?? null, offset: anchor?.offset ?? 0,
        })
      })
    }
    viewport.addEventListener('scroll', save, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', save)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [scrollKey, viewportKey, viewportRef])
}

function ChatMessages({
  state,
  runtime,
  actions: incomingActions,
}: Pick<ChatMessageListProps, 'state' | 'runtime' | 'actions'>) {
  const actions = useChatRowCallbacks(incomingActions)
  recordRender('ChatMessages(list)')
  const userMessages = useMemo(
    () => state.primaryMessages.filter((message) => message.role === 'user'),
    [state.primaryMessages],
  )
  const [selectedResponseIds, setSelectedResponseIds] = useState<Record<string, string>>({})
  const transcriptView = useMemo(
    () => toChatTranscriptView({
      primaryMessages: state.primaryMessages,
      exchangeModes: state.exchangeModes,
      exchangeModels: state.exchangeModels,
      selectedModels: state.selectedModels,
      exchangeGenTypes: state.exchangeGenTypes,
      generationResults: state.generationResults,
      latestExchangeIndex: state.latestExchangeIndex,
      isActiveLoading: runtime.isActiveLoading,
      isOptimisticLoading: runtime.isOptimisticLoading,
      interruptedExchangeIdx: runtime.interruptedExchangeIdx,
      getResponseForExchange: runtime.getResponseForExchange,
      getResponsesForExchange: runtime.getResponsesForExchange,
    }),
    [
      runtime.getResponseForExchange,
      runtime.getResponsesForExchange,
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
    ],
  )

  const renderExchange = useCallback((
    exchange: ChatTranscriptExchangeView,
    presentation: ChatTranscriptPresentation,
  ) => {
    const message = userMessages[exchange.index]
    if (!message) return null
    const generationType = exchange.generationMode
    const isOrphan = runtime.canonicalTranscript
      && (message.metadata as { nativeOrphan?: boolean } | undefined)?.nativeOrphan === true
    const isDeleted = runtime.canonicalTranscript
      && Boolean((message.metadata as { deletedAt?: unknown } | undefined)?.deletedAt)
    const readOnly = runtime.readOnly || isOrphan || isDeleted
      || (runtime.canonicalTranscript && !('persistedId' in message))
    const { canonicalResponses, selectedResponse, selectedResponseIdentity, selectedResponseIndex, selectedExchangeModels } =
      selectTranscriptResponse(exchange, runtime, state, selectedResponseIds)

    if (generationType === 'image' || generationType === 'video') {
      return (
        <div data-exchange-turn={exchange.turnId}>
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
            onDeleteTurn={readOnly ? readOnlyAction : actions.onDeleteTurn}
            onReplyToMediaPrompt={readOnly ? readOnlyAction : actions.onReplyToMediaPrompt}
            onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
            presentation={presentation}
          />
        </div>
      )
    }

    return (
      <div data-exchange-turn={exchange.turnId} className="space-y-2">
        {canonicalResponses.length > 1 ? (
          <div className="flex items-center justify-end gap-1" aria-label="Assistant response versions">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Previous response"
              disabled={selectedResponseIndex <= 0}
              onClick={() => {
                const previous = canonicalResponses[selectedResponseIndex - 1] as { persistedId?: string; id?: string } | undefined
                if (previous) {
                  setSelectedResponseIds((current) => ({
                    ...current,
                    [exchange.turnId]: previous.persistedId ?? previous.id ?? '',
                  }))
                }
              }}
              className="h-7 w-7"
            >
              <ChevronLeft size={15} />
            </Button>
            <span className="min-w-12 text-center text-xs text-(--muted)" aria-live="polite">
              {selectedResponseIndex + 1} of {canonicalResponses.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Next response"
              disabled={selectedResponseIndex < 0 || selectedResponseIndex >= canonicalResponses.length - 1}
              onClick={() => {
                const next = canonicalResponses[selectedResponseIndex + 1] as { persistedId?: string; id?: string } | undefined
                if (next) {
                  setSelectedResponseIds((current) => ({
                    ...current,
                    [exchange.turnId]: next.persistedId ?? next.id ?? '',
                  }))
                }
              }}
              className="h-7 w-7"
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        ) : null}
        {isOrphan ? (
          <p className="text-xs text-(--muted)">Original message unavailable</p>
        ) : null}
        <ChatMessage
          kind="text"
          readOnly={readOnly}
          canonicalTranscript={runtime.canonicalTranscript}
          canonicalResponse={selectedResponse}
          hasCanonicalResponse={runtime.canonicalTranscript === true}
          responseIdentity={selectedResponseIdentity}
          message={message}
          exchangeIndex={exchange.index}
          primaryMessages={state.primaryMessages}
          latestExchangeIndex={state.latestExchangeIndex}
          actChat={runtime.actChat}
          chatInstances={runtime.chatInstances}
          exchangeModes={state.exchangeModes}
          exchangeModels={selectedExchangeModels}
          selectedModels={state.selectedModels}
          isActiveLoading={runtime.isActiveLoading}
          isOptimisticLoading={runtime.isOptimisticLoading}
          interruptedExchangeIdx={runtime.interruptedExchangeIdx}
          exitingTurnIds={runtime.exitingTurnIds}
          sourcesPanel={runtime.sourcesPanel}
          getResponseForExchange={runtime.getResponseForExchange}
          onJumpToReply={actions.onJumpToReply}
          onDeleteTurn={actions.onDeleteTurn}
          onReplyToAssistantText={actions.onReplyToAssistantText}
          onBranch={readOnly ? readOnlyAction : actions.onBranch}
          onOpenDraft={actions.onOpenDraft}
          onCreateAutomationDraft={actions.onCreateAutomationDraft}
          onOpenSources={actions.onOpenSources}
          onRetry={readOnly ? readOnlyAction : actions.onRetry}
          onOpenFilePreview={actions.onOpenFilePreview}
          onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
          onContinue={actions.onContinue}
          onGeneratedUiChange={actions.onGeneratedUiChange}
          generatedUiConnectorActions={actions.generatedUiConnectorActions}
          presentation={presentation}
          status={exchange.status}
        />
      </div>
    )
  }, [actions, runtime, selectedResponseIds, state, userMessages])
  const transcriptActions = useMemo(() => ({ renderExchange }), [renderExchange])

  return (
    <ChatTranscript
      scrollItems
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

function selectTranscriptResponse(exchange: ChatTranscriptExchangeView, runtime: ChatMessageListRuntime,
  state: ChatMessageListState, selectedResponseIds: Record<string, string>) {
  const canonicalResponses = runtime.canonicalTranscript
    ? runtime.getResponsesForExchange?.(exchange.index) ?? []
    : []
  const selectedIdentity = selectedResponseIds[exchange.turnId]
  const selectedResponse = canonicalResponses.find((response) => {
    const value = response as { persistedId?: string; id?: string }
    return (value.persistedId ?? value.id) === selectedIdentity
  }) ?? canonicalResponses.at(-1) ?? null
  const selectedResponseIdentity = selectedResponse
    ? ((selectedResponse as { persistedId?: string; id?: string }).persistedId
      ?? (selectedResponse as { id?: string }).id
      ?? '')
    : ''
  const selectedResponseIndex = selectedResponse
    ? canonicalResponses.indexOf(selectedResponse)
    : -1
  const selectedModel = (selectedResponse as { model?: string } | null)?.model
  const selectedExchangeModels = selectedModel
    ? state.exchangeModels.map((models, index) => (
      index === exchange.index ? [selectedModel] : models
    ))
    : state.exchangeModels

  return { canonicalResponses, selectedResponse, selectedResponseIdentity, selectedResponseIndex, selectedExchangeModels }
}
