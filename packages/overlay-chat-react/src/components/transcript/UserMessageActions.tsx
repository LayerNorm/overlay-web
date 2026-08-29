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
    <div className="flex items-center justify-end pr-1 opacity-0 transition-opacity group-hover/exchange:opacity-100 focus-within:opacity-100">
      <FlashCopyIconButton
        copyText={markdown}
        disabled={disabled}
        ariaLabel="Copy sent message as Markdown"
      />
    </div>
  )
}
