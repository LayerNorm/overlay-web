'use client'

import type { ReactNode } from 'react'
import { Fragment, isValidElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

const HOVER_QUERY = '(hover: hover) and (pointer: fine)'

function subscribeHoverTooltip(onChange: () => void) {
  const query = window.matchMedia(HOVER_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function supportsHoverTooltip() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia(HOVER_QUERY).matches
  )
}

/**
 * Tooltip with delayed show, rendered in a Radix portal so parent
 * overflow/sidebars cannot clip it. API kept identical to the previous
 * hand-rolled implementation.
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
  const [descriptionId, setDescriptionId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [focusedElement, setFocusedElement] = useState<HTMLElement | null>(null)
  const focusedElementRef = useRef<HTMLElement | null>(null)
  const pointerInsideRef = useRef(false)
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (
      nextOpen
      && !pointerInsideRef.current
      && focusedElementRef.current
      && !focusedElementRef.current.matches(':focus-visible')
    ) return
    setOpen(nextOpen)
  }, [])
  const captureTooltipContent = useCallback((element: HTMLDivElement | null) => {
    setDescriptionId(element?.id ?? null)
  }, [])
  const subscribe = useCallback((onChange: () => void) => subscribeHoverTooltip(() => {
    if (!supportsHoverTooltip()) setOpen(false)
    onChange()
  }), [])
  // Server snapshot is always `false`, so SSR and the first client render
  // agree (avoids hydration mismatch); the real check runs after mount.
  const hoverable = useSyncExternalStore(
    subscribe,
    () => supportsHoverTooltip(),
    () => false,
  )

  // Container/fragment children can hold several controls. Describe the actual
  // focused control while its tooltip is open, without adding a wrapper Tab stop.
  useEffect(() => {
    if (!hoverable || !open || !focusedElement) return
    if (!descriptionId || focusedElement.getAttribute('aria-describedby')?.split(/\s+/).includes(descriptionId)) return
    const descriptions = focusedElement.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []
    focusedElement.setAttribute('aria-describedby', [...descriptions, descriptionId].join(' '))
    return () => {
      const remaining = focusedElement.getAttribute('aria-describedby')?.split(/\s+/).filter(id => id && id !== descriptionId) ?? []
      if (remaining.length) focusedElement.setAttribute('aria-describedby', remaining.join(' '))
      else focusedElement.removeAttribute('aria-describedby')
    }
  }, [hoverable, open, focusedElement, descriptionId])

  if (!hoverable) {
    return <span className={cn('relative inline-flex', className)}>{children}</span>
  }
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <span
          className={cn('relative inline-flex', className)}
          onPointerEnter={() => {
            pointerInsideRef.current = true
          }}
          onPointerLeave={() => {
            pointerInsideRef.current = false
          }}
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLElement) {
              focusedElementRef.current = event.target
              setFocusedElement(event.target)
            }
          }}
          onBlurCapture={() => {
            focusedElementRef.current = null
            setFocusedElement(null)
          }}
        >
          <TooltipTrigger asChild>
            {isValidElement(children) && children.type !== Fragment ? children : <span>{children}</span>}
          </TooltipTrigger>
        </span>
        <TooltipContent ref={captureTooltipContent} side={side} className="pointer-events-none">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
