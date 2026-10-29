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

/**
 * Set once the app has rendered real content this boot. The workspace
 * boundary marks it when its children first mount: component remounts from
 * navigation or workspace switches must never re-gate on it, and route
 * fallbacks swap the brand loader for a plain skeleton once it is set.
 */
export function createBootAppShownFlag() {
  let shown = false
  return {
    wasShown: () => shown,
    markShown: () => {
      shown = true
    },
  }
}

export const bootAppShown = createBootAppShownFlag()
