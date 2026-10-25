/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertCircle, FileText, Play, Reply } from 'lucide-react'
import type { AssistantVisualBlock, ChatExchangeStatus, ChatTranscriptSourceView, DraftModalState } from '@overlay/chat-core'
import {
  assistantBlocksToPlainText,
  buildAssistantVisualSegments,
  computeToolChainFlags,
  isUsageExhaustedError,
  planAssistantWorkCollapse,
} from '@overlay/chat-core'
import type { SourceCitationMap } from '../../lib/source-citations'
import type { WebSourceItem } from '../../lib/web-sources'
import { MarkdownMessage } from '../MarkdownMessage'
import { recordRender } from '../../lib/perf-debug'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'
import { UserMessageBubble } from '../UserMessageBubble'
import { Message, MessageContent } from '@overlay/ui/ai'
import { WorkedForGroup } from '../exchange'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import { UsageExhaustedNotice } from '../UsageExhaustedNotice'
import { ExchangeActions } from './ExchangeActions'
import { ExchangeLoadingState, exchangeLoadingPresentation } from './ExchangeLoadingState'
import { UserMessageActions } from './UserMessageActions'
import type { ChatTranscriptPresentation } from './ChatTranscript'
import { useChatExchangeSources } from './chat-exchange-sources'
import {
  AssistantSegmentItem,
  assistantSegmentKey,
  type AssistantSegmentRenderContext,
} from './AssistantSegmentItem'

export type UserImageAttachment = {
  url: string
  name: string
  mediaType?: string
}
export type AttachmentPreviewRequest = AttachmentPreview

type AutomationDraftModalState = Extract<DraftModalState, { kind: 'automation' }>

export interface ChatExchangeProps {
  userMsgId: string
  userBodyText: string
  userDocumentNames: string[]
  userIndexedAttachments?: { name: string; fileIds: string[] }[]
  userImages: UserImageAttachment[]
  exchIdx: number
  /** Model id for this tab — stable key for markdown remount when picker slots change */
  responseModelId: string
  /** Ordered tools, text, and file parts as they appear in the assistant message */
  assistantVisualBlocks: AssistantVisualBlock[]
  /** Provider-native source parts normalized by the transcript adapter. */
  responseSources?: readonly ChatTranscriptSourceView[]
  isStreaming: boolean
  isTextStreaming: boolean
  /** Persisted turn time (assistant row createdAt→updatedAt); falls back to the live measure. */
  workedDurationMs?: number | null
  errorMessage: string | null
  responseInProgress: boolean
  /** Normalized selected-response status. Host booleans remain as a compatibility fallback. */
  status?: ChatExchangeStatus
  sourceCitations?: SourceCitationMap
  turnIdForActions: string | null
  modelLabel: string
  onDeleteTurn: () => void
  onReply: () => void
  onBranch?: () => void
  /** User stopped streaming for this exchange; show notice + footer actions. */
  interrupted?: boolean
  actionsLocked: boolean
  isExiting?: boolean
  replyThreadMeta: { replyToTurnId: string; replySnippet: string } | null
  onJumpToReply: (turnId: string) => void
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: AutomationDraftModalState) => void | Promise<void>
  /** Open the shared sources sidebar with these web sources (lifted to ChatInterface). */
  onOpenSources?: (turnId: string, sources: WebSourceItem[]) => void
  /** Whether the shared sidebar is currently showing this exchange's sources. */
  isSourcesOpenForThis: boolean
  onRetry?: () => void
  retryDisabled?: boolean
  onOpenFilePreview?: (name: string, fileIds: string[]) => void
  onOpenAttachmentPreview?: (
    preview: AttachmentPreviewRequest,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  userMentions?: Array<{ type: string; id: string; name: string }>
  onContinue?: () => void
  generatedUiConnectorActions?: GeneratedUiConnectorActions
  onGeneratedUiChange?: (partId: string, data: GeneratedUiData) => void
  presentation?: Partial<ChatTranscriptPresentation>
}

function useExchangeSegments(assistantVisualBlocks: Parameters<typeof buildAssistantVisualSegments>[0]) {
  const assistantSegments = useMemo(
    () => buildAssistantVisualSegments(assistantVisualBlocks),
    [assistantVisualBlocks],
  )
  const toolChainFlags = useMemo(() => computeToolChainFlags(assistantSegments), [assistantSegments])
  return { assistantSegments, toolChainFlags }
}

function useCollapsePlan(assistantSegments: ReturnType<typeof buildAssistantVisualSegments>, isStreaming: boolean) {
  const [hasStreamed, setHasStreamed] = useState(isStreaming)
  if (isStreaming && !hasStreamed) setHasStreamed(true)
  const collapsePlan = useMemo(
    () => isStreaming || hasStreamed
      ? { collapsedIndexes: [] as number[], collapsedToolCallCount: 0 }
      : planAssistantWorkCollapse(assistantSegments),
    [assistantSegments, isStreaming, hasStreamed],
  )
  const collapsedSet = useMemo(
    () => new Set(collapsePlan.collapsedIndexes),
    [collapsePlan],
  )
  return { collapsePlan, collapsedSet }
}

function useWorkedMs(isStreaming: boolean, workedDurationMs: number | null | undefined): number | null {
  const streamStartedAtRef = useRef<number | null>(null)
  const [measuredWorkMs, setMeasuredWorkMs] = useState<number | null>(null)
  useEffect(() => {
    if (isStreaming) {
      if (streamStartedAtRef.current == null) streamStartedAtRef.current = Date.now()
      return
    }
    if (streamStartedAtRef.current != null && measuredWorkMs == null) {
      setMeasuredWorkMs(Math.max(0, Date.now() - streamStartedAtRef.current))
    }
  }, [isStreaming, measuredWorkMs])
  return workedDurationMs ?? measuredWorkMs
}

export function ChatExchange({
  userMsgId, userBodyText, userDocumentNames, userIndexedAttachments, userImages, exchIdx, responseModelId, assistantVisualBlocks, responseSources, isStreaming, isTextStreaming, workedDurationMs, errorMessage,
  responseInProgress, status, sourceCitations,
  turnIdForActions, modelLabel, onDeleteTurn, onReply, onBranch, interrupted = false, actionsLocked, isExiting = false, replyThreadMeta, onJumpToReply,
  onOpenDraft, onCreateAutomationDraft, onOpenSources, isSourcesOpenForThis, onRetry, retryDisabled = true, onOpenFilePreview, onOpenAttachmentPreview, userMentions, onContinue,
  generatedUiConnectorActions, onGeneratedUiChange, presentation,
}: ChatExchangeProps) {
    recordRender(isStreaming ? 'ChatExchange(streaming)' : 'ChatExchange')
    const assistantPlainText = assistantBlocksToPlainText(assistantVisualBlocks)
    const lastTextBlockIndex = findLastTextBlockIndex(assistantVisualBlocks)
    const { assistantSegments, toolChainFlags } = useExchangeSegments(assistantVisualBlocks)
    const { allSources, effectiveSourceCitations, webSources } = useChatExchangeSources({
      assistantPlainText,
      assistantVisualBlocks,
      responseSources,
      sourceCitations,
    })
    const { loadingPresentation, responseSettled } = resolveLoadingPresentation(status, responseInProgress, assistantVisualBlocks)

    // Turn duration: the persisted createdAt→updatedAt span wins when present;
    // live turns still measure on the streaming→settled edge.
    const workedMs = useWorkedMs(isStreaming, workedDurationMs)

    const { collapsePlan, collapsedSet } = useCollapsePlan(assistantSegments, isStreaming)
    const [workExpanded, setWorkExpanded] = useState(false)
    const segmentCtx: AssistantSegmentRenderContext = {
      keyPrefix: exchIdx,
      markdownKeyPrefix: `${userMsgId}-${responseModelId}`,
      blockCount: assistantVisualBlocks.length,
      lastTextBlockIndex,
      isStreaming,
      isTextStreaming,
      sourceCitations: effectiveSourceCitations,
      webSources,
      suppressTypingIndicator: !loadingPresentation.inlineTextMarker,
      onOpenDraft,
      onCreateAutomationDraft,
      onOpenAttachmentPreview,
      generatedUiConnectorActions,
      onGeneratedUiChange,
    }
    const copyPlainText = interruptedCopyText(assistantPlainText, interrupted, errorMessage)
    const showFooter =
      presentation?.showActions !== false &&
      responseSettled &&
      (assistantPlainText.length > 0 || !!errorMessage || interrupted)
    const densityClass = presentation?.density === 'compact' ? 'gap-1' : 'gap-2'
    return (
      <div
        className={`group/exchange relative flex flex-col ${densityClass} message-appear transition-all duration-300 ease-out ${
          isExiting ? 'pointer-events-none opacity-0 -translate-y-1' : 'translate-y-0 opacity-100'
        }`}
        style={presentation?.maxContentWidth && presentation.maxContentWidth !== '56rem'
          ? { maxWidth: presentation.maxContentWidth }
          : undefined}
        data-exchange-idx={exchIdx}
        data-overlay-link-scope=""
        data-exchange-turn={turnIdForActions ?? undefined}
      >
        {/* User message */}
        <ExchangeUserMessage
          replyThreadMeta={replyThreadMeta}
          onJumpToReply={onJumpToReply}
          userImages={userImages}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          userDocumentNames={userDocumentNames}
          userIndexedAttachments={userIndexedAttachments}
          onOpenFilePreview={onOpenFilePreview}
          userBodyText={userBodyText}
          userMentions={userMentions}
          isExiting={isExiting}
        />

        <ChatExchangeAssistantBody
          collapsePlan={collapsePlan}
          workedMs={workedMs}
          workExpanded={workExpanded}
          setWorkExpanded={setWorkExpanded}
          assistantSegments={assistantSegments}
          collapsedSet={collapsedSet}
          toolChainFlags={toolChainFlags}
          exchIdx={exchIdx}
          isStreaming={isStreaming}
          segmentCtx={segmentCtx}
          errorMessage={errorMessage}
          loadingPresentation={loadingPresentation}
          responseInProgress={responseInProgress}
          interrupted={interrupted}
          responseSettled={responseSettled}
          onContinue={onContinue}
          showFooter={showFooter}
          copyPlainText={copyPlainText}
          isExiting={isExiting}
          onRetry={onRetry}
          retryDisabled={retryDisabled}
          onDeleteTurn={onDeleteTurn}
          onReply={onReply}
          onBranch={onBranch}
          turnIdForActions={turnIdForActions}
          actionsLocked={actionsLocked}
          allSources={allSources}
          onOpenSources={onOpenSources}
          userMsgId={userMsgId}
          isSourcesOpenForThis={isSourcesOpenForThis}
          modelLabel={modelLabel}
          actionVisibility={presentation?.actionVisibility}
          showModelLabel={presentation?.showModelLabel}
        />
      </div>
    )
}

type ChatExchangeAssistantBodyProps = {
  collapsePlan: ReturnType<typeof useCollapsePlan>['collapsePlan']
  workedMs: number | null
  workExpanded: boolean
  setWorkExpanded: Dispatch<SetStateAction<boolean>>
  assistantSegments: ReturnType<typeof useExchangeSegments>['assistantSegments']
  collapsedSet: ReturnType<typeof useCollapsePlan>['collapsedSet']
  toolChainFlags: ReturnType<typeof useExchangeSegments>['toolChainFlags']
  exchIdx: number
  isStreaming: boolean
  segmentCtx: AssistantSegmentRenderContext
  errorMessage: ChatExchangeProps['errorMessage']
  loadingPresentation: ReturnType<typeof exchangeLoadingPresentation>
  responseInProgress: ChatExchangeProps['responseInProgress']
  interrupted: boolean
  responseSettled: boolean
  onContinue: ChatExchangeProps['onContinue']
  showFooter: boolean
  copyPlainText: string
  isExiting: boolean
  onRetry: ChatExchangeProps['onRetry']
  retryDisabled: boolean
  onDeleteTurn: ChatExchangeProps['onDeleteTurn']
  onReply: ChatExchangeProps['onReply']
  onBranch: ChatExchangeProps['onBranch']
  turnIdForActions: ChatExchangeProps['turnIdForActions']
  actionsLocked: ChatExchangeProps['actionsLocked']
  allSources: ReturnType<typeof useChatExchangeSources>['allSources']
  onOpenSources: ChatExchangeProps['onOpenSources']
  userMsgId: string
  isSourcesOpenForThis: ChatExchangeProps['isSourcesOpenForThis']
  modelLabel: string
  actionVisibility?: 'always' | 'hover'
  showModelLabel?: boolean
}

function ChatExchangeAssistantBody({
  collapsePlan,
  workedMs,
  workExpanded,
  setWorkExpanded,
  assistantSegments,
  collapsedSet,
  toolChainFlags,
  exchIdx,
  isStreaming,
  segmentCtx,
  errorMessage,
  loadingPresentation,
  responseInProgress,
  interrupted,
  responseSettled,
  onContinue,
  showFooter,
  copyPlainText,
  isExiting,
  onRetry,
  retryDisabled,
  onDeleteTurn,
  onReply,
  onBranch,
  turnIdForActions,
  actionsLocked,
  allSources,
  onOpenSources,
  userMsgId,
  isSourcesOpenForThis,
  modelLabel,
  actionVisibility,
  showModelLabel,
}: ChatExchangeAssistantBodyProps) {
  return (
    <Message>
      <MessageContent className="gap-2">
        {collapsePlan.collapsedIndexes.length > 0 && (
          <WorkedForGroup
            durationMs={workedMs}
            toolCallCount={collapsePlan.collapsedToolCallCount}
            expanded={workExpanded}
            onToggle={() => setWorkExpanded((v) => !v)}
          />
        )}
        {assistantSegments.map((seg, segIdx) => {
          if (!workExpanded && collapsedSet.has(segIdx)) return null
          const chain = toolChainFlags[segIdx]!
          return (
            <AssistantSegmentItem
              key={assistantSegmentKey(exchIdx, seg, isStreaming)}
              seg={seg}
              chainTop={chain.chainTop}
              chainBottom={chain.chainBottom}
              ctx={segmentCtx}
            />
          )
        })}

        {!errorMessage ? <ExchangeLoadingState presentation={loadingPresentation} /> : null}

        {errorMessage && !responseInProgress && (
          <ExchangeErrorNotice errorMessage={errorMessage} />
        )}

        <ExchangeSettledNotices
          interrupted={interrupted}
          responseSettled={responseSettled}
          errorMessage={errorMessage}
          onContinue={onContinue}
        />

        {showFooter && (
          <ExchangeActions
            copyPlainText={copyPlainText}
            isExiting={isExiting}
            onRetry={onRetry}
            retryDisabled={retryDisabled}
            onDeleteTurn={onDeleteTurn}
            onReply={onReply}
            onBranch={onBranch}
            turnIdForActions={turnIdForActions}
            actionsLocked={actionsLocked}
            sources={allSources}
            onOpenSources={onOpenSources}
            userMsgId={userMsgId}
            isSourcesOpenForThis={isSourcesOpenForThis}
            modelLabel={modelLabel}
            actionVisibility={actionVisibility}
            showModelLabel={showModelLabel}
          />
        )}
      </MessageContent>
    </Message>
  )
}

function resolveLoadingPresentation(
  status: ChatExchangeStatus | undefined,
  responseInProgress: boolean | undefined,
  assistantVisualBlocks: AssistantVisualBlock[],
) {
  const normalizedStatus: ChatExchangeStatus = status ?? (
    responseInProgress ? (assistantVisualBlocks.length > 0 ? 'streaming' : 'submitted') : 'completed'
  )
  const loadingPresentation = exchangeLoadingPresentation(normalizedStatus, assistantVisualBlocks)
  return { loadingPresentation, responseSettled: !loadingPresentation.active }
}

function interruptedCopyText(
  assistantPlainText: string,
  interrupted: boolean | undefined,
  errorMessage: string | null | undefined,
) {
  return interrupted && !errorMessage
    ? assistantPlainText.trim()
      ? `${assistantPlainText}\n\nResponse was interrupted.`
      : 'Response was interrupted.'
    : assistantPlainText
}

function findLastTextBlockIndex(blocks: AssistantVisualBlock[]): number {
  let idx = -1
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.kind === 'text') idx = i
  }
  return idx
}

function ExchangeUserMessage({
  replyThreadMeta,
  onJumpToReply,
  userImages,
  onOpenAttachmentPreview,
  userDocumentNames,
  userIndexedAttachments,
  onOpenFilePreview,
  userBodyText,
  userMentions,
  isExiting,
}: {
  replyThreadMeta: ChatExchangeProps['replyThreadMeta']
  onJumpToReply: ChatExchangeProps['onJumpToReply']
  userImages: ChatExchangeProps['userImages']
  onOpenAttachmentPreview: ChatExchangeProps['onOpenAttachmentPreview']
  userDocumentNames: ChatExchangeProps['userDocumentNames']
  userIndexedAttachments: ChatExchangeProps['userIndexedAttachments']
  onOpenFilePreview: ChatExchangeProps['onOpenFilePreview']
  userBodyText: ChatExchangeProps['userBodyText']
  userMentions: ChatExchangeProps['userMentions']
  isExiting: boolean
}) {
  const showTextBubble = userBodyText.length > 0
  return (
    <Message align="end">
      <MessageContent className="max-w-[min(92%,36rem)] gap-2 sm:max-w-[75%]">
        {replyThreadMeta && (
          <Button variant="ghost"
            type="button"
            onClick={() => onJumpToReply(replyThreadMeta.replyToTurnId)}
            // overlay:button-style: Transcript chip with its own selected state.
            className={unstyledButton(`mb-1 max-w-full rounded-lg border border-(--border) bg-(--surface-subtle) px-2.5 py-1.5 text-left text-[11px] text-(--muted) transition-colors hover:bg-(--border) hover:text-(--foreground)`)}
          >
            <span className="flex items-center gap-1.5 font-medium text-(--foreground)">
              <Reply size={12} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
              Replying to
            </span>
            <span className="mt-0.5 line-clamp-2 block text-(--muted)">{replyThreadMeta.replySnippet}</span>
          </Button>
        )}
        {userImages.length > 0 && (
          <div className="flex w-full flex-wrap justify-end gap-1.5">
            {userImages.map((attachment) => (
              <Button variant="ghost"
                key={attachment.url}
                type="button"
                onClick={() => onOpenAttachmentPreview?.({
                  name: attachment.name,
                  content: attachment.url,
                  url: attachment.url,
                })}
                className={unstyledButton(`group rounded-xl outline-hidden transition-transform hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-(--foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)`)}
                title="Open attachment"
              >
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  className="max-h-[200px] max-w-[200px] rounded-xl border border-transparent object-cover transition-colors group-hover:border-(--border)"
                />
              </Button>
            ))}
          </div>
        )}
        {userDocumentNames.length > 0 && (
          <div className="flex w-full flex-wrap justify-end gap-1.5">
            {userDocumentNames.map((name) => {
              const attachment = userIndexedAttachments?.find((a) => a.name === name)
              const clickable = !!attachment && attachment.fileIds.length > 0 && !!onOpenFilePreview
              return (
                <div
                  key={name}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={`flex max-w-[220px] items-center gap-1.5 rounded-xl border border-(--border) bg-(--surface-elevated) px-2.5 py-1.5 text-xs text-(--muted) shadow-xs ${clickable ? 'cursor-pointer hover:bg-(--surface-subtle) transition-colors' : ''}`}
                  onClick={() => {
                    if (clickable) onOpenFilePreview!(name, attachment.fileIds)
                  }}
                  onKeyDown={clickable ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenFilePreview!(name, attachment.fileIds)
                    }
                  } : undefined}
                  title={clickable ? 'Click to preview' : undefined}
                >
                  <FileText size={13} className="shrink-0 text-(--muted)" />
                  <span className="truncate font-medium text-(--foreground)">{name}</span>
                </div>
              )
            })}
          </div>
        )}
        {showTextBubble && (
          <>
            <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
              <MarkdownMessage text={userBodyText} isStreaming={false} mentions={userMentions} />
            </UserMessageBubble>
            <UserMessageActions markdown={userBodyText} disabled={isExiting} />
          </>
        )}
      </MessageContent>
    </Message>
  )
}

function ExchangeErrorNotice({ errorMessage }: { errorMessage: string }) {
  return (
    <div className="flex justify-start px-1 py-1">
      {isUsageExhaustedError(errorMessage) ? (
        <UsageExhaustedNotice />
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
          style={{
            background: 'var(--chat-alert-error-bg)',
            borderColor: 'var(--chat-alert-error-border)',
            color: 'var(--chat-alert-error-text)',
          }}
        >
          <AlertCircle size={12} />
          {errorMessage}
        </div>
      )}
    </div>
  )
}

function ExchangeSettledNotices({
  interrupted,
  responseSettled,
  errorMessage,
  onContinue,
}: {
  interrupted: boolean
  responseSettled: boolean
  errorMessage: string | null
  onContinue: ChatExchangeProps['onContinue']
}) {
  return (
    <>
      {interrupted && responseSettled && !errorMessage && (
        <div className="flex justify-start px-1 py-1">
          <p className="text-sm text-(--muted)">Response was interrupted.</p>
        </div>
      )}

      {onContinue && responseSettled && !errorMessage && (
        <div className="flex justify-start px-1 py-1">
          <Button variant="secondary" size="sm"
            type="button"
            onClick={onContinue}
          >
            <Play size={13} strokeWidth={1.75} />
            Continue
          </Button>
        </div>
      )}
    </>
  )
}
