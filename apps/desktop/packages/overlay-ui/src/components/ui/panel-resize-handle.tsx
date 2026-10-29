'use client'

import { useRef } from 'react'
import { cn } from '../../utils/cn'

/** The edge names its physical position on the panel, not the panel's side of the screen. */
export function PanelResizeHandle({
  width, onResize, onResizingChange, edge = 'left', minWidth = 260, maxWidth = 720,
  label = 'Resize side panel', className,
}: {
  width: number
  onResize: (width: number) => void
  onResizingChange: (resizing: boolean) => void
  edge?: 'left' | 'right'
  minWidth?: number
  maxWidth?: number
  label?: string
  className?: string
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const direction = edge === 'right' ? 1 : -1
  const resize = (next: number) => onResize(Math.min(maxWidth, Math.max(minWidth, next)))
  const finish = () => {
    drag.current = null
    onResizingChange(false)
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
        edge === 'left' ? 'left-0' : 'right-0', className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        drag.current = { x: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
        onResizingChange(true)
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + direction * (event.clientX - drag.current.x))
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
