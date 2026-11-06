import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { getFunctionName } from 'convex/server'
import {
  AgentDirectoryProvider,
  useAgentDirectory,
  type NativeAgent,
} from './AgentDirectoryProvider'
import { useAgentEditorBootstrap } from './use-agent-editor-bootstrap'

const state = vi.hoisted(() => ({
  authConfiguration: { nativeAuthConfigured: true, hasConvexClient: true },
  auth: { user: { id: 'user-1' } as { id: string } | null, isLoading: false },
  workspace: {
    activeWorkspaceId: 'workspace-1' as string | null,
    switchingWorkspaceId: null as string | null,
    status: 'ready' as string,
  },
  convexAuth: { isAuthenticated: true, isLoading: false },
  listByScope: {} as Record<string, NativeAgent[]>,
  detailById: {} as Record<string, NativeAgent | null | undefined>,
  throwContextQuery: false,
  watchers: new Set<() => void>(),
  optimisticCallbacks: new Map<string, (store: unknown, args: unknown) => void>(),
  mutationCalls: new Map<string, ReturnType<typeof vi.fn>>(),
  agentHttp: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  },
  listBindings: vi.fn(async () => ({ launchEnabled: false })),
}))

vi.mock('convex/react', async () => {
  const { getFunctionName: functionName } = await vi.importActual<typeof import('convex/server')>('convex/server')
  return {
    useConvex: () => ({
      query: async (_reference: unknown, args: { agentId?: string }) => state.detailById[args.agentId ?? ''],
      watchQuery: (_reference: unknown, args: { agentId: string }) => ({
        localQueryResult: () => state.detailById[args.agentId],
        onUpdate(callback: () => void) { state.watchers.add(callback); return () => { state.watchers.delete(callback) } },
      }),
    }),
    useConvexAuth: () => state.convexAuth,
    usePaginatedQuery: (_reference: unknown, args: 'skip' | { workspaceId: string }) => {
      if (args === 'skip') return { results: [], status: 'LoadingFirstPage', loadMore: vi.fn() }
      const scope = `${state.auth.user?.id ?? 'anonymous'}:${args.workspaceId}`
      return { results: state.listByScope[scope] ?? [], status: 'Exhausted', loadMore: vi.fn() }
    },
    useQuery: (reference: unknown, args: 'skip' | { workspaceId: string; agentId?: string }) => {
      if (args === 'skip') return undefined
      const name = functionName(reference as never)
      if (name.endsWith(':context')) {
        if (state.throwContextQuery) throw new Error('DEPLOYMENT_FEATURE_ACCESS_DENIED')
        return {
          viewerPrincipalId: `${state.auth.user?.id ?? 'anonymous'}-principal`,
          canCreate: true,
          canBootstrapChiefs: false,
        }
      }
      return state.detailById[args.agentId ?? '']
    },
    useMutation: (reference: unknown) => {
      const name = functionName(reference as never).split(':').at(-1) ?? ''
      let mutation = state.mutationCalls.get(name)
      if (!mutation) {
        mutation = vi.fn(async () => null)
        state.mutationCalls.set(name, mutation)
      }
      return {
        withOptimisticUpdate(callback: (store: unknown, args: unknown) => void) {
          state.optimisticCallbacks.set(name, callback)
          return mutation
        },
      }
    },
  }
})

vi.mock('@/components/providers/ConvexAuthProvider', () => ({
  useConvexAuthConfiguration: () => state.authConfiguration,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => state.auth,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => state.workspace,
}))

vi.mock('@/components/providers/CapabilitiesProvider', () => ({
  useOverlayCapabilities: () => ({ capabilities: { externalAgents: false }, isLoading: false }),
}))

vi.mock('@/shared/app/overlay-app-client', () => ({
  overlayAppClient: {
    agents: state.agentHttp,
    agentEnvironments: { listBindings: state.listBindings },
  },
}))

vi.mock('@overlay/ui/primitives', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({ children, onClick, type = 'button' }: {
      children?: React.ReactNode
      onClick?: () => void
      type?: string
    }) => ReactModule.createElement('button', { type, onClick }, children),
  }
})

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    toJSON(): unknown
    unmount(): void
  }
}

function makeAgent(id: string, workspaceId = 'workspace-1', revision = 'revision-1'): NativeAgent {
  return {
    id,
    workspaceId,
    principalId: `${id}:principal`,
    name: id,
    instructions: 'Agent instructions.',
    harness: 'overlay',
    modelId: 'test-model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'user-1-principal',
    createdAt: 1,
    updatedAt: 1,
    teamIds: [],
    roomCount: 0,
    canEdit: true,
    revision,
  } as NativeAgent
}

function resetState() {
  state.authConfiguration.nativeAuthConfigured = true
  state.authConfiguration.hasConvexClient = true
  state.auth = { user: { id: 'user-1' }, isLoading: false }
  state.workspace = { activeWorkspaceId: 'workspace-1', switchingWorkspaceId: null, status: 'ready' }
  state.convexAuth = { isAuthenticated: true, isLoading: false }
  state.listByScope = { 'user-1:workspace-1': [] }
  state.detailById = {}
  state.throwContextQuery = false
  state.watchers.clear()
  state.optimisticCallbacks.clear()
  state.mutationCalls.clear()
  for (const method of Object.values(state.agentHttp)) method.mockReset()
  state.listBindings.mockReset().mockResolvedValue({ launchEnabled: false })
}

function mountProbe(onRender: (value: ReturnType<typeof useAgentDirectory>) => void) {
  function Probe() {
    const directory = useAgentDirectory()
    useEffect(() => onRender(directory), [directory])
    return <span>{directory.mode}</span>
  }
  let renderer!: ReturnType<typeof create>
  return {
    async start() {
      await act(async () => { renderer = create(<AgentDirectoryProvider><Probe /></AgentDirectoryProvider>) })
    },
    async update() {
      await act(async () => { renderer.update(<AgentDirectoryProvider><Probe /></AgentDirectoryProvider>) })
    },
    get renderer() { return renderer },
    async unmount() {
      await act(async () => renderer.unmount())
    },
  }
}

async function act(callback: () => void | Promise<void>) {
  const ReactModule = await import('react')
  await ReactModule.act(callback)
}

describe('native agent directory provider', () => {
  beforeEach(resetState)
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('Undo waits for the archived native projection instead of sending a cached active revision', async () => {
    let current!: ReturnType<typeof useAgentDirectory>
    state.detailById['agent-1'] = makeAgent('agent-1')
    const mounted = mountProbe(value => { current = value })
    await mounted.start()
    try {
      let restoring!: Promise<NativeAgent>
      await act(async () => { restoring = current.restore('agent-1') })
      expect(state.mutationCalls.get('restore')).not.toHaveBeenCalled()
      expect(current.pendingAgentIds.has('agent-1')).toBe(true)
      expect(state.watchers.size).toBe(1)
      const archived = { ...makeAgent('agent-1', 'workspace-1', 'archived-revision'), archivedAt: 2 }
      state.detailById['agent-1'] = archived
      await act(async () => { [...state.watchers].forEach(callback => callback()); await restoring })
      expect(state.mutationCalls.get('restore')).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-1', agentId: 'agent-1', expectedRevision: 'archived-revision' })
      expect(state.watchers.size).toBe(0)
      expect(current.pendingAgentIds.has('agent-1')).toBe(false)
    } finally { await mounted.unmount() }
  })

  it.each(['timeout', 'null', 'scope'] as const)('never restores when waiting for the archived projection ends with %s', async kind => {
    vi.useFakeTimers()
    let current!: ReturnType<typeof useAgentDirectory>
    state.detailById['agent-1'] = makeAgent('agent-1')
    const mounted = mountProbe(value => { current = value })
    await mounted.start()
    try {
      const result = current.restore('agent-1').catch(error => error)
      if (kind === 'timeout') await act(async () => { vi.advanceTimersByTime(10_000) })
      if (kind === 'null') await act(async () => { state.detailById['agent-1'] = null; [...state.watchers].forEach(callback => callback()) })
      if (kind === 'scope') { state.auth.user = { id: 'user-2' }; await mounted.update() }
      expect(await result).toBeInstanceOf(Error)
      expect(state.mutationCalls.get('restore')).not.toHaveBeenCalled()
      expect(state.watchers.size).toBe(0)
    } finally { await mounted.unmount() }
  })

  it('explicit restore revisions retain conflict semantics without fetching or retrying', async () => {
    let current!: ReturnType<typeof useAgentDirectory>
    const mounted = mountProbe(value => { current = value })
    await mounted.start()
    try {
      const mutation = state.mutationCalls.get('restore')!
      mutation.mockRejectedValue(new Error('WORKSPACE_AGENT_REVISION_CONFLICT'))
      await act(async () => { await expect(current.restore('agent-1', 'explicit-revision')).rejects.toThrow('WORKSPACE_AGENT_REVISION_CONFLICT') })
      expect(mutation).toHaveBeenCalledTimes(1)
      expect(state.watchers.size).toBe(0)
    } finally { await mounted.unmount() }
  })

  it('fails closed for configured unauthenticated access and never invokes agent HTTP actions', async () => {
    state.convexAuth.isAuthenticated = false
    let current: ReturnType<typeof useAgentDirectory> | undefined
    const stale = makeAgent('legacy-agent')
    let bootstrapAgent: NativeAgent | null = null
    function BootstrapProbe() {
      const directory = useAgentDirectory()
      const bootstrap = useAgentEditorBootstrap({
        mode: 'edit',
        agentId: stale.id,
        activeWorkspaceId: 'workspace-1',
        initial: { agent: stale, loading: false, canCreate: false } as never,
      })
      useEffect(() => {
        current = directory
        bootstrapAgent = bootstrap.agent as NativeAgent | null
      }, [bootstrap.agent, directory])
      return <span>{bootstrapAgent?.id ?? 'no-agent'}</span>
    }
    let renderer!: ReturnType<typeof create>
    const mounted = {
      async start() {
        await act(async () => { renderer = create(<AgentDirectoryProvider><BootstrapProbe /></AgentDirectoryProvider>) })
      },
      async unmount() {
        await act(async () => renderer.unmount())
      },
    }
    await mounted.start()
    try {
      expect(current?.mode).toBe('unavailable')
      expect(current?.loading).toBe(false)
      expect(current?.error).toBeTruthy()
      expect(bootstrapAgent).toBeNull()
      expect(JSON.stringify(renderer.toJSON())).toContain('no-agent')
      await expect(current?.create({
        name: 'Unavailable',
        instructions: 'Instructions',
        modelId: 'test-model',
        harness: 'overlay',
        allowedToolIds: [],
        teamIds: [],
      }, '00000000-0000-4000-8000-000000000001')).rejects.toThrow()
      await expect(current?.update('agent-1', { name: 'No HTTP' }, 'revision-1')).rejects.toThrow()
      await expect(current?.archive('agent-1')).rejects.toThrow()
      for (const method of Object.values(state.agentHttp)) expect(method).not.toHaveBeenCalled()
    } finally {
      await mounted.unmount()
    }
  })

  it('does not broaden a denied native query into children or HTTP fallbacks', async () => {
    state.throwContextQuery = true
    const mounted = mountProbe(() => {})
    await mounted.start()
    try {
      expect(JSON.stringify(mounted.renderer.toJSON())).toContain('Could not load your agents')
      for (const method of Object.values(state.agentHttp)) expect(method).not.toHaveBeenCalled()
    } finally {
      await mounted.unmount()
    }
  })

  it('does not resurrect a legacy editor profile after native detail returns null', async () => {
    const stale = makeAgent('agent-legacy')
    state.authConfiguration.nativeAuthConfigured = false
    state.agentHttp.get.mockResolvedValue({ agent: stale })
    state.detailById[stale.id] = null
    let currentAgent: NativeAgent | null | undefined
    function BootstrapProbe() {
      const result = useAgentEditorBootstrap({
        mode: 'edit',
        agentId: stale.id,
        activeWorkspaceId: 'workspace-1',
        initial: { agent: null, loading: true, canCreate: false } as never,
      })
      const directory = useAgentDirectory()
      useEffect(() => {
        currentAgent = result.agent as NativeAgent | null
      }, [directory.mode, result.agent])
      return <span>{result.agent?.id ?? 'no-agent'}</span>
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(<AgentDirectoryProvider><BootstrapProbe /></AgentDirectoryProvider>) })
    try {
      await act(async () => { await Promise.resolve() })
      expect(JSON.stringify(renderer.toJSON())).toContain('agent-legacy')
      expect(state.agentHttp.get).toHaveBeenCalledTimes(1)

      state.authConfiguration.nativeAuthConfigured = true
      state.listByScope['user-1:workspace-1'] = []
      await act(async () => {
        renderer.update(<AgentDirectoryProvider><BootstrapProbe /></AgentDirectoryProvider>)
        await Promise.resolve()
      })
      expect(currentAgent).toBeNull()
      expect(JSON.stringify(renderer.toJSON())).toContain('no-agent')
      expect(state.agentHttp.get).toHaveBeenCalledTimes(1)
      expect(state.agentHttp.list).not.toHaveBeenCalled()
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  it('switches identity and workspace without rendering old directory results', async () => {
    state.listByScope = {
      'user-1:workspace-1': [makeAgent('old-workspace-agent')],
      'user-1:workspace-2': [makeAgent('new-workspace-agent', 'workspace-2')],
      'user-2:workspace-2': [makeAgent('new-identity-agent', 'workspace-2')],
    }
    const renders: string[][] = []
    function Probe() {
      const directory = useAgentDirectory()
      renders.push(directory.directory?.map((agent) => agent.id) ?? [])
      return <span>{directory.directory?.[0]?.id ?? 'loading'}</span>
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(<AgentDirectoryProvider><Probe /></AgentDirectoryProvider>) })
    try {
      expect(JSON.stringify(renderer.toJSON())).toContain('old-workspace-agent')
      renders.length = 0
      state.workspace.activeWorkspaceId = 'workspace-2'
      await act(async () => renderer.update(<AgentDirectoryProvider><Probe /></AgentDirectoryProvider>))
      expect(JSON.stringify(renderer.toJSON())).toContain('new-workspace-agent')
      expect(renders.every((ids) => !ids.includes('old-workspace-agent'))).toBe(true)

      renders.length = 0
      state.auth.user = { id: 'user-2' }
      await act(async () => renderer.update(<AgentDirectoryProvider><Probe /></AgentDirectoryProvider>))
      expect(JSON.stringify(renderer.toJSON())).toContain('new-identity-agent')
      expect(renders.every((ids) => !ids.includes('new-workspace-agent'))).toBe(true)
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  it('removes a failed older optimistic overlay without replacing newer remote intent', async () => {
    state.listByScope['user-1:workspace-1'] = [makeAgent('agent-1')]
    const mounted = mountProbe(() => {})
    await mounted.start()
    try {
      const callback = state.optimisticCallbacks.get('update')
      expect(callback).toBeTypeOf('function')
      const original = makeAgent('agent-1')
      const args = {
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        patch: { name: 'Failed older draft' },
        expectedRevision: original.revision,
      }
      let base = {
        list: { page: [original], continueCursor: '', isDone: true },
        detail: original,
      }
      const active = [{ callback: callback!, args }]
      const reapply = () => {
        const listQuery = {
          args: { workspaceId: 'workspace-1', includeArchived: false, paginationOpts: { cursor: null, numItems: 100 } },
          value: structuredClone(base.list),
        }
        const detailQuery = {
          args: { workspaceId: 'workspace-1', agentId: 'agent-1' },
          value: structuredClone(base.detail),
        }
        const store = {
          getAllQueries(reference: unknown) {
            const name = getFunctionName(reference as never)
            return name.endsWith(':list') ? [listQuery] : name.endsWith(':get') ? [detailQuery] : []
          },
          setQuery(reference: unknown, _queryArgs: unknown, value: unknown) {
            const name = getFunctionName(reference as never)
            if (name.endsWith(':list')) listQuery.value = value as typeof listQuery.value
            if (name.endsWith(':get')) detailQuery.value = value as typeof detailQuery.value
          },
        }
        for (const operation of active) operation.callback(store, operation.args)
        return { list: listQuery.value, detail: detailQuery.value }
      }

      expect(reapply().list.page[0].name).toBe('Failed older draft')
      const remote = makeAgent('agent-1', 'workspace-1', 'remote-revision')
      remote.name = 'Newer remote intent'
      base = {
        list: { page: [remote], continueCursor: '', isDone: true },
        detail: remote,
      }
      expect(reapply().list.page[0].name).toBe('Failed older draft')
      active.splice(0, 1)
      expect(reapply()).toMatchObject({
        list: { page: [{ name: 'Newer remote intent', revision: 'remote-revision' }] },
        detail: { name: 'Newer remote intent', revision: 'remote-revision' },
      })
    } finally {
      await mounted.unmount()
    }
  })

  it('rejects explicitly unsupported native create harnesses before mutation', async () => {
    const mounted = mountProbe(() => {})
    await mounted.start()
    try {
      let current!: ReturnType<typeof useAgentDirectory>
      function ActionProbe() {
        const directory = useAgentDirectory()
        useEffect(() => { current = directory }, [directory])
        return null
      }
      await act(async () => mounted.renderer.update(<AgentDirectoryProvider><ActionProbe /></AgentDirectoryProvider>))
      await expect(current.create({
        name: 'Unsupported harness',
        instructions: 'Instructions',
        modelId: 'test-model',
        harness: 'opencode',
        allowedToolIds: [],
        teamIds: [],
      }, '00000000-0000-4000-8000-000000000002')).rejects.toThrow('WORKSPACE_AGENT_HARNESS_DENIED')
      expect(state.mutationCalls.get('create')).not.toHaveBeenCalled()
      expect(state.agentHttp.create).not.toHaveBeenCalled()
    } finally {
      await mounted.unmount()
    }
  })
})
