import { describe, it, expect, vi, beforeEach } from 'vitest'

const bridgeState = {
  request: vi.fn()
}

function installStubs(): void {
  bridgeState.request.mockReset()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn(() => true),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      bridge: {
        appApi: { request: bridgeState.request, stream: vi.fn(), abort: vi.fn() }
      }
    }
  })
  const storage = new Map<string, string>([['overlay-active-workspace-id', 'workspace-1']])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key)
    }
  })
}

function bridgeJsonResponse(payload: unknown): void {
  bridgeState.request.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    bodyText: JSON.stringify(payload)
  })
}

describe('activity-service', () => {
  beforeEach(() => {
    vi.resetModules()
    installStubs()
  })

  it('lists notifications newest-first and drops malformed rows', async () => {
    bridgeJsonResponse({
      notifications: [
        { id: 'n1', type: 'mention', title: 'Mentioned you', conversationId: 'c1', createdAt: 200 },
        { id: 'n2', type: 'reaction', title: 'Reacted', createdAt: 100, readAt: 150 },
        { id: 'bad', title: 42 }
      ]
    })
    const { fetchNotifications } = await import('./activity-service')
    const items = await fetchNotifications()
    expect(items.map((item) => item.id)).toEqual(['n1', 'n2'])
    expect(items[0]).toMatchObject({ conversationId: 'c1', readAt: undefined })
    const sent = bridgeState.request.mock.calls[0] as unknown as [{ path: string }]
    expect(sent[0].path).toBe('/api/v1/conversations/notifications?limit=50')
    expect(sent).toBeTruthy()
  })

  it('marks notifications read, defaulting to mark-all', async () => {
    const { markNotificationsRead } = await import('./activity-service')
    bridgeJsonResponse({ updated: 3 })
    await markNotificationsRead(['n1'])
    const single = bridgeState.request.mock.calls[0] as unknown as [
      { path: string; method: string; body: string }
    ]
    expect(single[0].path).toBe('/api/v1/conversations/notifications')
    expect(single[0].method).toBe('PATCH')
    expect(JSON.parse(single[0].body)).toEqual({ notificationIds: ['n1'] })

    await markNotificationsRead()
    const all = bridgeState.request.mock.calls[1] as unknown as [{ body: string }]
    expect(JSON.parse(all[0].body)).toEqual({})
  })
})

describe('chat-list-cache views', () => {
  beforeEach(() => {
    vi.resetModules()
    installStubs()
  })

  it('fetches DM views through the server view param', async () => {
    bridgeJsonResponse({
      data: [{ _id: 'dm-1', title: 'DM', createdAt: 1, updatedAt: 2 }],
      hasMore: false
    })
    const { fetchChatListResult } = await import('./chat-list-cache')
    const outcome = await fetchChatListResult({ force: true, view: 'dms' })
    expect(outcome.status).toBe('success')
    const sent = bridgeState.request.mock.calls[0] as unknown as [{ path: string }]
    expect(sent[0].path).toContain('view=dms')
  })

  it('normalizes the archived bare-array response', async () => {
    bridgeJsonResponse([{ _id: 'a1', title: 'Old', createdAt: 1, updatedAt: 2 }])
    const { fetchChatListResult, getCachedChatList } = await import('./chat-list-cache')
    const outcome = await fetchChatListResult({ force: true, view: 'archived' })
    expect(outcome.status).toBe('success')
    if (outcome.status === 'success') expect(outcome.chats.map((chat) => chat._id)).toEqual(['a1'])
    expect(getCachedChatList('archived')?.map((chat) => chat._id)).toEqual(['a1'])
    // Other views are unaffected.
    expect(getCachedChatList('personal')).toBeNull()
  })
})
