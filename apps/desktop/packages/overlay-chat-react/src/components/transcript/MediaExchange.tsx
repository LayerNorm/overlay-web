/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { Reply, RotateCw, Trash2 } from 'lucide-react'
import type { GenerationResult } from '@overlay/chat-core'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import { FlashCopyIconButton } from '../DraftReviewModal'
import { MediaSlotOutput } from '../MediaSlotOutput'
import { UserMessageBubble } from '../UserMessageBubble'

const TRANSPARENT_IMAGE_STYLE = { color: 'transparent' } as const

export interface MediaExchangeProps {
  exchangeIndex: number
  turnId: string | null
  kind: 'image' | 'video'
  promptText: string
  userImages: readonly { url: string; name: string }[]
  replyThread: { replyToTurnId: string; replySnippet: string } | null
  results: readonly GenerationResult[]
  modelIds: readonly string[]
  modelLabel: string
  isExiting?: boolean
  getModelDisplayName: (modelId: string) => string
  onJumpToReply: (turnId: string) => void
  onDeleteTurn: (turnId: string) => void | Promise<void>
  onReply: (prompt: string, kind: 'image' | 'video', turnId: string | null) => void
  onRetry?: () => void
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  actionVisibility?: 'always' | 'hover'
}

export function MediaExchange({
  exchangeIndex,
  turnId,
  kind,
  promptText,
  userImages,
  replyThread,
  results,
  modelIds,
  modelLabel,
  isExiting = false,
  getModelDisplayName,
  onJumpToReply,
  onDeleteTurn,
  onReply,
  onRetry,
  onOpenAttachmentPreview,
  actionVisibility = 'hover',
}: MediaExchangeProps) {
  const isMulti = modelIds.length > 1
  const stillGenerating = results.some((result) => !result || result.status === 'generating')

  return (
    <div
      className={`group/exchange flex flex-col gap-3 message-appear transition-all duration-300 ease-out ${
        isExiting ? 'pointer-events-none -translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
      }`}
      data-exchange-idx={exchangeIndex}
      data-exchange-turn={turnId ?? undefined}
    >
      {replyThread && (
        <MediaReplyAnchor
          snippet={replyThread.replySnippet}
          onClick={() => onJumpToReply(replyThread.replyToTurnId)}
        />
      )}
      <MediaUserPrompt
        images={userImages}
        text={promptText}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
      />
      <div
        className={`min-w-0 w-full ${isMulti ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex flex-col gap-1.5 items-start'} ${
          stillGenerating && !isMulti ? (kind === 'video' ? 'min-h-40' : 'min-h-52') : ''
        }`}
      >
        {modelIds.map((modelId, index) => (
          <div
            key={`${modelId}-${index}`}
            className={`min-w-0 ${isMulti ? 'w-full' : 'flex flex-col gap-1.5 self-start'}`}
          >
            <MediaSlotOutput
              genType={kind}
              isMulti={isMulti}
              modelName={getModelDisplayName(modelId)}
              result={results[index]}
            />
          </div>
        ))}
      </div>
      {!stillGenerating && (
        <div className={`${actionVisibility === 'always' ? 'message-appear' : ''} flex items-center gap-1 px-1 pt-0.5 ${
          actionVisibility === 'hover'
            ? 'chat-exchange-actions--hover opacity-0 transition-opacity group-hover/exchange:opacity-100 focus-within:opacity-100'
            : ''
        }`}>
          <FlashCopyIconButton
            copyText={promptText}
            disabled={!promptText || isExiting}
            ariaLabel="Copy prompt"
          />
          <TranscriptIconAction
            label="Delete this turn from history"
            disabled={!turnId || isExiting}
            onClick={() => turnId && onDeleteTurn(turnId)}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </TranscriptIconAction>
          <TranscriptIconAction
            label="Reply"
            disabled={isExiting}
            onClick={() => onReply(promptText, kind, turnId)}
          >
            <Reply size={14} strokeWidth={1.75} />
          </TranscriptIconAction>
          {results.some((result) => result.status === 'failed') && onRetry ? (
            <TranscriptIconAction label="Retry generation" disabled={isExiting} onClick={onRetry}>
              <RotateCw size={14} strokeWidth={1.75} />
            </TranscriptIconAction>
          ) : null}
          <span className="ml-2 shrink-0 text-left text-[11px] text-[var(--muted-light)]">
            {modelLabel}
          </span>
        </div>
      )}
    </div>
  )
}

function MediaReplyAnchor({ snippet, onClick }: { snippet: string; onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        className="max-w-[75%] rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-left text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
      >
        <span className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
          <Reply size={12} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
          Replying to
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[var(--muted)]">{snippet}</span>
      </button>
    </div>
  )
}

function MediaUserPrompt({
  images,
  text,
  onOpenAttachmentPreview,
}: {
  images: readonly { url: string; name: string }[]
  text: string
  onOpenAttachmentPreview: MediaExchangeProps['onOpenAttachmentPreview']
}) {
  return (
    <div className="flex justify-end">
      <UserMessageBubble className="max-w-[min(92%,36rem)] sm:max-w-[75%]">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((image, imageIndex) => (
              <button
                key={`${image.url}-${imageIndex}`}
                type="button"
                onClick={() => onOpenAttachmentPreview({
                  name: image.name,
                  content: image.url,
                  url: image.url,
                })}
                className="rounded-lg outline-none transition-transform hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-[var(--foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-subtle)]"
                title="Open attachment"
              >
                <img
                  src={image.url}
                  alt={image.name}
                  width={144}
                  height={144}
                  loading="lazy"
                  decoding="async"
                  style={TRANSPARENT_IMAGE_STYLE}
                  className="h-auto max-h-36 w-auto rounded-lg object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {text}
      </UserMessageBubble>
    </div>
  )
}

function TranscriptIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30"
      aria-label={label}
    >
      {children}
    </button>
  )
}
