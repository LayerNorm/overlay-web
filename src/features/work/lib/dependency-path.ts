/** Orthogonal routing gives each row-to-row link a small distinct elbow. */
export function dependencyPath(from: { x: number; y: number }, to: { x: number; y: number }, lane = 0) {
  if (![from.x, from.y, to.x, to.y, lane].every(Number.isFinite)) throw new Error('Invalid arrow coordinates')
  const gap = 12 + (lane % 4) * 4
  if (to.x - from.x > gap * 2) {
    const elbow = from.x + gap
    return `M ${from.x} ${from.y} H ${elbow} V ${to.y} H ${to.x}`
  }
  const above = Math.min(from.y, to.y) - 16 - (lane % 4) * 3
  return `M ${from.x} ${from.y} H ${from.x + gap} V ${above} H ${to.x - gap} V ${to.y} H ${to.x}`
}
