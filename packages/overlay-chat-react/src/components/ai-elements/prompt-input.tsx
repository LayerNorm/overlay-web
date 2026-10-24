'use client'

import type { ComponentProps } from 'react'
import { ArrowUp } from 'lucide-react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { Spinner } from '@overlay/ui/ai'

function join(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** One outlined composer shell for every chat host; hosts own the field and wiring. */
export function PromptInput({ className, dragging = false, ...props }: ComponentProps<'div'> & { dragging?: boolean }) {
  return (
    <div
      data-slot="prompt-input"
      data-dragging={dragging || undefined}
      className={join(
        'overflow-visible rounded-2xl border border-(--border) bg-(--surface-elevated) transition-colors duration-150',
        dragging && 'bg-(--surface-muted)',
        className,
      )}
      {...props}
    />
  )
}

export function PromptInputBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-body" className={join('relative p-2.5 sm:p-3', className)} {...props} />
}

export function PromptInputFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-footer" className={join('mt-2 flex min-h-9 items-center gap-1.5', className)} {...props} />
}

export function PromptInputTools({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-tools"
      className={join(
        'flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-none [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  )
}

export function PromptInputButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      type="button"
      className={unstyledButton(join(
        'flex size-9 shrink-0 items-center justify-center rounded-lg text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground) disabled:opacity-40',
        className,
      ))}
      {...props}
    />
  )
}

export type PromptInputStatus = 'ready' | 'submitted' | 'streaming'

/** ArrowUp when ready, a spinner while the request is submitted, a stop square while streaming. */
export function PromptInputSubmit({
  status = 'ready',
  onStop,
  onClick,
  disabled,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & { status?: PromptInputStatus; onStop?: () => void }) {
  const stopping = status === 'streaming' && Boolean(onStop)
  return (
    <Button
      variant="primary"
      size="icon"
      type="button"
      data-slot="prompt-input-submit"
      data-status={status}
      aria-label={stopping ? 'Stop generating' : 'Send message'}
      disabled={stopping ? false : disabled || status === 'submitted'}
      onClick={stopping ? () => onStop?.() : onClick}
      className={join('shrink-0', className)}
      {...props}
    >
      {stopping ? (
        <span className="size-3.5 rounded-xs bg-current" />
      ) : status === 'submitted' ? (
        <Spinner className="size-4" />
      ) : (
        <ArrowUp size={17} strokeWidth={2} />
      )}
    </Button>
  )
}
