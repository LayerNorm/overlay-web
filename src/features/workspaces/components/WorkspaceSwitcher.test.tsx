import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

const mocks = vi.hoisted(() => ({
  pathname: '/w/team/personal/chat',
  search: 'scope=personal',
  router: { push: vi.fn() },
  toastError: vi.fn(),
  beginWorkspaceNavigation: vi.fn(),
  createWorkspace: vi.fn(),
  refresh: vi.fn(),
  switchWorkspace: vi.fn(),
  workspaceState: null as Record<string, unknown> | null,
  viewProps: null as Record<string, unknown> | null,
  createProps: null as Record<string, unknown> | null,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}))
vi.mock('@overlay/ui/primitives', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => mocks.workspaceState }))
vi.mock('@/hooks/use-panel-scope', () => ({ usePanelScope: () => 'personal' }))
vi.mock('@/hooks/use-workspace-href', () => ({ useWorkspaceHref: () => (_id: string, href: string) => href }))
vi.mock('@/components/identity/WorkspaceAvatar', () => ({ WorkspaceAvatar: () => null }))
vi.mock('@overlay/shell-react', () => ({
  WorkspaceSwitcherView: (props: Record<string, unknown>) => {
    mocks.viewProps = props
    return props.createDialog as React.ReactElement | null
  },
}))
vi.mock('./CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: (props: Record<string, unknown>) => {
    mocks.createProps = props
    return null
  },
}))

import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { buildWorkspaceSwitchHref } from '@/shared/workspaces/routing'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { unmount(): void }
}

const workspace: WorkspaceSummary = {
  id: 'workspace',
  name: 'Team',
  slug: 'team',
  routingHandle: 'team',
  kind: 'organization',
  status: 'active',
  role: 'owner',
}
const otherWorkspace: WorkspaceSummary = {
  ...workspace,
  id: 'workspace-other',
  name: 'Other team',
  slug: 'other-team',
  routingHandle: 'other-team',
}
const createdWorkspace: WorkspaceSummary = {
  ...workspace,
  id: 'workspace-created',
  name: 'New team',
  slug: 'new-team',
  routingHandle: 'new-team',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let renderer: ReturnType<typeof create> | undefined
let activation: ReturnType<typeof deferred<WorkspaceSummary>>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  mocks.pathname = '/w/team/personal/chat'
  mocks.search = 'scope=personal'
  mocks.router.push.mockReset()
  mocks.toastError.mockReset()
  mocks.beginWorkspaceNavigation.mockReset()
  mocks.createWorkspace.mockReset().mockResolvedValue(createdWorkspace)
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.switchWorkspace.mockReset()
  mocks.viewProps = null
  mocks.createProps = null
  activation = deferred<WorkspaceSummary>()
  mocks.switchWorkspace.mockReturnValue(activation.promise)
  mocks.workspaceState = {
    status: 'ready',
    workspaces: [workspace, otherWorkspace],
    activeWorkspace: workspace,
    activeWorkspaceId: workspace.id,
    switchingWorkspaceId: null,
    error: null,
    beginWorkspaceNavigation: mocks.beginWorkspaceNavigation,
    createWorkspace: mocks.createWorkspace,
    refresh: mocks.refresh,
    switchWorkspace: mocks.switchWorkspace,
  }
})

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

test('selection closes the picker and pushes the canonical route while activation is pending', async () => {
  const onNavigate = vi.fn()
  await act(() => { renderer = create(<WorkspaceSwitcher onNavigate={onNavigate} />) })
  const initialProps = mocks.viewProps!
  await act(() => { (initialProps.onOpenChange as (open: boolean) => void)(true) })
  expect(mocks.viewProps?.open).toBe(true)

  await act(() => {
    (mocks.viewProps!.onSelectWorkspace as (workspaceId: string) => void)(otherWorkspace.id)
  })

  expect(mocks.viewProps?.open).toBe(false)
  expect(onNavigate).toHaveBeenCalledOnce()
  expect(mocks.beginWorkspaceNavigation).toHaveBeenCalledWith(otherWorkspace.id)
  expect(mocks.switchWorkspace).toHaveBeenCalledWith(otherWorkspace.id)
  expect(mocks.router.push).toHaveBeenCalledWith(buildWorkspaceSwitchHref({
    workspaceId: otherWorkspace.id,
    handle: otherWorkspace.routingHandle,
    pathname: '/w/team/personal/chat',
    search: 'scope=personal',
    currentScope: 'personal',
  }))
  expect(mocks.router.push.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.switchWorkspace.mock.invocationCallOrder[0],
  )

  activation.resolve(otherWorkspace)
  await activation.promise
})

test('latest activation failure uses the existing toast without blocking route navigation', async () => {
  await act(() => { renderer = create(<WorkspaceSwitcher />) })
  await act(() => {
    (mocks.viewProps!.onSelectWorkspace as (workspaceId: string) => void)(otherWorkspace.id)
  })
  expect(mocks.router.push).toHaveBeenCalledOnce()

  activation.reject(new Error('Preference write failed'))
  await expect(activation.promise).rejects.toThrow('Preference write failed')
  await act(async () => { await Promise.resolve() })
  expect(mocks.toastError).toHaveBeenCalledWith('Preference write failed')
})

test('newly created workspace keeps its dialog open until activation succeeds', async () => {
  const onNavigate = vi.fn()
  await act(() => { renderer = create(<WorkspaceSwitcher onNavigate={onNavigate} />) })
  await act(() => { (mocks.viewProps!.onCreateRequest as () => void)() })
  const onCreate = mocks.createProps!.onCreate as (name: string) => Promise<void>
  let completion!: Promise<void>
  await act(async () => {
    completion = onCreate('New team')
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(mocks.createWorkspace).toHaveBeenCalledWith({ name: 'New team' })
  expect(mocks.switchWorkspace).toHaveBeenCalledWith(createdWorkspace.id)
  expect(mocks.router.push).not.toHaveBeenCalled()
  expect(mocks.viewProps?.createDialog).not.toBeNull()
  expect(onNavigate).not.toHaveBeenCalled()
  activation.resolve(createdWorkspace)
  await act(async () => { await completion })
  expect(mocks.router.push).toHaveBeenCalledWith('/w/new-team/settings?section=workspace')
  expect(mocks.viewProps?.createDialog).toBeNull()
  expect(onNavigate).toHaveBeenCalledOnce()
})

test('created-workspace activation failure preserves the open dialog', async () => {
  const onNavigate = vi.fn()
  await act(() => { renderer = create(<WorkspaceSwitcher onNavigate={onNavigate} />) })
  await act(() => { (mocks.viewProps!.onCreateRequest as () => void)() })
  const onCreate = mocks.createProps!.onCreate as (name: string) => Promise<void>
  let completion!: Promise<void>
  await act(async () => {
    completion = onCreate('New team')
    await Promise.resolve()
    await Promise.resolve()
  })

  activation.reject(new Error('Preference write failed'))
  await act(async () => { await completion })
  expect(mocks.viewProps?.createDialog).not.toBeNull()
  expect(mocks.router.push).not.toHaveBeenCalled()
  expect(onNavigate).not.toHaveBeenCalled()
  expect(mocks.toastError).toHaveBeenCalledWith('Preference write failed')
})
