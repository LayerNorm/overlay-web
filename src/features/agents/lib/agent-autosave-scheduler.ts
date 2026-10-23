export type AgentAutosave = () => Promise<unknown>

export function createAgentAutosaveScheduler(delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingSave: AgentAutosave | null = null
  let pendingValid = false
  let inFlight: Promise<void> | null = null
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const run = async () => {
    if (disposed || inFlight || !pendingSave || !pendingValid) return
    const save = pendingSave
    pendingSave = null
    inFlight = Promise.resolve().then(save).then(() => undefined).finally(() => {
      inFlight = null
      if (pendingSave && pendingValid) void run()
    })
    await inFlight
  }

  return {
    schedule(save: AgentAutosave, valid: boolean) {
      pendingSave = save
      pendingValid = valid
      clearTimer()
      if (valid) timer = setTimeout(() => void run(), delayMs)
    },
    flush(save: AgentAutosave, valid: boolean) {
      pendingSave = valid ? save : null
      pendingValid = valid
      clearTimer()
      if (valid) void run()
    },
    cancel() {
      disposed = true
      pendingSave = null
      pendingValid = false
      clearTimer()
    },
  }
}
