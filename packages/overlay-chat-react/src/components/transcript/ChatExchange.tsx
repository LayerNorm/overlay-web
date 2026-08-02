/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { useMemo } from 'react'
import { AlertCircle, FileText, Play, Reply } from 'lucide-react'
import type { AssistantVisualBlock, ChatExchangeStatus, DraftModalState } from '@overlay/chat-core'
import {
  assistantBlocksToPlainText,
  collectWebSourcesFromBlocks,
} from '@overlay/chat-core'
import type { SourceCitationMap } from '../../lib/source-citations'
import type { WebSourceItem } from '../../lib/web-sources'
import { recordRender } from '../../lib/perf-debug'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'
import { UserMessageBubble } from '../UserMessageBubble'
import { renderInlineMentions } from '../exchange'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import { AssistantVisualBlocks } from './AssistantVisualBlocks'
import { ExchangeActions } from './ExchangeActions'
import { ExchangeLoadingState, exchangeLoadingPresentation } from './ExchangeLoadingState'
import type { ChatTranscriptPresentation } from './ChatTranscript'

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
  isStreaming: boolean
  isTextStreaming: boolean
  errorMessage: string | null
  exchModelList: string[]
  selectedTab: number
  onTabSelect: (tabIdx: number) => void
  isLoadingTabs: boolean
  responseInProgress: boolean
  /** Normalized selected-response status. Host booleans remain as a compatibility fallback. */
  status?: ChatExchangeStatus
  sourceCitations?: SourceCitationMap
  turnIdForActions: string | null
  modelLabel: string
  onDeleteTurn: () => void
  onReply: () => void
  onBranch?: () => void
  onSaveToKnowledge?: () => void
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
  getModelDisplayName: (modelId: string) => string
  generatedUiConnectorActions?: GeneratedUiConnectorActions
  onGeneratedUiChange?: (partId: string, data: GeneratedUiData) => void
  presentation?: Partial<ChatTranscriptPresentation>
}

export function ChatExchange({
  userMsgId, userBodyText, userDocumentNames, userIndexedAttachments, userImages, exchIdx, responseModelId, assistantVisualBlocks, isStreaming, isTextStreaming, errorMessage,
  exchModelList, selectedTab, onTabSelect, isLoadingTabs, responseInProgress, status, sourceCitations,
  turnIdForActions, modelLabel, onDeleteTurn, onReply, onBranch, onSaveToKnowledge, interrupted = false, actionsLocked, isExiting = false, replyThreadMeta, onJumpToReply,
  onOpenDraft, onCreateAutomationDraft, onOpenSources, isSourcesOpenForThis, onRetry, retryDisabled = true, onOpenFilePreview, onOpenAttachmentPreview, userMentions, onContinue, getModelDisplayName,
  generatedUiConnectorActions, onGeneratedUiChange, presentation,
}: ChatExchangeProps) {
    recordRender(isStreaming ? 'ChatExchange(streaming)' : 'ChatExchange')
    const showTextBubble = userBodyText.length > 0
    const assistantPlainText = assistantBlocksToPlainText(assistantVisualBlocks)
    const webSources = useMemo(() => collectWebSourcesFromBlocks(assistantVisualBlocks), [assistantVisualBlocks])
    const normalizedStatus: ChatExchangeStatus = status ?? (
      responseInProgress ? (assistantVisualBlocks.length > 0 ? 'streaming' : 'submitted') : 'completed'
    )
    const loadingPresentation = exchangeLoadingPresentation(normalizedStatus, assistantVisualBlocks)
    const responseSettled = !loadingPresentation.active
    const copyPlainText =
      interrupted && !errorMessage
        ? assistantPlainText.trim()
          ? `${assistantPlainText}\n\nResponse was interrupted.`
          : 'Response was interrupted.'
        : assistantPlainText
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
        data-exchange-turn={turnIdForActions ?? undefined}
      >
        {/* User message */}
        <div className="flex min-w-0 justify-end">
          <div className="flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-2 sm:max-w-[75%]">
            {replyThreadMeta && (
              <button
                type="button"
                onClick={() => onJumpToReply(replyThreadMeta.replyToTurnId)}
                className="mb-1 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-left text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
              >
                <span className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                  <Reply size={12} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
                  Replying to
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[var(--muted)]">{replyThreadMeta.replySnippet}</span>
              </button>
            )}
            {userImages.length > 0 && (
              <div className="flex w-full flex-wrap justify-end gap-1.5">
                {userImages.map((attachment, i) => (
                  <button
                    key={`${attachment.url}-${i}`}
                    type="button"
                    onClick={() => onOpenAttachmentPreview?.({
                      name: attachment.name,
                      content: attachment.url,
                      url: attachment.url,
                    })}
                    className="group rounded-xl outline-none transition-transform hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-[var(--foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                    title="Open attachment"
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.name}
                      className="max-h-[200px] max-w-[200px] rounded-xl border border-transparent object-cover transition-colors group-hover:border-[var(--border)]"
                    />
                  </button>
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
                      className={`flex max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--muted)] shadow-sm ${clickable ? 'cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors' : ''}`}
                      onClick={() => {
                        if (clickable) onOpenFilePreview!(name, attachment.fileIds)
                      }}
                      title={clickable ? 'Click to preview' : undefined}
                    >
                      <FileText size={13} className="shrink-0 text-[var(--muted)]" />
                      <span className="truncate font-medium text-[var(--foreground)]">{name}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {showTextBubble && (
              <UserMessageBubble className="ml-auto max-w-full">
                {renderInlineMentions(userBodyText, userMentions)}
              </UserMessageBubble>
            )}
          </div>
        </div>

        {/* Inline model tabs — only shown when multiple models are active for this exchange */}
        {exchModelList.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {exchModelList.map((mId, tabIdx) => {
              const mName = getModelDisplayName(mId)
              const isActive = tabIdx === selectedTab
              return (
                <button
                  key={mId}
                  type="button"
                  onClick={() => !isLoadingTabs && onTabSelect(tabIdx)}
                  disabled={isLoadingTabs}
                  aria-pressed={isActive}
                  className={`px-2.5 py-0.5 rounded-full text-xs transition-colors ${
                    isLoadingTabs ? 'cursor-not-allowed opacity-60' : ''
                  } ${
                    isActive ? 'bg-[var(--foreground)] text-[var(--background)]' : 'bg-[var(--surface-subtle)] text-[var(--muted)] hover:bg-[var(--border)]'
                  }`}
                >
                  {mName}
                </button>
              )
            })}
          </div>
        )}

        <AssistantVisualBlocks
          blocks={assistantVisualBlocks}
          blockKeyPrefix={exchIdx}
          markdownKeyPrefix={`${userMsgId}-${responseModelId}`}
          isStreaming={isStreaming}
          isTextStreaming={isTextStreaming}
          sourceCitations={sourceCitations}
          suppressTypingIndicator={!loadingPresentation.inlineTextMarker}
          onOpenDraft={onOpenDraft}
          onCreateAutomationDraft={onCreateAutomationDraft}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          generatedUiConnectorActions={generatedUiConnectorActions}
          onGeneratedUiChange={onGeneratedUiChange}
        />


        {!errorMessage ? <ExchangeLoadingState presentation={loadingPresentation} /> : null}

        {errorMessage && !responseInProgress && (
          <div className="flex justify-start">
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
          </div>
        )}

        {interrupted && responseSettled && !errorMessage && (
          <div className="flex justify-start px-1 py-1">
            <p className="text-sm text-[var(--muted)]">Response was interrupted.</p>
          </div>
        )}

        {onContinue && responseSettled && !errorMessage && (
          <div className="flex justify-start px-1 py-1">
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
            >
              <Play size={13} strokeWidth={1.75} />
              Continue
            </button>
          </div>
        )}

        {showFooter && (
          <ExchangeActions
            copyPlainText={copyPlainText}
            isExiting={isExiting}
            onRetry={onRetry}
            retryDisabled={retryDisabled}
            onDeleteTurn={onDeleteTurn}
            onReply={onReply}
            onBranch={onBranch}
            onSaveToKnowledge={onSaveToKnowledge}
            turnIdForActions={turnIdForActions}
            actionsLocked={actionsLocked}
            webSources={webSources}
            onOpenSources={onOpenSources}
            userMsgId={userMsgId}
            isSourcesOpenForThis={isSourcesOpenForThis}
            modelLabel={modelLabel}
            actionVisibility={presentation?.actionVisibility}
            showModelLabel={presentation?.showModelLabel}
          />
        )}

      </div>
    )
}
