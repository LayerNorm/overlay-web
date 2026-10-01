'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { Creature, CREATURE_SHAPES } from '@/components/orb/Creature'
import { AVATAR_COLORS } from '../lib/agent-editor-utils'

/**
 * The agent's creature, editable in place: hover shows a pencil, click opens a
 * popover with every body shape (previewed in the current color) and the color
 * swatches. Outside click and Escape close it.
 */
export function AgentAvatarPicker({ shape, color, onShapeChange, onColorChange, size = 72, align = 'center' }: {
  shape: WorkspaceAgentCreatureShape
  color: string
  onShapeChange(shape: WorkspaceAgentCreatureShape): void
  onColorChange(color: string): void
  size?: number
  /** Where the popover sits relative to the avatar. */
  align?: 'center' | 'start'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Close the popover without also closing the dialog around it.
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex justify-center">
      <button
        type="button"
        aria-label="Edit avatar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="group relative rounded-2xl outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)]"
      >
        <Creature shape={shape} color={color} size={size} label="Agent avatar" />
        <span className="absolute inset-[14%] flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Pencil size={18} strokeWidth={1.75} />
        </span>
      </button>
      {open ? (
        // Centred by a flex wrapper: the pop-in animation owns `transform`.
        <div className={`absolute top-full z-30 mt-1.5 flex ${align === 'center' ? 'inset-x-0 justify-center' : 'left-0'}`}>
          <div
            role="dialog"
            aria-label="Avatar"
            className="overlay-pop-in w-[296px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5 shadow-xl"
          >
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Avatar shape">
              {CREATURE_SHAPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={shape === option}
                  aria-label={`${option} shape`}
                  onClick={() => onShapeChange(option)}
                  className={`flex aspect-square items-center justify-center rounded-xl border transition-colors ${shape === option ? 'border-[var(--border)] bg-[var(--surface-subtle)]' : 'border-transparent hover:bg-[var(--surface-subtle)]'}`}
                >
                  <Creature shape={option} color={color} size={40} animated={false} label="" />
                </button>
              ))}
            </div>
            <div
              className="mt-3 grid grid-cols-6 justify-items-center gap-2 border-t border-[var(--border)] pt-3"
              role="radiogroup"
              aria-label="Avatar color"
            >
              {AVATAR_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={color === option}
                  aria-label={`Color ${option}`}
                  onClick={() => onColorChange(option)}
                  style={{ backgroundColor: option }}
                  className={`h-[26px] w-[26px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] ${color === option ? 'ring-[1.5px] ring-[var(--muted)] ring-offset-2 ring-offset-[var(--surface-elevated)]' : ''}`}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
