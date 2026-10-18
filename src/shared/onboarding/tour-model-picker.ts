/**
 * Wanted-state for the model picker while the onboarding tour is active. The
 * tour keeps the picker open while its steps anchor to elements inside the
 * open panel; the chat model-selection controller subscribes and mirrors this
 * state into its own `showModelPicker`.
 *
 * A one-shot event races: the tour can dispatch before the controller mounts
 * inside Suspense. Holding the wanted state here means a subscriber that
 * mounts later still applies it on registration.
 */
let wanted = false
const subscribers = new Set<(value: boolean) => void>()

export function setTourModelPickerOpen(value: boolean) {
  if (wanted === value) return
  wanted = value
  for (const subscriber of subscribers) subscriber(wanted)
}

export function subscribeTourModelPicker(subscriber: (value: boolean) => void) {
  subscribers.add(subscriber)
  subscriber(wanted)
  return () => {
    subscribers.delete(subscriber)
  }
}
