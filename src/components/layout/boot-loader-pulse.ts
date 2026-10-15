/** Keep one document-timeline origin when React replaces a loading boundary. */
export function createBootLoaderPulseClock() {
  let startedAt: number | undefined
  return (animation: Pick<Animation, 'startTime'>, now: number) => {
    startedAt ??= typeof animation.startTime === 'number' ? animation.startTime : now
    animation.startTime = startedAt
  }
}
