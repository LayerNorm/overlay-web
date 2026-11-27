/**
 * Tiny pub/sub so a form-sheet route can tell the screen under it to reload
 * after saving (the screen stays focused under a sheet, so focus effects
 * don't fire).
 */
export function createChangeSignal() {
  const listeners = new Set<() => void>()
  return {
    notify: () => listeners.forEach((listener) => listener()),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const extensionsChanged = createChangeSignal()
