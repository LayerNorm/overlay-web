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

describe('environment-service health', () => {
  beforeEach(() => {
    vi.resetModules()
    installStubs()
  })

  it('keeps pending and revoked statuses as reported', async () => {
    const { deriveDisplayStatus } = await import('./environment-service')
    expect(deriveDisplayStatus({ status: 'pending' }, 1_000_000)).toBe('pending')
    expect(deriveDisplayStatus({ status: 'revoked' }, 1_000_000)).toBe('revoked')
  })

  it('marks online environments offline after 45s without a heartbeat', async () => {
    const { deriveDisplayStatus, ENVIRONMENT_OFFLINE_AFTER_MS } = await import(
      './environment-service'
    )
    expect(ENVIRONMENT_OFFLINE_AFTER_MS).toBe(45_000)
    const now = 1_000_000
    expect(deriveDisplayStatus({ status: 'online', lastSeenAt: now - 10_000 }, now)).toBe('online')
    expect(deriveDisplayStatus({ status: 'online', lastSeenAt: now - 46_000 }, now)).toBe('offline')
    expect(deriveDisplayStatus({ status: 'online' }, now)).toBe('online')
  })

  it('lists environments and drops malformed entries', async () => {
    bridgeJsonResponse({
      environments: [
        {
          id: 'environment-1',
          workspaceId: 'workspace-1',
          kind: 'local',
          name: 'MacBook',
          status: 'online',
          lastSeenAt: Date.now(),
          createdAt: 1,
          updatedAt: 2
        },
        { id: 'bad', name: 42 }
      ]
    })
    const { listEnvironments } = await import('./environment-service')
    const environments = await listEnvironments()
    expect(environments.map((environment) => environment.id)).toEqual(['environment-1'])
    const sent = bridgeState.request.mock.calls[0] as unknown as [
      { path: string; headers: Record<string, string> }
    ]
    expect(sent[0].path).toBe('/api/v1/agent-environments')
    expect(sent[0].headers['x-overlay-workspace-id']).toBe('workspace-1')
  })

  it('lists bindings and agents with workspace scope', async () => {
    const { listBindings, listAgents } = await import('./environment-service')
    bridgeJsonResponse({
      bindings: [
        {
          id: 'binding-1',
          workspaceId: 'workspace-1',
          agentId: 'agent-1',
          environmentId: 'environment-1',
          protocolAdapter: 'acp',
          adapterConfig: { adapterId: 'codex' },
          enabled: true
        }
      ]
    })
    expect((await listBindings()).map((binding) => binding.id)).toEqual(['binding-1'])

    bridgeJsonResponse({ agents: [{ id: 'agent-1', name: 'Helper' }] })
    expect((await listAgents()).map((agent) => agent.id)).toEqual(['agent-1'])
    expect(bridgeState.request).toHaveBeenCalledTimes(2)
  })
})
