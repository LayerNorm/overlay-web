'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { Creature, CREATURE_SHAPES } from '@/components/orb/Creature'
import { AVATAR_COLORS } from '../lib/agent-editor-utils'
import { AvatarColorPicker } from './AvatarColorPicker'

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
  // Whether the custom color editor is showing under the swatches. 
  const isCustomColor = !(AVATAR_COLORS as readonly string[]).includes(color.toLowerCase())
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setCustomOpen(isCustomColor)
        setOpen(next)
      }}
    >
      <div className="flex justify-center">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            aria-label="Edit avatar"
            className={unstyledButton(`group relative rounded-2xl outline-hidden focus-visible:ring-1 focus-visible:ring-(--foreground)`)}
          >
            <Creature shape={shape} color={color} size={size} label="Agent avatar" />
            <span className="absolute inset-[14%] flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Pencil size={18} strokeWidth={1.75} />
            </span>
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent align={align} aria-label="Avatar" className="w-[296px] rounded-xl p-3.5">
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Avatar shape">
          {CREATURE_SHAPES.map((option) => (
            <Button
              variant="ghost"
              key={option}
              type="button"
              role="radio"
              aria-checked={shape === option}
              aria-label={`${option} shape`}
              onClick={() => onShapeChange(option)}
              className={unstyledButton(`flex aspect-square items-center justify-center rounded-xl border transition-colors ${shape === option ? 'border-(--border) bg-(--surface-subtle)' : 'border-transparent hover:bg-(--surface-subtle)'}`)}
            >
              <Creature shape={option} color={color} size={40} animated={false} label="" />
            </Button>
          ))}
        </div>
        <div
          className="mt-3 grid grid-cols-6 justify-items-center gap-2 border-t border-(--border) pt-3"
          role="radiogroup"
          aria-label="Avatar color"
        >
          {AVATAR_COLORS.map((option) => (
            <Button
              variant="ghost"
              key={option}
              type="button"
              role="radio"
              aria-checked={color === option}
              aria-label={`Color ${option}`}
              onClick={() => onColorChange(option)}
              style={{ backgroundColor: option }}
              className={unstyledButton(`h-[26px] w-[26px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] ${color === option ? 'ring-[1.5px] ring-(--muted) ring-offset-2 ring-offset-(--surface-elevated)' : ''}`)}
            />
          ))}
          <Button
            variant="ghost"
            type="button"
            role="radio"
            aria-checked={isCustomColor}
            aria-label="Custom color"
            title="Custom color"
            onClick={() => setCustomOpen((current) => !current)}
            style={isCustomColor
              ? { backgroundColor: color }
              : { backgroundImage: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            className={unstyledButton(`h-[26px] w-[26px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] ${isCustomColor ? 'ring-[1.5px] ring-(--muted) ring-offset-2 ring-offset-(--surface-elevated)' : ''}`)}
          />
        </div>
        {customOpen ? <AvatarColorPicker color={color} onChange={onColorChange} /> : null}
      </PopoverContent>
    </Popover>
  )
}
