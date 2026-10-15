/** Keep one document-timeline origin when React replaces a loading boundary. */
export function createBootLoaderPulseClock() {
  let startedAt: number | undefined
  return (animation: Pick<Animation, 'startTime'>, now: number) => {
    startedAt ??= typeof animation.startTime === 'number' ? animation.startTime : now
    animation.startTime = startedAt
  }
}

/**
 * The brand entrance (mark fade + word reveal) plays once per app boot: the
 * first loader to mount claims it, and every later mount renders the settled
 * screen so the word never re-reveals. Split into a read and a claim so a
 * component can decide at render time and only mark it played once mounted.
 */
export function createBootEntranceClaim() {
  let played = false
  return {
    wasPlayed: () => played,
    markPlayed: () => {
      played = true
    },
  }
}
