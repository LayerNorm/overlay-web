import { describe, it, expect, vi, beforeEach } from 'vitest'

const bridgeState = {
  request: vi.fn(),
  storage: new Map<string, string>()
}

function installStubs(): void {
  bridgeState.request.mockReset()
  bridgeState.storage.clear()
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
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => bridgeState.storage.get(key) ?? null,
      setItem: (key: string, value: string) => void bridgeState.storage.set(key, value),
      removeItem: (key: string) => void bridgeState.storage.delete(key)
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

describe('workspace-service', () => {
  beforeEach(() => {
    vi.resetModules()
    installStubs()
  })

  it('lists workspaces and drops malformed entries', async () => {
    bridgeJsonResponse({
      workspaces: [
        { id: 'workspace-1', name: 'Personal', slug: 'personal', kind: 'personal' },
        { id: 'workspace-2', name: 'Acme', slug: 'acme', kind: 'organization' },
        { id: 'bad-entry', name: 42 }
      ],
      activeWorkspaceId: 'workspace-2'
    })
    const { listWorkspaces } = await import('./workspace-service')
    const response = await listWorkspaces()
    expect(response.activeWorkspaceId).toBe('workspace-2')
    expect(response.workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2'
    ])
  })

  it('adopts the server workspace only when it changes', async () => {
    const store = await import('./workspace-store')
    const { adoptServerActiveWorkspace } = await import('./workspace-service')
    expect(adoptServerActiveWorkspace('workspace-1')).toBe(true)
    expect(store.getActiveWorkspaceId()).toBe('workspace-1')
    expect(adoptServerActiveWorkspace('workspace-1')).toBe(false)
    expect(adoptServerActiveWorkspace('workspace-2')).toBe(true)
    expect(store.getActiveWorkspaceId()).toBe('workspace-2')
  })

  it('activating a workspace stores it, clears caches, and notifies', async () => {
    bridgeJsonResponse({
      activeWorkspaceId: 'workspace-2',
      workspace: { id: 'workspace-2', name: 'Acme', slug: 'acme', kind: 'organization' }
    })
    const store = await import('./workspace-store')
    const service = await import('./workspace-service')
    store.setActiveWorkspaceId('workspace-1')

    const response = await service.activateWorkspace('workspace-2')
    expect(response.activeWorkspaceId).toBe('workspace-2')
    expect(store.getActiveWorkspaceId()).toBe('workspace-2')
    expect(bridgeState.request).toHaveBeenCalledTimes(1)
    const sent = bridgeState.request.mock.calls[0]?.[0] as {
      path: string
      method?: string
      headers: Record<string, string>
    }
    expect(sent.path).toBe('/api/v1/workspaces/active')
    expect(sent.method).toBe('POST')
    // The outgoing request carries the previous workspace until the switch lands.
    expect(sent.headers['x-overlay-workspace-id']).toBe('workspace-1')
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects activation without a workspace id', async () => {
    const { activateWorkspace } = await import('./workspace-service')
    await expect(activateWorkspace('   ')).rejects.toThrow('workspaceId is required')
    expect(bridgeState.request).not.toHaveBeenCalled()
  })
})
