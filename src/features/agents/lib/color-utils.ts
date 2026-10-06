/** Colors for the avatar's custom color picker: hex <-> HSV, and tolerant parsing of what a person types. */

export interface Hsv {
  /** Degrees, 0 up to 360. */
  h: number
  /** Saturation, 0 to 1. */
  s: number
  /** Value (brightness), 0 to 1. */
  v: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** `#abc`, `abc`, `#aabbcc`, or `AABBCC` become `#aabbcc`; anything else is null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map((char) => char + char).join('')}`.toLowerCase()
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}`.toLowerCase() : null
}

export function hexToHsv(hex: string): Hsv {
  const normalized = normalizeHex(hex) ?? '#000000'
  const r = parseInt(normalized.slice(1, 3), 16) / 255
  const g = parseInt(normalized.slice(3, 5), 16) / 255
  const b = parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 1)
  const val = clamp(v, 0, 1)
  const chroma = val * sat
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - chroma
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x]
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}
