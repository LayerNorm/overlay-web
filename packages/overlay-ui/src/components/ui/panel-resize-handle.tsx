'use client'

import { useEffect, useRef } from 'react'
import { cn } from '../../utils/cn'

/**
 * The edge names its physical position on the panel, not the panel's side of the screen.
 *
 * Dragging updates at most once per animation frame. With `livePreview`, the drag
 * writes the width straight onto the panel (the handle's parent element) and calls
 * `onResize` once on release, so the panel's React tree does not re-render on every
 * frame of the drag. Only use it when the parent's own width is all that has to change.
 */
export function PanelResizeHandle({
  width, onResize, onResizingChange, edge = 'left', minWidth = 260, maxWidth = 720,
  label = 'Resize side panel', placement = 'inset', livePreview = false, className,
}: {
  width: number
  onResize: (width: number) => void
  onResizingChange: (resizing: boolean) => void
  edge?: 'left' | 'right'
  placement?: 'inset' | 'outside'
  minWidth?: number
  maxWidth?: number
  label?: string
  livePreview?: boolean
  className?: string
}) {
  const drag = useRef<{ x: number; width: number; next: number; panel: HTMLElement | null } | null>(null)
  const frame = useRef<number | null>(null)
  const direction = edge === 'right' ? 1 : -1
  const clamp = (next: number) => Math.min(maxWidth, Math.max(minWidth, next))
  const resize = (next: number) => onResize(clamp(next))
  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  useEffect(() => cancelFrame, [])
  const finish = () => {
    const active = drag.current
    if (!active) return
    drag.current = null
    cancelFrame()
    if (active.next !== active.width) onResize(active.next)
    onResizingChange(false)
    // React applies the committed width synchronously for this discrete event; drop
    // the preview width on the next frame so the panel never flashes back.
    if (active.panel) {
      const panel = active.panel
      requestAnimationFrame(() => { panel.style.width = '' })
    }
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      className={cn(
        'group/resize absolute inset-y-0 z-40 w-2 cursor-col-resize touch-none select-none outline-none',
        placement === 'outside'
          ? edge === 'left' ? 'right-full' : 'left-full'
          : edge === 'left' ? 'left-0' : 'right-0',
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        drag.current = {
          x: event.clientX,
          width,
          next: width,
          panel: livePreview ? event.currentTarget.parentElement : null,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        onResizingChange(true)
      }}
      onPointerMove={(event) => {
        const active = drag.current
        if (!active) return
        active.next = clamp(active.width + direction * (event.clientX - active.x))
        if (frame.current !== null) return
        frame.current = requestAnimationFrame(() => {
          frame.current = null
          const current = drag.current
          if (!current) return
          if (current.panel) current.panel.style.width = `${current.next}px`
          else onResize(current.next)
        })
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        finish()
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Home') resize(minWidth)
        else if (event.key === 'End') resize(maxWidth)
        else resize(width + (event.key === 'ArrowRight' ? 16 : -16) * direction)
      }}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-(--muted-light) group-focus-visible/resize:bg-(--muted-light)" />
    </div>
  )
}
