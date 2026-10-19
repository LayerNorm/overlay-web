import { MessageFooter } from '@overlay/ui/ai'
import { FlashCopyIconButton } from '../DraftReviewModal'

export function UserMessageActions({
  markdown,
  disabled = false,
}: {
  markdown: string
  disabled?: boolean
}) {
  if (!markdown.trim()) return null

  return (
    <MessageFooter className="px-0">
      <FlashCopyIconButton
        copyText={markdown}
        disabled={disabled}
        ariaLabel="Copy sent message as Markdown"
      />
    </MessageFooter>
  )
}
