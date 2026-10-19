import { MessageFooter } from '@overlay/ui/ai'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { Button } from '@overlay/ui/primitives'
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
  /** Web and knowledge sources for this turn, in the order the panel lists them. */
  sources: readonly WebSourceItem[]
  onOpenSources?: (turnId: string, sources: WebSourceItem[]) => void
  userMsgId: string
  isSourcesOpenForThis: boolean
  modelLabel: string
  actionVisibility?: 'always' | 'hover'
  showModelLabel?: boolean
}

const ACTION_BUTTON_CLASS = 'size-7 text-(--muted) hover:text-(--foreground) disabled:opacity-30'

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
  sources,
  onOpenSources,
  userMsgId,
  isSourcesOpenForThis,
  modelLabel,
  actionVisibility = 'always',
  showModelLabel = true,
}: ExchangeActionsProps) {
  const visibilityClass = actionVisibility === 'hover'
    ? 'chat-exchange-actions--hover opacity-0 transition-opacity group-hover/exchange:opacity-100 focus-within:opacity-100'
    : ''
  return (
    <MessageFooter className={`gap-0.5 px-0 ${visibilityClass}`}>
      <FlashCopyIconButton
        copyText={copyPlainText}
        disabled={copyPlainText.length === 0 || isExiting}
        ariaLabel="Copy response"
      />
      {onRetry && (
        <DelayedTooltip label="Regenerate response">
        <Button variant="ghost"
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          size="icon-sm"
          className={ACTION_BUTTON_CLASS}
          aria-label="Regenerate response"
        >
          <RotateCw strokeWidth={1.75} />
        </Button>
        </DelayedTooltip>
      )}
      <DelayedTooltip label="Delete this turn from history">
        <Button variant="ghost"
        type="button"
        onClick={onDeleteTurn}
        disabled={!turnIdForActions || actionsLocked || isExiting}
        size="icon-sm"
          className={ACTION_BUTTON_CLASS}
        aria-label="Delete this turn from history"
      >
        <Trash2 strokeWidth={1.75} />
      </Button>
        </DelayedTooltip>
      <DelayedTooltip label="Reply">
        <Button variant="ghost"
        type="button"
        onClick={onReply}
        disabled={isExiting}
        size="icon-sm"
          className={ACTION_BUTTON_CLASS}
        aria-label="Reply"
      >
        <Reply strokeWidth={1.75} />
      </Button>
        </DelayedTooltip>
      {onBranch ? (
        <DelayedTooltip label="Branch chat from here">
        <Button variant="ghost"
          type="button"
          onClick={onBranch}
          disabled={!turnIdForActions || actionsLocked || isExiting}
          size="icon-sm"
          className={ACTION_BUTTON_CLASS}
          aria-label="Branch chat from here"
        >
          <GitBranch strokeWidth={1.75} />
        </Button>
        </DelayedTooltip>
      ) : null}
      {sources.length > 0 && onOpenSources ? (
        <Button variant="ghost"
          type="button"
          onClick={() => onOpenSources(turnIdForActions ?? userMsgId, [...sources])}
          disabled={isExiting}
          size="sm"
          className={`ml-0.5 gap-1 px-2 hover:text-(--foreground) disabled:opacity-30 ${
            isSourcesOpenForThis ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'
          }`}
          aria-label="Open sources"
          aria-pressed={isSourcesOpenForThis}
        >
          <BookOpen size={14} strokeWidth={1.75} className="shrink-0" />
          <span className="text-[11px] font-medium">Sources</span>
        </Button>
      ) : null}
      {showModelLabel ? (
        <span className="ml-2 min-w-0 text-left text-[11px] text-(--muted-light)">
          {modelLabel}
        </span>
      ) : null}
    </MessageFooter>
  )
}
