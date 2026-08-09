import { BookOpen, GitBranch, Reply, RotateCw, Trash2 } from 'lucide-react'
import type { WebSourceItem } from '../../lib/web-sources'
import { FlashCopyIconButton } from '../DraftReviewModal'

export interface ExchangeActionsProps {
  copyPlainText: string
  isExiting: boolean
  onRetry?: () => void
  retryDisabled: boolean
  onDeleteTurn: () => void
  onReply: () => void
  onBranch?: () => void
  turnIdForActions: string | null
  actionsLocked: boolean
  webSources: readonly WebSourceItem[]
  onOpenSources?: (turnId: string, sources: WebSourceItem[]) => void
  userMsgId: string
  isSourcesOpenForThis: boolean
  modelLabel: string
  actionVisibility?: 'always' | 'hover'
  showModelLabel?: boolean
}

export function ExchangeActions({
  copyPlainText,
  isExiting,
  onRetry,
  retryDisabled,
  onDeleteTurn,
  onReply,
  onBranch,
  turnIdForActions,
  actionsLocked,
  webSources,
  onOpenSources,
  userMsgId,
  isSourcesOpenForThis,
  modelLabel,
  actionVisibility = 'hover',
  showModelLabel = true,
}: ExchangeActionsProps) {
  const visibilityClass = actionVisibility === 'hover'
    ? 'chat-exchange-actions--hover opacity-0 transition-opacity group-hover/exchange:opacity-100 focus-within:opacity-100'
    : ''
  const entranceClass = actionVisibility === 'always' ? 'message-appear' : ''

  return (
    <div className={`${entranceClass} flex items-center gap-1 px-1 pt-0.5 ${visibilityClass}`}>
      <FlashCopyIconButton
        copyText={copyPlainText}
        disabled={copyPlainText.length === 0 || isExiting}
        ariaLabel="Copy response"
      />
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Regenerate response"
          title="Regenerate response"
        >
          <RotateCw size={14} strokeWidth={1.75} />
        </button>
      )}
      <button
        type="button"
        onClick={onDeleteTurn}
        disabled={!turnIdForActions || actionsLocked || isExiting}
        className="rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Delete this turn from history"
      >
        <Trash2 size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onReply}
        disabled={isExiting}
        className="rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Reply"
      >
        <Reply size={14} strokeWidth={1.75} />
      </button>
      {onBranch ? (
        <button
          type="button"
          onClick={onBranch}
          disabled={!turnIdForActions || actionsLocked || isExiting}
          className="rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Branch chat from here"
          title="Branch chat from here"
        >
          <GitBranch size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {webSources.length > 0 && onOpenSources ? (
        <button
          type="button"
          onClick={() => onOpenSources(turnIdForActions ?? userMsgId, [...webSources])}
          disabled={isExiting}
          className={`ml-0.5 inline-flex items-center gap-1 rounded-md px-2 py-1.5 transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 ${
            isSourcesOpenForThis
              ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
              : 'text-[var(--muted)]'
          }`}
          aria-label="Open sources"
          aria-pressed={isSourcesOpenForThis}
        >
          <BookOpen size={14} strokeWidth={1.75} className="shrink-0" />
          <span className="text-[11px] font-medium">Sources</span>
        </button>
      ) : null}
      {showModelLabel ? (
        <span className="ml-2 min-w-0 text-left text-[11px] text-[var(--muted-light)]">
          {modelLabel}
        </span>
      ) : null}
    </div>
  )
}
