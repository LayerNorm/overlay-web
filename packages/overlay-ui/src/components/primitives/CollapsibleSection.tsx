'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface CollapsibleSectionProps {
  /** Section heading; rendered in the same small uppercase style as static menu labels. */
  label: string
  children: ReactNode
  /** Open on first render. The section stays uncontrolled afterwards. */
  defaultOpen?: boolean
  /** Trailing summary shown next to the label while the section is collapsed. */
  collapsedSummary?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
}

/**
 * Disclosure for a labelled group of menu rows. Long menus (workspaces, usage,
 * apps) stay scannable when each group can be folded away.
 */
export function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
  collapsedSummary,
  className,
  headerClassName,
  contentClassName,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)] transition-colors hover:text-[var(--foreground)]',
          headerClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!open && collapsedSummary ? (
          <span className="max-w-[9rem] truncate normal-case tracking-normal text-[var(--muted-light)]">{collapsedSummary}</span>
        ) : null}
        <ChevronDown
          size={12}
          className={cn('shrink-0 transition-transform', open ? 'rotate-180' : '')}
        />
      </button>
      {open ? (
        <div id={contentId} className={cn('pb-1', contentClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
