import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Extra classes for the wrapper that positions the chevron. */
  containerClassName?: string
}

const HAS_WIDTH = /(?:^|\s)(?:w-|min-w-|max-w-|basis-|flex-1|size-)/

/**
 * Native select with a drawn chevron. Browsers pin their own arrow to the edge
 * and give it no breathing room, so the control opts out of the platform arrow
 * (`appearance-none`) and reserves an exact gutter for ours: the value never
 * runs under the icon, and every dropdown in the app spaces the same way.
 *
 * A caller that sizes the control keeps that size (the wrapper shrink-wraps to
 * it); one that does not stretches to its grid or flex cell. Either way the
 * chevron sits against the select's own right edge.
 */
export function Select({ className, containerClassName, ...props }: SelectProps) {
  const stretch = !HAS_WIDTH.test(className ?? '')

  return (
    <span
      className={cn(
        'relative inline-flex min-w-0 items-center',
        stretch ? 'w-full' : '',
        containerClassName,
      )}
    >
      <select
        className={cn(
          'h-9 min-w-0 appearance-none truncate rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] py-0 pl-3 pr-9 text-sm text-[var(--foreground)] outline-none transition-colors focus:ring-1 focus:ring-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60',
          stretch ? 'w-full' : '',
          className,
        )}
        {...props}
      />
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute right-2.5 text-[var(--muted)]"
      />
    </span>
  )
}
