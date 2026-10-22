export function tourPosition(target: { left: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }, card: { width: number; height: number }, mobile: boolean) {
  const gap = 12
  const width = Math.min(card.width, viewport.width - gap * 2)
  const beside = target.right + gap + width <= viewport.width - gap
  const left = mobile ? target.left : beside ? target.right + gap : target.left - width - gap
  const top = mobile ? target.bottom + gap : (target.top + target.bottom - card.height) / 2
  return {
    left: Math.max(gap, Math.min(left, viewport.width - width - gap)),
    top: Math.max(gap, Math.min(top, viewport.height - card.height - gap)),
    width,
  }
}
