/** Light or dark window appearance for a page theme colour (#rgb, #rrggbb or rgb()). */
export function themeSourceForColor(color: string | null): 'light' | 'dark' | 'system' {
  if (!color) return 'system'
  const value = color.trim()
  let channels: number[] | undefined
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  } else {
    channels = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value)?.slice(1, 4).map(Number)
  }
  if (!channels) return 'system'
  const [r, g, b] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light'
}
