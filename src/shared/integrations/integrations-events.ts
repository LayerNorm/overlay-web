export const INTEGRATIONS_BC_CHANNEL = 'overlay-integrations'
/** Written by the static connector callback page so tabs without BroadcastChannel still hear about it. */
export const INTEGRATIONS_STORAGE_KEY = 'overlay:integrations-changed'
/** Written by the connector callback page when the provider sign-in failed. */
export const INTEGRATIONS_FAILED_STORAGE_KEY = 'overlay:integrations-failed'
export const INTEGRATIONS_ATTEMPT_SESSION_KEY = 'overlay:integrations-attempt'

export function notifyIntegrationsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('overlay:integrations-changed'))
  try {
    const bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
    bc.postMessage({ type: 'changed' as const })
    bc.close()
  } catch {
    // BroadcastChannel unsupported or blocked.
  }
}

export function rememberIntegrationAttempt(tab: WindowProxy | null, attemptId: string): void {
  if (!tab) return
  try {
    tab.sessionStorage.setItem(INTEGRATIONS_ATTEMPT_SESSION_KEY, attemptId)
  } catch {
    // The callback still displays its result if tab storage is unavailable.
  }
}

/** Calls onFailed when the matching connector sign-in attempt reports that it failed. */
export function subscribeIntegrationsFailed(attemptId: string, onFailed: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let notified = false
  const notify = () => {
    if (notified) return
    notified = true
    onFailed()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== INTEGRATIONS_FAILED_STORAGE_KEY || !event.newValue) return
    try {
      const message = JSON.parse(event.newValue) as { attemptId?: unknown }
      if (message.attemptId === attemptId) notify()
    } catch {
      // Ignore legacy or malformed failure signals.
    }
  }
  window.addEventListener('storage', onStorage)
  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
    bc.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; attemptId?: unknown } | null
      if (message?.type === 'failed' && message.attemptId === attemptId) notify()
    }
  } catch {
    // BroadcastChannel unsupported or blocked; the storage event still fires.
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    bc?.close()
  }
}

/** Calls onChange when connections change in this tab or another one, including the connector callback tab. */
export function subscribeIntegrationsChanged(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === INTEGRATIONS_STORAGE_KEY) onChange()
  }
  window.addEventListener('overlay:integrations-changed', onChange)
  window.addEventListener('storage', onStorage)
  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
    bc.onmessage = onChange
  } catch {
    // BroadcastChannel unsupported or blocked; the storage event still fires.
  }
  return () => {
    window.removeEventListener('overlay:integrations-changed', onChange)
    window.removeEventListener('storage', onStorage)
    bc?.close()
  }
}
