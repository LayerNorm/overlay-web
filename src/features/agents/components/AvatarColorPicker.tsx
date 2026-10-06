'use client'

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../lib/color-utils'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Drag (or tap) inside a box and get the pointer's position as 0..1 on both axes. */
function dragHandlers(onMove: (x: number, y: number) => void) {
  const report = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onMove(clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height))
  }
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      report(event)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) report(event)
    },
  }
}

const STEP = 0.02

/**
 * A small color picker: a square to pick saturation and brightness, a strip to pick the hue, and a hex field. No opacity.
 * Built here rather than taken off the shelf: it is about a hundred lines, and an agent's color is always opaque.
 */
export function AvatarColorPicker({ color, onChange }: { color: string; onChange(color: string): void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color))
  const [text, setText] = useState(color)
  // Following the color from outside (a swatch was clicked) without losing the hue while dragging at the grey edges,
  // where hex alone cannot say which hue the person was on.
  const [followed, setFollowed] = useState(color)
  const [emitted, setEmitted] = useState(color)
  if (color !== followed) {
    setFollowed(color)
    setText(color)
    if (color !== emitted) setHsv(hexToHsv(color))
  }

  const commit = (next: Hsv) => {
    const hex = hsvToHex(next)
    setHsv(next)
    setEmitted(hex)
    setText(hex)
    onChange(hex)
  }

  const areaKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const move: Partial<Record<string, Partial<Hsv>>> = {
      ArrowLeft: { s: hsv.s - STEP }, ArrowRight: { s: hsv.s + STEP },
      ArrowUp: { v: hsv.v + STEP }, ArrowDown: { v: hsv.v - STEP },
    }
    const change = move[event.key]
    if (!change) return
    event.preventDefault()
    commit({ ...hsv, s: clamp01(change.s ?? hsv.s), v: clamp01(change.v ?? hsv.v) })
  }

  const hueKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 6 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -6 : 0
    if (!delta) return
    event.preventDefault()
    commit({ ...hsv, h: (hsv.h + delta + 360) % 360 })
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        aria-valuenow={Math.round(hsv.s * 100)}
        onKeyDown={areaKeys}
        {...dragHandlers((x, y) => commit({ ...hsv, s: x, v: 1 - y }))}
        className="relative h-[120px] w-full cursor-crosshair touch-none rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)]"
        style={{ backgroundColor: hueColor, backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)' }}
      >
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex items-center gap-3">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onKeyDown={hueKeys}
          {...dragHandlers((x) => commit({ ...hsv, h: Math.min(359.99, x * 360) }))}
          className="relative h-3 flex-1 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)]"
          style={{ backgroundImage: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
            style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
          />
        </div>
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            const hex = normalizeHex(event.target.value)
            if (hex) {
              setHsv(hexToHsv(hex))
              setEmitted(hex)
              onChange(hex)
            }
          }}
          onBlur={() => setText(color)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Hex color"
          className="h-8 w-[5.5rem] rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-center font-mono text-xs uppercase text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        />
      </div>
    </div>
  )
}
