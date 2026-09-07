import { describe, it, expect, vi, beforeEach } from 'vitest'

function installDomStubs(): Map<string, string> {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn((event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event))
        return true
      }),
      addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(listener)
      }),
      removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
        listeners.get(type)?.delete(listener)
      })
    }
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key)
    }
  })
  return storage
}

describe('workspace-store', () => {
  beforeEach(() => {
    vi.resetModules()
    installDomStubs()
  })

  it('starts empty and persists the active workspace id', async () => {
    const store = await import('./workspace-store')
    expect(store.getActiveWorkspaceId()).toBeNull()
    store.setActiveWorkspaceId('workspace-1')
    expect(store.getActiveWorkspaceId()).toBe('workspace-1')
    expect(localStorage.getItem('overlay-active-workspace-id')).toBe('workspace-1')
  })

  it('rehydrates a previously stored id on first read', async () => {
    localStorage.setItem('overlay-active-workspace-id', 'workspace-7')
    const store = await import('./workspace-store')
    expect(store.getActiveWorkspaceId()).toBe('workspace-7')
  })

  it('clears the stored id and notifies subscribers on change', async () => {
    const store = await import('./workspace-store')
    const seen: Array<string | null> = []
    const unsubscribe = store.subscribeWorkspaceChanged((id) => seen.push(id))
    store.setActiveWorkspaceId('workspace-9')
    store.dispatchWorkspaceChanged('workspace-9')
    store.clearActiveWorkspaceId()
    store.dispatchWorkspaceChanged(store.getActiveWorkspaceId())
    unsubscribe()
    store.dispatchWorkspaceChanged('workspace-9')
    expect(seen).toEqual(['workspace-9', null])
    expect(localStorage.getItem('overlay-active-workspace-id')).toBeNull()
  })
})
