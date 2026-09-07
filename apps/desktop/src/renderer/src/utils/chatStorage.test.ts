import { describe, it, expect, vi, beforeEach } from 'vitest'

function installStubs(): Map<string, string> {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn((event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event))
        return true
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      bridge: {
        appApi: {
          request: vi.fn(),
          stream: vi.fn(),
          abort: vi.fn()
        }
      }
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

describe('chatStorage workspace scoping', () => {
  beforeEach(() => {
    vi.resetModules()
    installStubs()
  })

  it('scopes the last-opened chat id per workspace with legacy fallback', async () => {
    const store = await import('../services/workspace-store')
    const chats = await import('./chatStorage')

    store.setActiveWorkspaceId('workspace-1')
    chats.setLastOpenedChatId('chat-a')
    expect(chats.getLastOpenedChatId()).toBe('chat-a')

    store.setActiveWorkspaceId('workspace-2')
    expect(chats.getLastOpenedChatId()).toBeNull()

    chats.setLastOpenedChatId('chat-b')
    expect(chats.getLastOpenedChatId()).toBe('chat-b')

    store.setActiveWorkspaceId('workspace-1')
    expect(chats.getLastOpenedChatId()).toBe('chat-a')
  })

  it('falls back to the legacy key when no scoped value exists', async () => {
    localStorage.setItem('overlay-last-chat-id', 'legacy-chat')
    const chats = await import('./chatStorage')
    expect(chats.getLastOpenedChatId()).toBe('legacy-chat')
  })

  it('clearChatStorageCaches drops metas without throwing', async () => {
    const chats = await import('./chatStorage')
    expect(() => chats.clearChatStorageCaches()).not.toThrow()
    expect(chats.loadChatsMeta()).toEqual([])
    expect(chats.loadChat('missing')).toBeNull()
  })
})
