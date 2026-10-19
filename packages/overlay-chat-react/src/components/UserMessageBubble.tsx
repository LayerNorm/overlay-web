'use client'

import { Bubble, BubbleContent } from '@overlay/ui/ai'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

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
    <Bubble variant="muted" align="end" className={className}>
      <BubbleContent
        className={cx(
          'chat-user-bubble select-text',
          tone === 'room-self'
            ? 'room-message-self-bubble bg-(--room-message-self-bg)! text-(--room-message-self-text)'
            : 'text-(--foreground)',
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
            'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent',
            tone === 'room-self' ? 'to-(--room-message-self-bg)' : 'to-(--surface-subtle)',
          )} />
        ) : null}
      </div>
      {collapsible ? (
        <Button variant="ghost"
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className={unstyledButton(`ml-auto mt-1 flex h-6 w-6 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--border) hover:text-(--foreground)`)}
          aria-label={expanded ? 'Collapse message' : 'Expand message'}
          title={expanded ? 'Collapse message' : 'Expand message'}
        >
          <ChevronDown
            size={15}
            strokeWidth={1.75}
            className={cx('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </Button>
      ) : null}
      </BubbleContent>
    </Bubble>
  )
}
