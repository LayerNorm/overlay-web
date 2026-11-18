import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  onOpen: vi.fn(),
  switchWorkspace: vi.fn(),
  workspaceState: null as Record<string, unknown> | null,
}))

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'member@example.test' }, signOut: vi.fn() }),
}))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => mocks.workspaceState }))
vi.mock('@/components/brand/BrandLockup', () => ({ BrandLockup: () => null }))
vi.mock('@/components/identity/WorkspaceAvatar', () => ({ WorkspaceAvatar: () => null }))
vi.mock('@/shared/auth/session-fetch', () => ({ fetchWithSessionRecovery: vi.fn() }))
vi.mock('@overlay/ui/primitives', async () => {
  const ReactModule = await import('react')
  type ButtonProps = {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: React.MouseEventHandler<HTMLButtonElement>
    type?: 'button' | 'submit'
  }
  return {
    Button: ({ children, disabled, onClick, type }: ButtonProps) =>
      ReactModule.createElement('button', { disabled, onClick, type }, children),
    Input: () => null,
  }
})

import { WorkspaceDirectory } from './WorkspaceDirectory'
import { WorkspaceSwitchSupersededError } from '@/shared/workspaces/workspace-switch-error'

type TestInstance = { props: { onClick?: () => void } }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    root: { findAllByType(type: string): TestInstance[]; findAllByProps(props: Record<string, unknown>): unknown[] }
    unmount(): void
  }
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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.router.push.mockReset()
  mocks.onOpen.mockReset()
  mocks.switchWorkspace.mockReset()
  mocks.workspaceState = {
    workspaces: [workspace],
    invitations: [],
    createWorkspace: vi.fn(),
    switchWorkspace: mocks.switchWorkspace,
    refresh: vi.fn(),
  }
})

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

test('a superseded directory activation does not navigate or show an error', async () => {
  const activation = deferred<WorkspaceSummary>()
  mocks.switchWorkspace.mockReturnValue(activation.promise)
  await act(() => { renderer = create(<WorkspaceDirectory onOpen={mocks.onOpen} />) })

  const workspaceButton = renderer.root.findAllByType('button')[1]
  await act(async () => {
    workspaceButton.props.onClick?.()
    await Promise.resolve()
  })
  expect(mocks.switchWorkspace).toHaveBeenCalledWith(workspace.id)
  expect(mocks.router.push).not.toHaveBeenCalled()
  expect(mocks.onOpen).not.toHaveBeenCalled()

  await act(async () => {
    activation.reject(new WorkspaceSwitchSupersededError())
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(mocks.router.push).not.toHaveBeenCalled()
  expect(mocks.onOpen).not.toHaveBeenCalled()
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
})
