import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Module } from 'node:module'
import React from 'react'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

let pathname = '/app/settings'
let identity = 'viewer-a'
let nativeAuthConfigured = false
let hasConvexClient = false
let isAuthenticated = true
let directoryQueryError: Error | null = null
let directoryResults: Array<Record<string, unknown>> = []
let directoryStatus: 'CanLoadMore' | 'Exhausted' = 'Exhausted'
let initialHint: string | null = null
const handleResolution: Record<string, unknown> | null = null
let sharingPolicyQuery: Record<string, unknown> | undefined
let sharingQueryCalls = 0
let routeReplacements: string[] = []
let mutationImplementation: (args: unknown) => Promise<unknown> = async () => undefined
const mutationCalls: unknown[] = []
const optimisticUpdaters: Array<(store: unknown, args: unknown) => void> = []
const loadMore = () => undefined
const searchParams = new URLSearchParams()
const mockRouter = {
  replace: (location: string) => routeReplacements.push(location),
}

const moduleMocks = new Map<string, Record<string, unknown>>([
  ['next/navigation', {
    usePathname: () => pathname,
    useRouter: () => mockRouter,
    useSearchParams: () => searchParams,
    useParams: () => ({}),
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    redirect: () => undefined,
    permanentRedirect: () => undefined,
    notFound: () => undefined,
  }],
  ['convex/react', {
    useConvexAuth: () => ({ isAuthenticated, isLoading: false }),
    usePaginatedQuery: () => {
      if (directoryQueryError) throw directoryQueryError
      return {
        results: directoryResults,
        status: directoryStatus,
        loadMore,
      }
    },
    useMutation: () => {
      const mutate = (args: unknown) => {
        mutationCalls.push(args)
        return mutationImplementation(args)
      }
      return Object.assign(mutate, {
        withOptimisticUpdate: (updater: (store: unknown, args: unknown) => void) => {
          optimisticUpdaters.push(updater)
          return mutate
        },
      })
    },
    useQuery: (_query: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      if (args && typeof args === 'object') {
        if ('handle' in args) return handleResolution
        if ('workspaceId' in args) {
          sharingQueryCalls += 1
          return sharingPolicyQuery
        }
      }
      return initialHint
    },
  }],
  ['@/contexts/AuthContext', { useAuth: () => ({ user: { id: identity } }) }],
  ['@/components/providers/ConvexAuthProvider', {
    useConvexAuthConfiguration: () => ({ nativeAuthConfigured, hasConvexClient }),
  }],
  ['@/shared/chat/chat-list-cache', { setActiveChatListWorkspace: () => undefined }],
  ['@/shared/workspaces/events', { dispatchWorkspaceChanged: () => undefined }],
  ['@/hooks/use-workspace-create-access', { invalidateWorkspaceScopePolicy: () => undefined }],
])
const moduleLoader = Module as unknown as {
  _load(request: string, parent: unknown, isMain: boolean): unknown
}
const originalLoad = moduleLoader._load
moduleLoader._load = function (request, parent, isMain) {
  const mocked = moduleMocks.get(request)
  return mocked ?? originalLoad.call(this, request, parent, isMain)
}

after(() => {
  moduleLoader._load = originalLoad
})

let WorkspaceProvider!: typeof import('./WorkspaceContext').WorkspaceProvider
let useWorkspace!: typeof import('./WorkspaceContext').useWorkspace
let WorkspaceNameEditor!: typeof import('../features/workspaces/components/WorkspaceNameEditor').WorkspaceNameEditor
let WorkspaceSettingsPanel!: typeof import('../features/workspaces/components/WorkspaceSettingsPanel').WorkspaceSettingsPanel
let act!: typeof import('react-test-renderer').act
let create!: typeof import('react-test-renderer').create

before(async () => {
  ;(globalThis as typeof globalThis & { window: Window }).window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    location: { search: '', hash: '' },
  } as unknown as Window
  const workspaceContext = await import('./WorkspaceContext')
  const nameEditor = await import('../features/workspaces/components/WorkspaceNameEditor')
  const settingsPanel = await import('../features/workspaces/components/WorkspaceSettingsPanel')
  const renderer = await import('react-test-renderer')
  WorkspaceProvider = workspaceContext.WorkspaceProvider
  useWorkspace = workspaceContext.useWorkspace
  WorkspaceNameEditor = nameEditor.WorkspaceNameEditor
  WorkspaceSettingsPanel = settingsPanel.WorkspaceSettingsPanel
  act = renderer.act
  create = renderer.create
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

const a: WorkspaceSummary = {
  id: 'workspace-a', name: 'Workspace A', slug: 'workspace-a',
  kind: 'organization', status: 'active', role: 'owner', updatedAt: 1,
}
const b: WorkspaceSummary = {
  id: 'workspace-b', name: 'Workspace B', slug: 'workspace-b',
  kind: 'organization', status: 'active', role: 'owner', updatedAt: 1,
}

function createClient(listResponse: {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string
  invitations: Array<{ id: string; workspaceId: string; workspaceName: string; role: 'member'; expiresAt: number }>
} = { workspaces: [a], activeWorkspaceId: a.id, invitations: [] }) {
  let listCalls = 0
  return {
    get listCalls() { return listCalls },
    async list() {
      listCalls += 1
      return listResponse
    },
    async create() {
      return { workspace: a, activeWorkspaceId: a.id }
    },
    async activate(workspaceId: string) {
      return { workspace: workspaceId === b.id ? b : a, activeWorkspaceId: workspaceId }
    },
  }
}

test('workspace provider gates native mode and never falls back when native auth is unavailable', async () => {
  pathname = '/app/settings'
  identity = 'viewer-a'
  nativeAuthConfigured = false
  hasConvexClient = false
  isAuthenticated = true
  directoryResults = []
  const client = createClient()
  let current: ReturnType<typeof useWorkspace> | null = null
  function Probe() {
    const value = useWorkspace()
    React.useEffect(() => { current = value }, [value])
    return null
  }

  let root!: ReturnType<typeof create>
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.equal(current?.activeWorkspaceId, a.id)
  assert.equal(client.listCalls, 1)
  await act(async () => root.unmount())

  nativeAuthConfigured = true
  hasConvexClient = false
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.status, 'error')
  assert.equal(current?.activeWorkspaceId, null)
  assert.match(current?.error ?? '', /Native workspace directory is unavailable/)
  assert.equal(client.listCalls, 1)
  await act(async () => root.unmount())

  hasConvexClient = true
  isAuthenticated = false
  initialHint = null
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.status, 'error')
  assert.equal(current?.activeWorkspaceId, null)
  assert.deepEqual(current?.workspaces, [])
  assert.equal(client.listCalls, 1)
  await act(async () => root.unmount())
})

test('native query failures surface as workspace errors without HTTP fallback', async () => {
  nativeAuthConfigured = true
  hasConvexClient = true
  isAuthenticated = true
  pathname = '/app/settings'
  directoryQueryError = new Error('Directory subscription denied')
  directoryResults = []
  const client = createClient()
  let current: ReturnType<typeof useWorkspace> | null = null
  function Probe() {
    const value = useWorkspace()
    React.useEffect(() => { current = value }, [value])
    return null
  }

  let root!: ReturnType<typeof create>
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.equal(current?.status, 'error')
  assert.match(current?.error ?? '', /Directory subscription denied/)
  assert.deepEqual(current?.workspaces, [])
  assert.equal(client.listCalls, 0)
  directoryQueryError = null
  await act(async () => root.unmount())
})

test('native invitation bridge ignores workspace rows returned by the HTTP client', async () => {
  nativeAuthConfigured = true
  hasConvexClient = true
  isAuthenticated = true
  pathname = '/app/workspaces'
  initialHint = null
  directoryStatus = 'Exhausted'
  directoryResults = []
  const invitation = {
    id: 'invite-1',
    workspaceId: 'pending-workspace',
    workspaceName: 'Pending workspace',
    role: 'member' as const,
    expiresAt: 2,
  }
  const client = createClient({
    workspaces: [a],
    activeWorkspaceId: a.id,
    invitations: [invitation],
  })
  let current: ReturnType<typeof useWorkspace> | null = null
  function Probe() {
    const value = useWorkspace()
    React.useEffect(() => { current = value }, [value])
    return null
  }

  let root!: ReturnType<typeof create>
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.equal(client.listCalls, 1)
  assert.deepEqual(current?.workspaces, [])
  assert.equal(current?.activeWorkspace, null)
  assert.deepEqual(current?.invitations, [invitation])
  await act(async () => root.unmount())
})

test('native directory updates reactively, route selection beats the saved hint, and identity changes isolate rows', async () => {
  nativeAuthConfigured = true
  hasConvexClient = true
  isAuthenticated = true
  initialHint = a.id
  directoryStatus = 'Exhausted'
  pathname = `/app/w/${b.id}/settings`
  identity = 'viewer-a'
  directoryResults = [a, b]
  routeReplacements = []
  const client = createClient()
  let current: ReturnType<typeof useWorkspace> | null = null
  function Probe() {
    const value = useWorkspace()
    React.useEffect(() => { current = value }, [value])
    return null
  }

  let root!: ReturnType<typeof create>
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.equal(current?.activeWorkspaceId, b.id)
  assert.equal(client.listCalls, 0)

  pathname = '/app/settings'
  initialHint = a.id
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.activeWorkspaceId, b.id)

  directoryResults = [{ ...b, name: 'Renamed remotely', updatedAt: 2 }, a]
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.activeWorkspace?.name, 'Renamed remotely')

  pathname = `/app/w/${a.id}/settings`
  directoryResults = [a]
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.activeWorkspaceId, a.id)

  pathname = '/app/w/pending-workspace/settings'
  directoryStatus = 'CanLoadMore'
  directoryResults = [a, b]
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.equal(current?.activeWorkspaceId, null)
  assert.equal(current?.status, 'loading')

  identity = 'viewer-b'
  directoryStatus = 'Exhausted'
  directoryResults = [{ ...b, id: 'other-user-workspace', name: 'Viewer B workspace' }]
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  assert.deepEqual(current?.workspaces.map(workspace => workspace.id), ['other-user-workspace'])
  assert.equal(current?.activeWorkspace, null)
  assert.equal(client.listCalls, 0)
  await act(async () => root.unmount())
})

test('native rename preserves drafts across remote revisions and scopes optimism to the affected row', async () => {
  nativeAuthConfigured = true
  hasConvexClient = true
  isAuthenticated = true
  mutationCalls.length = 0
  optimisticUpdaters.length = 0
  mutationImplementation = async () => {
    throw new Error('WORKSPACE_REVISION_CONFLICT')
  }
  const initial = { ...a, name: 'Workspace A', updatedAt: 1 }
  const remote = { ...a, name: 'Remote name', updatedAt: 2 }
  let root!: ReturnType<typeof create>

  await act(async () => {
    root = create(
      <WorkspaceNameEditor
        workspace={initial}
        client={{ renameWorkspace: async () => undefined }}
      />,
    )
  })
  await act(async () => {
    root.root.findByProps({ title: 'Rename workspace' }).props.onClick()
  })
  const input = root.root.findByProps({ 'aria-label': 'Workspace name' })
  await act(async () => input.props.onChange({ target: { value: 'My draft' } }))
  await act(async () => {
    root.update(
      <WorkspaceNameEditor
        workspace={remote}
        client={{ renameWorkspace: async () => undefined }}
      />,
    )
  })
  assert.equal(root.root.findByProps({ 'aria-label': 'Workspace name' }).props.value, 'My draft')
  assert.match(root.root.findByProps({ role: 'alert' }).children.join(''), /draft is preserved/)

  await act(async () => {
    await root.root.findByProps({ 'aria-label': 'Save name' }).props.onClick()
  })
  assert.deepEqual(mutationCalls.at(-1), {
    workspaceId: a.id,
    name: 'My draft',
    expectedUpdatedAt: 1,
  })
  assert.equal(root.root.findByProps({ 'aria-label': 'Workspace name' }).props.value, 'My draft')
  assert.ok(optimisticUpdaters.length > 0)

  const affected = { ...a, updatedAt: 1 }
  const unrelated = { ...b, updatedAt: 1 }
  let cachedPage: { page: WorkspaceSummary[]; isDone: boolean } = {
    page: [affected, unrelated],
    isDone: true,
  }
  const updater = optimisticUpdaters[0]!
  updater({
    getAllQueries: () => [{
      args: { paginationOpts: { numItems: 50, cursor: null } },
      value: cachedPage,
    }],
    setQuery: (_query: unknown, _args: unknown, value: typeof cachedPage) => {
      cachedPage = value
    },
  }, { workspaceId: a.id, name: 'Optimistic name', expectedUpdatedAt: 1 })
  assert.equal(cachedPage.page[0]?.name, 'Optimistic name')
  assert.equal(cachedPage.page[1], unrelated)
  await act(async () => root.unmount())
})

test('native Sharing settings render reactive policy and write through Convex only in the active tab', async () => {
  nativeAuthConfigured = true
  hasConvexClient = true
  isAuthenticated = true
  initialHint = a.id
  directoryStatus = 'Exhausted'
  pathname = '/app/settings'
  identity = 'viewer-a'
  directoryResults = [a]
  sharingQueryCalls = 0
  mutationCalls.length = 0
  let failNextMutation = false
  mutationImplementation = async (args) => {
    if (args && typeof args === 'object' && 'patch' in args) {
      const current = sharingPolicyQuery
      const currentPolicy = current?.policy as Record<string, unknown> | undefined
      if (failNextMutation) {
        failNextMutation = false
        sharingPolicyQuery = {
          ...current,
          policy: {
            ...currentPolicy,
            publicLinksEnabled: true,
            memberCanInvite: true,
            updatedAt: 9,
          },
        }
        throw new Error('WORKSPACE_REVISION_CONFLICT')
      }
      sharingPolicyQuery = {
        ...current,
        policy: {
          ...currentPolicy,
          ...(args.patch as Record<string, unknown>),
          updatedAt: 8,
        },
      }
    }
    return undefined
  }
  sharingPolicyQuery = {
    canManage: true,
    policy: {
      workspaceId: a.id,
      updatedAt: 7,
      publicLinksEnabled: true,
      memberCanCreateChannels: true,
      memberCanCreateAgents: true,
      memberCanInvite: false,
      workspaceExtensionsEditors: 'members',
      workspaceContentEditors: 'members',
      memberCanMoveScope: true,
      usageTopUpBy: 'admins',
      legalHold: false,
      rolloutStage: 'general',
    },
  }
  let legacyPolicyReads = 0
  const client = {
    async list() { return { workspaces: [a], activeWorkspaceId: a.id } },
    async create() { return { workspace: a, activeWorkspaceId: a.id } },
    async activate() { return { workspace: a, activeWorkspaceId: a.id } },
  }
  const managementClient = {
    async load() { return { items: [], canManage: true, currentPrincipalId: 'owner', currentRole: 'owner', workspaceKind: 'organization' } },
    async sharingPolicy() {
      legacyPolicyReads += 1
      return { canManage: true, policy: {} }
    },
    async operationalMetrics() { return undefined },
  }
  let root!: ReturnType<typeof create>

  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <WorkspaceSettingsPanel client={managementClient as never} initialTab="people" />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.equal(sharingQueryCalls, 0)
  await act(async () => root.unmount())

  const beforeSharing = optimisticUpdaters.length
  await act(async () => {
    root = create(
      <WorkspaceProvider client={client}>
        <WorkspaceSettingsPanel client={managementClient as never} initialTab="sharing" />
      </WorkspaceProvider>,
    )
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.ok(sharingQueryCalls > 0)
  assert.ok(optimisticUpdaters.length > beforeSharing)
  assert.equal(legacyPolicyReads, 0)
  assert.ok(root.root.findAll(node => node.type === 'button' && node.children.includes('Turn off')).length > 0)

  const turnOff = root.root.findAll(node => node.type === 'button' && node.children.includes('Turn off'))[0]!
  await act(async () => {
    turnOff.props.onClick()
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.deepEqual(mutationCalls.at(-1), {
    workspaceId: a.id,
    patch: { publicLinksEnabled: false },
    expectedUpdatedAt: 7,
  })
  assert.equal(legacyPolicyReads, 0)
  const optimisticPolicy = { ...sharingPolicyQuery!, policy: { ...(sharingPolicyQuery!.policy as Record<string, unknown>), updatedAt: 7, publicLinksEnabled: true } }
  let optimisticResult: typeof optimisticPolicy = optimisticPolicy
  const sharingUpdater = optimisticUpdaters.at(-1)!
  sharingUpdater({
    getQuery: () => optimisticPolicy,
    setQuery: (_query: unknown, _args: unknown, value: typeof optimisticPolicy) => {
      optimisticResult = value
    },
  }, {
    workspaceId: a.id,
    patch: { publicLinksEnabled: false },
    expectedUpdatedAt: 7,
  })
  assert.equal((optimisticResult.policy as Record<string, unknown>).publicLinksEnabled, false)
  assert.ok(Number((optimisticResult.policy as Record<string, unknown>).updatedAt) > 7)

  const newerServerPolicy = {
    ...optimisticPolicy,
    policy: {
      ...(optimisticPolicy.policy as Record<string, unknown>),
      publicLinksEnabled: true,
      memberCanInvite: true,
      updatedAt: 9,
    },
  }
  let rebasedPolicy = newerServerPolicy
  sharingUpdater({
    getQuery: () => newerServerPolicy,
    setQuery: (_query: unknown, _args: unknown, value: typeof newerServerPolicy) => {
      rebasedPolicy = value
    },
  }, {
    workspaceId: a.id,
    patch: { publicLinksEnabled: false },
    expectedUpdatedAt: 7,
  })
  assert.equal((rebasedPolicy.policy as Record<string, unknown>).publicLinksEnabled, false)
  assert.equal((rebasedPolicy.policy as Record<string, unknown>).memberCanInvite, true)
  assert.ok(Number((rebasedPolicy.policy as Record<string, unknown>).updatedAt) > 9)

  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <WorkspaceSettingsPanel client={managementClient as never} initialTab="sharing" />
      </WorkspaceProvider>,
    )
  })
  assert.ok(JSON.stringify(root.toJSON()).includes('Blocked for this workspace'))
  assert.equal(pathname, '/app/settings')

  failNextMutation = true
  const turnOn = root.root.findAll(node => node.type === 'button' && node.children.includes('Turn on'))[0]!
  await act(async () => {
    turnOn.props.onClick()
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  assert.deepEqual(mutationCalls.at(-1), {
    workspaceId: a.id,
    patch: { publicLinksEnabled: true },
    expectedUpdatedAt: 8,
  })
  await act(async () => {
    root.update(
      <WorkspaceProvider client={client}>
        <WorkspaceSettingsPanel client={managementClient as never} initialTab="sharing" />
      </WorkspaceProvider>,
    )
  })
  assert.ok(JSON.stringify(root.toJSON()).includes('Allowed for this workspace'))
  assert.ok(JSON.stringify(root.toJSON()).includes('Members may invite'))
  assert.equal(pathname, '/app/settings')

  await act(async () => root.unmount())
})
