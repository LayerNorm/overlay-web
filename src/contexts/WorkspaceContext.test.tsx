import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceClient, WorkspaceSummary } from '@/shared/workspaces/types'

const mocks = vi.hoisted(() => ({
  pathname: '/w/team/personal/chat',
  search: 'scope=personal',
  directory: undefined as { workspaces: WorkspaceSummary[]; activeWorkspaceId: string; invitations: [] } | undefined,
  convex: { query: vi.fn() },
  router: { replace: vi.fn(), push: vi.fn() },
  toastError: vi.fn(),
  viewProps: null as Record<string, unknown> | null,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}))
vi.mock('@overlay/ui/primitives', () => ({ toast: { error: mocks.toastError } }))
vi.mock('convex/react', () => ({
  useConvex: () => mocks.convex,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (_query: unknown, args: unknown) => args === 'skip' ? undefined : mocks.directory,
}))
vi.mock('@overlay/shell-react', () => ({
  WorkspaceSwitcherView: (props: Record<string, unknown>) => {
    mocks.viewProps = props
    return props.createDialog as React.ReactElement | null
  },
}))
vi.mock('@/hooks/use-panel-scope', () => ({ usePanelScope: () => 'personal' }))
vi.mock('@/hooks/use-workspace-href', () => ({ useWorkspaceHref: () => (_id: string, href: string) => href }))
vi.mock('@/components/identity/WorkspaceAvatar', () => ({ WorkspaceAvatar: () => null }))
vi.mock('@/features/workspaces/components/CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }))

import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { WorkspaceSwitchSupersededError } from '@/shared/workspaces/workspace-switch-error'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
const workspace: WorkspaceSummary = {
  id: 'workspace', name: 'Team', slug: 'team', routingHandle: 'team', kind: 'organization', status: 'active', role: 'owner',
}
const otherWorkspace: WorkspaceSummary = {
  ...workspace,
  id: 'workspace-other',
  name: 'Other team',
  slug: 'other-team',
  routingHandle: 'other-team',
}
const client: WorkspaceClient = {
  create: async () => { throw new Error('Not used') },
  activate: async () => { throw new Error('Not used') },
}
let renderer: ReturnType<typeof create> | undefined
let observed!: ReturnType<typeof useWorkspace>
function Probe() {
  const workspaceState = useWorkspace()
  React.useEffect(() => {
    observed = workspaceState
  }, [workspaceState])
  return null
}
const tree = () => <WorkspaceProvider client={client}><Probe /></WorkspaceProvider>
const treeWithSwitcher = (onNavigate?: () => void) => (
  <WorkspaceProvider client={client}>
    <><Probe /><WorkspaceSwitcher onNavigate={onNavigate} /></>
  </WorkspaceProvider>
)
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}
type TestWindow = EventTarget & {
  location: { pathname: string; search: string; hash: string }
}
let testWindow!: TestWindow

async function updatePath(pathname: string, options?: { history?: boolean }) {
  await act(async () => {
    mocks.pathname = pathname
    testWindow.location.pathname = pathname
    if (options?.history) testWindow.dispatchEvent(new Event('popstate'))
    renderer!.update(tree())
    await flushMicrotasks()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.pathname = '/w/team/personal/chat'
  mocks.search = 'scope=personal'
  testWindow = Object.assign(new EventTarget(), {
    location: { pathname: mocks.pathname, search: '', hash: '' },
  })
  vi.stubGlobal('window', testWindow)
  mocks.directory = { workspaces: [workspace], activeWorkspaceId: workspace.id, invitations: [] }
  mocks.viewProps = null
  client.activate = async () => { throw new Error('Not used') }
  mocks.convex.query.mockReset().mockResolvedValue(null)
  mocks.router.replace.mockReset()
  mocks.router.push.mockReset()
  mocks.toastError.mockReset()
})
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

test('live canonical handles avoid another query; navigation and access-loss updates remain live', async () => {
  await act(() => { renderer = create(tree()) })
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  mocks.pathname = '/w/team/personal/files'
  await act(() => renderer!.update(tree()))
  expect(observed.status).toBe('ready')
  expect(mocks.convex.query).not.toHaveBeenCalled()
  mocks.directory = { workspaces: [], activeWorkspaceId: '', invitations: [] }
  await act(() => renderer!.update(tree()))
  expect(observed.status).toBe('error')
  expect(observed.activeWorkspaceId).toBeNull()
  expect(observed.workspaces).toEqual([])
})

test.each([undefined, 'different-handle'])('a matching slug without the exact routing marker (%s) still requires resolution', async routingHandle => {
  mocks.directory!.workspaces = [{ ...workspace, routingHandle }]
  await act(() => { renderer = create(tree()) })
  expect(mocks.convex.query).toHaveBeenCalledWith(expect.anything(), { handle: 'team' })
  expect(observed.status).toBe('error')
  expect(observed.activeWorkspaceId).toBeNull()
})

test('aliases keep the canonical redirect and member-scoped resolver', async () => {
  mocks.pathname = '/w/old-team/personal/chat'
  mocks.convex.query.mockResolvedValue({ workspaceId: workspace.id, canonicalHandle: 'team', canonical: false })
  await act(() => { renderer = create(tree()) })
  expect(mocks.convex.query).toHaveBeenCalledWith(expect.anything(), { handle: 'old-team' })
  expect(mocks.router.replace).toHaveBeenCalledWith('/w/team/personal/chat', { scroll: false })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
})

test('a late alias result cannot redirect a newer canonical navigation', async () => {
  mocks.pathname = '/w/old-team/personal/chat'
  let settle!: (value: unknown) => void
  mocks.convex.query.mockReturnValue(new Promise(resolve => { settle = resolve }))
  await act(() => { renderer = create(tree()) })
  mocks.pathname = '/w/team/personal/files'
  await act(() => renderer!.update(tree()))
  await act(() => settle({ workspaceId: 'other-workspace', canonicalHandle: 'other-team', canonical: false }))
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(mocks.router.replace).not.toHaveBeenCalled()
})

test('an old refresh result cannot claim a pathname after route ownership changes away and back', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  mocks.pathname = '/w/old-team/personal/chat'
  const staleRefresh = deferred<{ workspaceId: string; canonicalHandle: string; canonical: boolean } | null>()
  const currentRoute = deferred<{ workspaceId: string; canonicalHandle: string; canonical: boolean } | null>()
  mocks.convex.query.mockResolvedValue({ workspaceId: workspace.id, canonicalHandle: 'team', canonical: true })
  await act(async () => { renderer = create(tree()); await flushMicrotasks() })
  expect(observed.activeWorkspaceId).toBe(workspace.id)

  mocks.convex.query.mockReturnValueOnce(staleRefresh.promise).mockReturnValueOnce(currentRoute.promise)
  let refresh!: Promise<void>
  await act(async () => {
    refresh = observed.refresh()
    await flushMicrotasks()
  })
  await updatePath('/w/team/personal/chat')
  await updatePath('/w/old-team/personal/chat')

  await act(async () => {
    staleRefresh.resolve({ workspaceId: otherWorkspace.id, canonicalHandle: 'other-team', canonical: false })
    await flushMicrotasks()
  })
  await refresh
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(mocks.router.replace).not.toHaveBeenCalled()

  await act(async () => {
    currentRoute.resolve({ workspaceId: workspace.id, canonicalHandle: 'team', canonical: true })
    await flushMicrotasks()
  })
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(mocks.router.replace).not.toHaveBeenCalled()
})

test('a deferred route lookup commits the latest live workspace directory', async () => {
  mocks.directory = { workspaces: [workspace], activeWorkspaceId: workspace.id, invitations: [] }
  mocks.pathname = '/w/old-team/personal/chat'
  const routeResolution = deferred<{ workspaceId: string; canonicalHandle: string; canonical: boolean } | null>()
  mocks.convex.query.mockReturnValue(routeResolution.promise)
  await act(async () => { renderer = create(tree()); await flushMicrotasks() })

  const renamedWorkspace = { ...workspace, name: 'Renamed team' }
  mocks.directory = { workspaces: [renamedWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  await act(async () => { renderer!.update(tree()); await flushMicrotasks() })

  await act(async () => {
    routeResolution.resolve({ workspaceId: workspace.id, canonicalHandle: 'team', canonical: true })
    await flushMicrotasks()
  })
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspace?.name).toBe('Renamed team')
  expect(observed.workspaces).toEqual([renamedWorkspace])
})

test('destination scope resolves before delayed activation and ignores response membership data', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const activation = deferred<{ workspace: WorkspaceSummary }>()
  client.activate = vi.fn(() => activation.promise)
  await act(() => { renderer = create(tree()) })

  await act(() => { observed.beginWorkspaceNavigation(otherWorkspace.id) })
  const switched = observed.switchWorkspace(otherWorkspace.id)
  await flushMicrotasks()
  expect(client.activate).toHaveBeenCalledWith(otherWorkspace.id)

  await updatePath('/w/other-team/personal/chat')
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()

  activation.resolve({ workspace: { ...otherWorkspace, name: 'Stale activation reply' } })
  await expect(switched).resolves.toEqual(otherWorkspace)
  expect(observed.activeWorkspace?.name).toBe(otherWorkspace.name)
  expect(observed.workspaces).toEqual([workspace, otherWorkspace])
})

test('initial route hydration and refresh do not write the active-workspace preference', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  mocks.pathname = '/w/other-team/personal/chat'
  client.activate = vi.fn(async () => ({ workspace: otherWorkspace }))
  await act(() => { renderer = create(tree()) })

  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  expect(client.activate).not.toHaveBeenCalled()
  await act(async () => { await observed.refresh() })
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  expect(client.activate).not.toHaveBeenCalled()
})

test('A to B to A serializes preference writes and suppresses the stale B failure', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const toB = deferred<{ workspace: WorkspaceSummary }>()
  const toA = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    return workspaceId === otherWorkspace.id ? toB.promise : toA.promise
  })
  await act(() => { renderer = create(tree()) })

  const bSelection = observed.switchWorkspace(otherWorkspace.id)
  await flushMicrotasks()
  const aCorrection = observed.switchWorkspace(workspace.id)
  await flushMicrotasks()
  expect(activated).toEqual([otherWorkspace.id])

  toB.reject(new Error('Late B failure'))
  await expect(bSelection).rejects.toBeInstanceOf(WorkspaceSwitchSupersededError)
  await flushMicrotasks()
  expect(activated).toEqual([otherWorkspace.id, workspace.id])

  toA.resolve({ workspace: { ...workspace, name: 'Stale A reply' } })
  await expect(aCorrection).resolves.toEqual(workspace)
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.error).toBeNull()
  expect(observed.workspaces).toEqual([workspace, otherWorkspace])
})

test('Back and Forward routes supersede pending activation and converge preference writes', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const firstB = deferred<{ workspace: WorkspaceSummary }>()
  const backA = deferred<{ workspace: WorkspaceSummary }>()
  const forwardB = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  let bRequests = 0
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    if (workspaceId === otherWorkspace.id) {
      bRequests += 1
      return bRequests === 1 ? firstB.promise : forwardB.promise
    }
    return backA.promise
  })
  await act(() => { renderer = create(tree()) })

  let firstSelection!: Promise<WorkspaceSummary>
  await act(() => {
    observed.beginWorkspaceNavigation(otherWorkspace.id)
    firstSelection = observed.switchWorkspace(otherWorkspace.id)
  })
  await flushMicrotasks()
  await updatePath('/w/other-team/personal/chat')
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  await updatePath('/w/team/personal/chat', { history: true })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(activated).toEqual([otherWorkspace.id])

  const staleSelection = expect(firstSelection).rejects.toBeInstanceOf(WorkspaceSwitchSupersededError)
  firstB.resolve({ workspace: { ...otherWorkspace, name: 'Old B reply' } })
  await staleSelection
  await flushMicrotasks()
  expect(activated).toEqual([otherWorkspace.id, workspace.id])

  await updatePath('/w/other-team/personal/chat', { history: true })
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  backA.resolve({ workspace })
  await flushMicrotasks()
  expect(activated).toEqual([otherWorkspace.id, workspace.id, otherWorkspace.id])

  forwardB.resolve({ workspace: otherWorkspace })
  await flushMicrotasks()
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  expect(observed.workspaces).toEqual([workspace, otherWorkspace])
  expect(mocks.router.replace).not.toHaveBeenCalled()
})

test('same-path Back cancels a pending selection and corrects the activation preference', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const toB = deferred<{ workspace: WorkspaceSummary }>()
  const toA = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    return workspaceId === otherWorkspace.id ? toB.promise : toA.promise
  })
  await act(() => { renderer = create(tree()) })

  let selection!: Promise<WorkspaceSummary>
  await act(() => {
    observed.beginWorkspaceNavigation(otherWorkspace.id)
    selection = observed.switchWorkspace(otherWorkspace.id)
  })
  await flushMicrotasks()
  const supersededSelection = expect(selection).rejects.toBeInstanceOf(WorkspaceSwitchSupersededError)
  await updatePath('/w/team/personal/chat', { history: true })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()
  expect(activated).toEqual([otherWorkspace.id])

  toB.resolve({ workspace: otherWorkspace })
  await supersededSelection
  await flushMicrotasks()
  expect(activated).toEqual([otherWorkspace.id, workspace.id])
  toA.resolve({ workspace })
  await flushMicrotasks()
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.error).toBeNull()
})

test('an accepted in-workspace route after Back remains authoritative', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  client.activate = vi.fn(async () => ({ workspace: otherWorkspace }))
  await act(() => { renderer = create(tree()) })

  await act(() => {
    observed.beginWorkspaceNavigation(otherWorkspace.id)
  })
  const selection = observed.switchWorkspace(otherWorkspace.id)
  await flushMicrotasks()
  await updatePath('/w/other-team/personal/chat')
  await expect(selection).resolves.toEqual(otherWorkspace)

  await updatePath('/w/team/personal/chat', { history: true })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  await updatePath('/w/other-team/personal/files')

  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(otherWorkspace.id)
  expect(mocks.router.replace).not.toHaveBeenCalled()
})

test('A to B to C keeps the latest selection through source refresh and live-directory updates', async () => {
  const nextWorkspace: WorkspaceSummary = {
    ...workspace,
    id: 'workspace-next',
    name: 'Next team',
    slug: 'next-team',
    routingHandle: 'next-team',
  }
  const intermediate: WorkspaceSummary = { ...otherWorkspace, routingHandle: 'canonical-other-team' }
  mocks.directory = { workspaces: [workspace, intermediate, nextWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const bActivation = deferred<{ workspace: WorkspaceSummary }>()
  const cActivation = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    return workspaceId === intermediate.id ? bActivation.promise : cActivation.promise
  })
  await act(() => { renderer = create(tree()) })

  let bSelection!: Promise<WorkspaceSummary>
  await act(() => {
    observed.beginWorkspaceNavigation(intermediate.id)
    bSelection = observed.switchWorkspace(intermediate.id)
  })
  const staleBResult = expect(bSelection).rejects.toBeInstanceOf(WorkspaceSwitchSupersededError)
  let cSelection!: Promise<WorkspaceSummary>
  await act(() => {
    observed.beginWorkspaceNavigation(nextWorkspace.id)
    cSelection = observed.switchWorkspace(nextWorkspace.id)
  })
  await flushMicrotasks()
  expect(activated).toEqual([intermediate.id])
  expect(observed.switchingWorkspaceId).toBe(nextWorkspace.id)

  await act(async () => { await observed.refresh() })
  expect(activated).toEqual([intermediate.id])
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.switchingWorkspaceId).toBe(nextWorkspace.id)

  mocks.directory = {
    workspaces: [workspace, { ...intermediate, name: 'Renamed team' }, nextWorkspace],
    activeWorkspaceId: workspace.id,
    invitations: [],
  }
  await act(async () => { renderer!.update(tree()); await flushMicrotasks() })
  expect(activated).toEqual([intermediate.id])
  expect(observed.switchingWorkspaceId).toBe(nextWorkspace.id)

  await updatePath('/w/next-team/personal/chat')
  expect(observed.activeWorkspaceId).toBe(nextWorkspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()
  expect(activated).toEqual([intermediate.id])

  await act(async () => {
    bActivation.resolve({ workspace: { ...intermediate, name: 'Stale activation reply' } })
    await flushMicrotasks()
  })
  await staleBResult
  await flushMicrotasks()
  expect(activated).toEqual([intermediate.id, nextWorkspace.id])
  await act(async () => {
    cActivation.resolve({ workspace: { ...nextWorkspace, name: 'Stale activation reply' } })
    await flushMicrotasks()
  })
  await expect(cSelection).resolves.toEqual(nextWorkspace)
  expect(observed.activeWorkspace?.name).toBe(nextWorkspace.name)
  expect(observed.workspaces).toEqual([workspace, { ...intermediate, name: 'Renamed team' }, nextWorkspace])
})

test('a late handle resolver cannot override a newer accepted route', async () => {
  const nextWorkspace: WorkspaceSummary = {
    ...workspace,
    id: 'workspace-next',
    name: 'Next team',
    slug: 'next-team',
    routingHandle: 'next-team',
  }
  mocks.directory = { workspaces: [workspace, otherWorkspace, nextWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const resolution = deferred<{ workspaceId: string; canonicalHandle: string; canonical: boolean } | null>()
  const activation = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    return activation.promise
  })
  mocks.convex.query.mockReturnValue(resolution.promise)
  await act(() => { renderer = create(tree()) })

  await updatePath('/w/old-route/personal/chat')
  expect(mocks.convex.query).toHaveBeenCalledWith(expect.anything(), { handle: 'old-route' })

  let selection!: Promise<WorkspaceSummary>
  await act(() => {
    observed.beginWorkspaceNavigation(nextWorkspace.id)
    selection = observed.switchWorkspace(nextWorkspace.id)
  })
  await flushMicrotasks()
  resolution.resolve({ workspaceId: otherWorkspace.id, canonicalHandle: 'other-team', canonical: false })
  await act(async () => { await flushMicrotasks() })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.switchingWorkspaceId).toBe(nextWorkspace.id)
  expect(observed.workspaces).toEqual([workspace, otherWorkspace, nextWorkspace])
  expect(mocks.router.replace).not.toHaveBeenCalled()
  expect(activated).toEqual([nextWorkspace.id])

  await updatePath('/w/next-team/personal/chat')
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(nextWorkspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()

  activation.resolve({ workspace: nextWorkspace })
  await expect(selection).resolves.toEqual(nextWorkspace)
})

test('switcher cancels pending B when the active A is selected before pathname changes', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const toB = deferred<{ workspace: WorkspaceSummary }>()
  const toA = deferred<{ workspace: WorkspaceSummary }>()
  const activated: string[] = []
  client.activate = vi.fn((workspaceId: string) => {
    activated.push(workspaceId)
    return workspaceId === otherWorkspace.id ? toB.promise : toA.promise
  })
  const onNavigate = vi.fn()
  await act(() => { renderer = create(treeWithSwitcher(onNavigate)) })

  const select = (workspaceId: string) => {
    const props = mocks.viewProps!
    ;(props.onSelectWorkspace as (id: string) => void)(workspaceId)
  }
  await act(() => { select(otherWorkspace.id) })
  expect(observed.switchingWorkspaceId).toBe(otherWorkspace.id)
  await act(() => { select(workspace.id) })

  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()
  expect(mocks.pathname).toBe('/w/team/personal/chat')
  expect(mocks.router.push).toHaveBeenCalledTimes(2)
  expect(activated).toEqual([otherWorkspace.id])
  expect(onNavigate).toHaveBeenCalledTimes(2)

  await act(async () => {
    toB.resolve({ workspace: { ...otherWorkspace, name: 'Stale activation reply' } })
    await flushMicrotasks()
  })
  expect(activated).toEqual([otherWorkspace.id, workspace.id])
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.switchingWorkspaceId).toBeNull()
  expect(mocks.router.replace).not.toHaveBeenCalled()

  await act(async () => {
    toA.resolve({ workspace })
    await flushMicrotasks()
  })
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.workspaces).toEqual([workspace, otherWorkspace])
  expect(mocks.toastError).not.toHaveBeenCalled()
})

test('activation preference failure does not turn an authorized route into an access error', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const activation = deferred<{ workspace: WorkspaceSummary }>()
  client.activate = vi.fn(() => activation.promise)
  await act(() => { renderer = create(tree()) })

  const switched = observed.switchWorkspace(otherWorkspace.id)
  await flushMicrotasks()
  activation.reject(new Error('Preference write failed'))

  await expect(switched).rejects.toThrow('Preference write failed')
  expect(observed.status).toBe('ready')
  expect(observed.activeWorkspaceId).toBe(workspace.id)
  expect(observed.error).toBeNull()
  expect(observed.workspaces).toEqual([workspace, otherWorkspace])
})

test('denied route remains unavailable after delayed activation succeeds', async () => {
  mocks.directory = { workspaces: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, invitations: [] }
  const activation = deferred<{ workspace: WorkspaceSummary }>()
  client.activate = vi.fn(() => activation.promise)
  await act(() => { renderer = create(tree()) })

  await act(() => { observed.beginWorkspaceNavigation(otherWorkspace.id) })
  const switched = observed.switchWorkspace(otherWorkspace.id)
  await flushMicrotasks()
  await updatePath('/w/no-longer-a-member/personal/chat')
  expect(observed.status).toBe('error')
  expect(observed.error).toBe('Workspace not found or you no longer have access.')
  expect(observed.activeWorkspaceId).toBeNull()
  expect(observed.switchingWorkspaceId).toBeNull()

  activation.resolve({ workspace: otherWorkspace })
  await expect(switched).resolves.toEqual(otherWorkspace)
  expect(observed.status).toBe('error')
  expect(observed.activeWorkspaceId).toBeNull()
  expect(observed.workspaces).toEqual([])
})
