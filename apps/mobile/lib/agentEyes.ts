export function agentEyePosition(elapsed: number): number {
  const time = (elapsed % 3500) / 3500
  const frames = [
    [0, 0],
    [0.3, -6.27],
    [0.45, -6.27],
    [0.65, 6.27],
    [0.8, 6.27],
    [1, 0],
  ]
  const end = frames.findIndex((frame) => frame[0] > time)
  const [startTime, from] = frames[Math.max(0, end - 1)]
  const [endTime, to] = frames[end < 0 ? frames.length - 1 : end]
  const position = (time - startTime) / (endTime - startTime)
  return from + (to - from) * (position * position * (3 - 2 * position))
}
