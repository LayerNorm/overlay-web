'use client'

import type { PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@overlay/ui'
import { unstyledButton } from '@overlay/ui/control-reset'
import { TOOLTIP_OPEN_DELAY_MS } from '@overlay/ui/overlays'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'

const HOVER_CLOSE_DELAY_MS = 150

type TipState = 'closed' | 'hover' | 'pinned'

/**
 * A small info icon after a field label. Hovering previews the explanation;
 * clicking, tapping, Enter or Space keeps it open until Escape or an outside click.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<TipState>('closed')
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const schedule = (update: (current: TipState) => TipState, delay: number) => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setState(update), delay)
  }
  const handlePointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    if (state === 'closed') schedule(current => (current === 'closed' ? 'hover' : current), TOOLTIP_OPEN_DELAY_MS)
    else window.clearTimeout(timerRef.current)
  }
  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    schedule(current => (current === 'hover' ? 'closed' : current), HOVER_CLOSE_DELAY_MS)
  }
  const setOpen = (open: boolean) => {
    window.clearTimeout(timerRef.current)
    setState(open ? 'pinned' : 'closed')
  }

  return (
    <Popover open={state !== 'closed'} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={`More info about ${label}`}
          onClick={(event) => {
            event.preventDefault()
            setOpen(state !== 'pinned')
          }}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          className={unstyledButton(cn(
            'inline-flex h-4 w-4 cursor-help items-center justify-center rounded-sm text-(--muted-light) transition-colors',
            'hover:text-(--foreground) aria-expanded:text-(--foreground) focus-visible:outline-1 focus-visible:outline-(--foreground)',
          ))}
        >
          <Info size={13} strokeWidth={1.75} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        onOpenAutoFocus={(event) => {
          if (state === 'hover') event.preventDefault()
        }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className="w-max max-w-[min(calc(100vw-16px),20rem)] rounded-md bg-(--surface-subtle) px-2 py-1 text-[11px] font-medium leading-snug text-(--muted) shadow-xs"
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}

/** Field label with an optional info tip. */
export function FieldLabel({ children, info, htmlFor }: { children: string; info?: string; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-(--foreground)">
      {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
      {info ? <InfoTip text={info} label={children} /> : null}
    </div>
  )
}
