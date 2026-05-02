import { vi } from 'vitest'

// Minimal chrome API shim. The migration / SSE tests only import pure helpers
// but those modules transitively import ./storage and ./overlay-api, which
// reference `chrome.*` lazily inside functions. Defining a stub is still
// needed because some codepaths reference `chrome.runtime.id` at module
// evaluation time.
const storageBacking = new Map<string, unknown>()

const chromeMock = {
  runtime: {
    id: 'test-extension',
    onInstalled: { addListener: vi.fn(), removeListener: vi.fn() },
    onStartup: { addListener: vi.fn(), removeListener: vi.fn() },
    onConnect: { addListener: vi.fn(), removeListener: vi.fn() },
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
    getURL: (path: string) => `chrome-extension://test/${path}`,
    lastError: undefined,
  },
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return Object.fromEntries(storageBacking)
        const list = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.map((k) => [k, storageBacking.get(k)]))
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) storageBacking.set(k, v)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        for (const k of list) storageBacking.delete(k)
      }),
      clear: vi.fn(async () => storageBacking.clear()),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(async () => []),
    get: vi.fn(async () => null),
    sendMessage: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    group: vi.fn(),
    ungroup: vi.fn(),
  },
  tabGroups: {
    update: vi.fn(),
    query: vi.fn(async () => []),
  },
  windows: {
    getAll: vi.fn(async () => []),
    getCurrent: vi.fn(async () => ({ id: 1, tabs: [] })),
    onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  sidePanel: {
    open: vi.fn(),
    setOptions: vi.fn(),
  },
  action: {
    onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
}

;(globalThis as unknown as { chrome: unknown }).chrome = chromeMock
