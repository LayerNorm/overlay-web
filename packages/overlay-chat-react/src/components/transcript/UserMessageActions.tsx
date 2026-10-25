import { MessageFooter } from '@overlay/ui/ai'
import { FlashCopyIconButton } from '../DraftReviewModal'
import { messageActionVisibilityClass } from './message-action-visibility'

export function UserMessageActions({
  markdown,
  disabled = false,
}: {
  markdown: string
  disabled?: boolean
}) {
  if (!markdown.trim()) return null

  return (
    <MessageFooter className={`chat-exchange-actions--hover px-0 ${messageActionVisibilityClass()}`}>
      <FlashCopyIconButton
        copyText={markdown}
        disabled={disabled}
        ariaLabel="Copy sent message as Markdown"
      />
    </MessageFooter>
  )
}
