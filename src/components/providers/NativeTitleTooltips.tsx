'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Tip = { text: string; x: number; y: number; below: boolean }

const OPEN_DELAY_MS = 450
const EDGE_PX = 8

function adoptTitle(el: HTMLElement) {
  const text = el.getAttribute('title')
  if (text === null) return
  el.removeAttribute('title')
  if (!text.trim()) return
  el.dataset.tooltip = text
  if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text)
}

/**
 * Browsers cannot turn native `title` tooltips off, so this moves every `title` to
 * `data-tooltip` on first hover and shows one shadcn-style tooltip instead.
 */
export function NativeTitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let current: HTMLElement | null = null
    const hide = () => {
      window.clearTimeout(timer)
      current = null
      setTip(null)
    }
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[title], [data-tooltip]')
        : null
      if (target === current) return
      hide()
      if (!target) return
      adoptTitle(target)
      const text = target.dataset.tooltip
      if (!text) return
      current = target
      timer = window.setTimeout(() => {
        if (current !== target || !target.isConnected) return
        const rect = target.getBoundingClientRect()
        const below = rect.top < 40
        setTip({ text, x: rect.left + rect.width / 2, y: below ? rect.bottom + 6 : rect.top - 6, below })
      }, OPEN_DELAY_MS)
    }
    const hideEvents = ['pointerdown', 'keydown', 'scroll', 'blur'] as const
    document.addEventListener('pointerover', onOver, true)
    document.documentElement.addEventListener('pointerleave', hide)
    for (const type of hideEvents) window.addEventListener(type, hide, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver, true)
      document.documentElement.removeEventListener('pointerleave', hide)
      for (const type of hideEvents) window.removeEventListener(type, hide, true)
    }
  }, [])

  if (!tip) return null
  const maxLeft = window.innerWidth - EDGE_PX
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-10100 w-max max-w-[min(calc(100vw-16px),20rem)] rounded-md border border-(--border) bg-(--surface-subtle) px-2 py-1 text-center text-[11px] font-medium leading-snug text-(--muted) shadow-xs animate-in fade-in-0 zoom-in-95"
      style={{
        left: Math.min(Math.max(tip.x, EDGE_PX), maxLeft),
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
      }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
