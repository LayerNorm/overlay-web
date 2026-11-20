import React, { act, useEffect } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { CollaborationRealtimeProvider, useCollaborationRealtime } from './CollaborationRealtimeProvider'
import { useRoomState } from './useRoomState'

const mocks = vi.hoisted(() => ({ mutations: new Map<string, ReturnType<typeof vi.fn>>(), workspaceId: 'workspace' }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => ({ activeWorkspaceId: mocks.workspaceId }) }))
vi.mock('@/components/desktop/DesktopProvider', () => ({ useDesktopBridge: () => null }))
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: () => undefined,
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference)
    if (!mocks.mutations.has(name)) {
      const mutation = vi.fn(async () => null)
      Object.assign(mutation, { withOptimisticUpdate: () => (...args: unknown[]) => mutation(...args) })
      mocks.mutations.set(name, mutation)
    }
    return mocks.mutations.get(name)
  },
}))

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

afterEach(() => { vi.unstubAllGlobals(); mocks.mutations.clear(); mocks.workspaceId = 'workspace' })

test('read-marker effect inputs stay stable across live renders and change with the room', async () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  function Probe({ conversationId }: { conversationId: string }) {
    const { args, updateMyState } = useRoomState(mocks.workspaceId, conversationId)
    const { markConversationRead } = useCollaborationRealtime()
    useEffect(() => {
      if (!args) return
      void updateMyState({ ...args, markRead: true })
      markConversationRead(conversationId)
    }, [args, updateMyState, markConversationRead, conversationId])
    return null
  }
  const view = (conversationId: string) => <CollaborationRealtimeProvider><Probe conversationId={conversationId} /></CollaborationRealtimeProvider>
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(view('first')) })
  try {
    for (let i = 0; i < 3; i++) await act(() => renderer.update(view('first')))
    expect.soft(mocks.mutations.get('collaboration/rooms:updateMyState')).toHaveBeenCalledTimes(1)
    expect.soft(mocks.mutations.get('collaboration/activity:markRead')).toHaveBeenCalledTimes(1)
    await act(() => renderer.update(view('second')))
    expect.soft(mocks.mutations.get('collaboration/rooms:updateMyState')).toHaveBeenCalledTimes(2)
    expect.soft(mocks.mutations.get('collaboration/activity:markRead')).toHaveBeenLastCalledWith({ workspaceId: 'workspace', conversationId: 'second' })
    mocks.workspaceId = 'another-workspace'
    await act(() => renderer.update(view('second')))
    expect.soft(mocks.mutations.get('collaboration/rooms:updateMyState')).toHaveBeenCalledTimes(3)
    expect.soft(mocks.mutations.get('collaboration/rooms:updateMyState')).toHaveBeenLastCalledWith({ workspaceId: 'another-workspace', conversationId: 'second', markRead: true })
    expect.soft(mocks.mutations.get('collaboration/activity:markRead')).toHaveBeenLastCalledWith({ workspaceId: 'another-workspace', conversationId: 'second' })
  } finally { await act(() => renderer.unmount()) }
})
