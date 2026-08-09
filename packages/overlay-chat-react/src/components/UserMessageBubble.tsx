'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const COLLAPSED_LINE_COUNT = 10

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function UserMessageBubble({
  children,
  className,
  contentClassName,
  tone = 'default',
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
  tone?: 'default' | 'room-self'
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)
  const [collapsedHeight, setCollapsedHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const contentEl = el

    function measure() {
      const styles = window.getComputedStyle(contentEl)
      const lineHeight = Number.parseFloat(styles.lineHeight)
      const maxHeight = Math.ceil((Number.isFinite(lineHeight) ? lineHeight : 22) * COLLAPSED_LINE_COUNT)
      setCollapsedHeight(maxHeight)
      setCollapsible(contentEl.scrollHeight > maxHeight + 1)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [children])

  const clamped = collapsible && !expanded

  return (
    <div
      className={cx(
        'chat-user-bubble min-w-0 break-words select-text rounded-2xl border px-3 py-2.5 text-sm leading-relaxed sm:px-4',
        tone === 'room-self'
          ? 'room-message-self-bubble rounded-br-sm border-transparent bg-[var(--room-message-self-bg)] text-[var(--room-message-self-text)]'
          : 'rounded-br-sm border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]',
        className,
      )}
    >
      <div className="relative">
        <div
          ref={contentRef}
          className={cx(
            'min-w-0 whitespace-pre-wrap',
            clamped && 'overflow-hidden',
            contentClassName,
          )}
          style={clamped && collapsedHeight ? { maxHeight: collapsedHeight } : undefined}
        >
          {children}
        </div>
        {clamped ? (
          <div className={cx(
            'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent',
            tone === 'room-self' ? 'to-[var(--room-message-self-bg)]' : 'to-[var(--surface-subtle)]',
          )} />
        ) : null}
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="ml-auto mt-1 flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
          aria-label={expanded ? 'Collapse message' : 'Expand message'}
          title={expanded ? 'Collapse message' : 'Expand message'}
        >
          <ChevronDown
            size={15}
            strokeWidth={1.75}
            className={cx('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      ) : null}
    </div>
  )
}
