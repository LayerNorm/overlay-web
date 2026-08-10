"use client"

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'

export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function MenuSurface({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg',
        className,
      )}
      {...props}
    />
  )
})

MenuSurface.displayName = 'MenuSurface'

type FloatingMenuPosition = {
  left: number
  top: number
}

/**
 * A dismissible, viewport-positioned menu. Rendering at the document root
 * prevents a menu from being clipped by the sidebar, card, or dialog that
 * owns its trigger.
 */
export function FloatingMenu({
  anchorRef,
  children,
  className,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  ...props
}: {
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return

      const anchorRect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const gap = 6
      const padding = 8
      const roomAbove = anchorRect.top - padding
      const roomBelow = window.innerHeight - anchorRect.bottom - padding
      const preferredHeight = menuRect.height || 1
      const opensUpward = side === 'top'
        ? roomAbove >= preferredHeight || roomAbove >= roomBelow
        : roomBelow < preferredHeight && roomAbove > roomBelow
      const top = opensUpward
        ? Math.max(padding, anchorRect.top - preferredHeight - gap)
        : Math.min(window.innerHeight - preferredHeight - padding, anchorRect.bottom + gap)
      const desiredLeft = align === 'end'
        ? anchorRect.right - menuRect.width
        : anchorRect.left
      const left = Math.min(
        Math.max(padding, desiredLeft),
        Math.max(padding, window.innerWidth - menuRect.width - padding),
      )
      setPosition({ left, top })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [align, anchorRef, open, side])

  useEffect(() => {
    if (!open) return
    function dismissWhenOutside(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onOpenChange(false)
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', dismissWhenOutside, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissWhenOutside, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [anchorRef, onOpenChange, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <MenuSurface
      ref={menuRef}
      className={cn('overlay-pop-in fixed z-[10090]', className)}
      style={{
        left: position?.left ?? -10_000,
        top: position?.top ?? -10_000,
        visibility: position ? 'visible' : 'hidden',
      }}
      {...props}
    >
      {children}
    </MenuSurface>,
    document.body,
  )
}

export function MenuItem({
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:text-[var(--muted-light)]',
        className,
      )}
      {...props}
    />
  )
}
