import { useId, useState } from 'react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { ChevronRight } from 'lucide-react'

/**
 * A failed response reads as one short red line; the raw error, with its
 * diagnostic ID, stays one click away instead of filling the transcript.
 */
export function ExchangeErrorDisclosure({ errorMessage, className = '' }: { errorMessage: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()

  return (
    <div role="alert" className={className}>
      <Button
        variant="ghost"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className={unstyledButton('h-auto w-fit max-w-full rounded-lg p-0 py-1 text-[13px] leading-snug text-(--chat-alert-error-text) hover:bg-transparent hover:text-(--chat-alert-error-text)')}
      >
        <span className="inline-flex items-center gap-1">
          I ran into an error!
          <ChevronRight size={14} strokeWidth={1.75} className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        </span>
      </Button>
      <p id={detailsId} hidden={!expanded} className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-(--chat-alert-error-text)">
        {errorMessage}
      </p>
    </div>
  )
}
