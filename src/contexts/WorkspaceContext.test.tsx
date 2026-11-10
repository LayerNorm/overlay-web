import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceClient, WorkspaceSummary } from '@/shared/workspaces/types'

const mocks = vi.hoisted(() => ({
  pathname: '/w/team/personal/chat',
  directory: undefined as { workspaces: WorkspaceSummary[]; activeWorkspaceId: string; invitations: [] } | undefined,
  convex: { query: vi.fn() },
  router: { replace: vi.fn() },
}))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => mocks.router }))
vi.mock('convex/react', () => ({
  useConvex: () => mocks.convex,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (_query: unknown, args: unknown) => args === 'skip' ? undefined : mocks.directory,
}))

import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
const workspace: WorkspaceSummary = {
  id: 'workspace', name: 'Team', slug: 'team', routingHandle: 'team', kind: 'organization', status: 'active', role: 'owner',
}
const client: WorkspaceClient = {
  create: async () => { throw new Error('Not used') },
  activate: async () => { throw new Error('Not used') },
}
let renderer: ReturnType<typeof create> | undefined
let observed: ReturnType<typeof useWorkspace>
function Probe() {
  observed = useWorkspace()
  return null
}
const tree = () => <WorkspaceProvider client={client}><Probe /></WorkspaceProvider>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.pathname = '/w/team/personal/chat'
  mocks.directory = { workspaces: [workspace], activeWorkspaceId: workspace.id, invitations: [] }
  mocks.convex.query.mockReset().mockResolvedValue(null)
  mocks.router.replace.mockReset()
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
