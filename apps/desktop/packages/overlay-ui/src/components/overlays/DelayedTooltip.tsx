'use client'

import type { ReactNode } from 'react'
import { useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 450
const GAP_PX = 6

/**
 * Tooltip with delayed show and immediate hide when the cursor leaves the wrapper.
 * Rendered in a portal with fixed positioning so parent overflow/sidebars cannot clip it.
 */
export function DelayedTooltip({
  label,
  children,
  className = '',
  side = 'top',
}: {
  label: string
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left'
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number | null>(null)

  function supportsHoverTooltip() {
    return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  }

  function show() {
    if (!supportsHoverTooltip()) return
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
  }

  function hide() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setOpen(false)
    setCoords(null)
  }

  useLayoutEffect(() => {
    if (!open) return

    function updatePosition() {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const estimatedWidth = Math.min(
        window.innerWidth - 16,
        Math.min(320, Math.max(96, label.length * 6.5)),
      )
      const centeredLeft = (value: number) =>
        Math.min(
          window.innerWidth - 8 - estimatedWidth / 2,
          Math.max(8 + estimatedWidth / 2, value),
        )
      if (side === 'bottom') {
        setCoords({
          top: r.bottom + GAP_PX,
          left: centeredLeft(r.left + r.width / 2),
          transform: 'translateX(-50%)',
        })
        return
      }
      if (side === 'left') {
        setCoords({
          top: r.top + r.height / 2,
          left: r.left - GAP_PX,
          transform: 'translate(-100%, -50%)',
        })
        return
      }
      setCoords({
        top: r.top - GAP_PX,
        left: centeredLeft(r.left + r.width / 2),
        transform: 'translate(-50%, -100%)',
      })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, side, label])

  const tooltip =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: coords.transform,
              zIndex: 400,
              width: 'max-content',
              maxWidth: 'min(calc(100vw - 16px), 20rem)',
            }}
            className="pointer-events-none rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1 text-center text-[11px] font-medium leading-snug text-[var(--muted)] shadow-sm"
          >
            {label}
          </span>,
          document.body,
        )
      : null

  return (
    <span
      ref={anchorRef}
      className={className ? `relative ${className}` : 'relative inline-flex'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {tooltip}
    </span>
  )
}
