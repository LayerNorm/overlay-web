'use client'

import type { ComponentProps } from 'react'
import { Button } from '@overlay/ui/primitives'
import { TraceMark } from '../exchange/tool-rail'

function join(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Tool approval card: flat fill, mark, title, requests, Approve / Deny. */
export function Confirmation({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="confirmation"
      role="group"
      className={join('flex items-start gap-2.5 rounded-2xl bg-(--surface-elevated) px-4 py-3', className)}
      {...props}
    />
  )
}

export function ConfirmationIcon({ running = false }: { running?: boolean }) {
  return (
    <span className="mt-0.5 flex shrink-0">
      <TraceMark running={running} />
    </span>
  )
}

export function ConfirmationBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="confirmation-body" className={join('min-w-0 flex-1', className)} {...props} />
}

export function ConfirmationTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="confirmation-title" className={join('text-sm font-medium text-(--foreground)', className)} {...props} />
}

export function ConfirmationRequest({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="confirmation-request" className={join('mt-0.5 text-xs text-(--muted)', className)} {...props} />
}

export function ConfirmationActions({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="confirmation-actions" className={join('mt-2.5 flex items-center gap-1.5', className)} {...props} />
}

export function ConfirmationAction({
  tone = 'secondary',
  className,
  ...props
}: ComponentProps<typeof Button> & { tone?: 'primary' | 'secondary' }) {
  return (
    <Button
      variant={tone === 'primary' ? 'primary' : 'ghost'}
      type="button"
      className={join(
        'h-7 rounded-lg px-3 text-xs font-medium disabled:opacity-50',
        tone === 'primary'
          ? 'bg-(--foreground) text-(--background) hover:opacity-85'
          : 'bg-(--surface-muted) text-(--foreground) hover:bg-(--surface-subtle)',
        className,
      )}
      {...props}
    />
  )
}
