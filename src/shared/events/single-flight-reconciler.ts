export interface SingleFlightReconciler {
  dispose(): void
  trigger(): Promise<boolean>
}

/**
 * Coalesces periodic and focus reconciliation into one request at a time.
 * Visibility is supplied by the caller so this utility remains isomorphic.
 */
export function createSingleFlightReconciler(args: {
  reconcile: () => Promise<void>
  shouldRun?: () => boolean
}): SingleFlightReconciler {
  let disposed = false
  let running = false

  return {
    dispose() {
      disposed = true
    },
    async trigger() {
      if (disposed || running || args.shouldRun?.() === false) return false
      running = true
      try {
        await args.reconcile()
        return true
      } finally {
        running = false
      }
    },
  }
}
