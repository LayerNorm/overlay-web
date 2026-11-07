import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect } from 'react'
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import type { OptimisticLocalStore } from 'convex/browser'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import type { WorkspaceClient, WorkspaceSummary } from '@/shared/workspaces/types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useCollaborationUnread } from '@/components/layout/sidebar/useSidebarEffects'
import { useReadMarkers } from '../DirectMessageExperience.hooks'
import { CollaborationRealtimeProvider, useCollaborationRealtime } from './CollaborationRealtimeProvider'
import { useRoomState } from './useRoomState'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
const noop = () => undefined
const fetchAccessToken = async () => 'fixture-token'
const useAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken })
const user = { id: 'member' }
const notificationsPath = 'collaboration/activity:notifications'
const roomPath = 'collaboration/rooms:state'

test('live onboarding room acknowledgements settle without restarting sidebar directory requests', async (t) => {
  let renderer: ReturnType<typeof create> | undefined
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { visibilityState: 'visible' }) })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  t.after(async () => {
    if (renderer) await act(async () => renderer!.unmount())
    await client.close()
    for (const [key, descriptor] of [['IS_REACT_ACT_ENVIRONMENT', previousAct], ['document', previousDocument], ['window', previousWindow]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  const client = new ConvexReactClient('https://fixture.convex.cloud')
  t.mock.method(client, 'setAuth', (_fetch, onChange) => onChange(true))
  t.mock.method(client, 'clearAuth', noop)
  const values = new Map<string, unknown>([
    [notificationsPath, [{ id: 'notification', conversationId: 'another-room', readAt: undefined }]],
    [roomPath, { participants: [] }],
  ])
  const listeners = new Map<string, Set<() => void>>()
  const publish = (path: string, value: unknown) => {
    values.set(path, value)
    for (const notify of listeners.get(path) ?? []) notify()
  }
  t.mock.method(client, 'watchQuery', (query) => {
    const path = getFunctionName(query)
    return {
      localQueryResult: () => values.get(path),
      localQueryLogs: () => undefined,
      journal: () => undefined,
      onUpdate: (notify: () => void) => {
        if (!listeners.has(path)) listeners.set(path, new Set())
        listeners.get(path)!.add(notify)
        return () => { listeners.get(path)!.delete(notify) }
      },
    } as ReturnType<ConvexReactClient['watchQuery']>
  })
  const store = {
    getQuery: (query: Parameters<typeof getFunctionName>[0]) => values.get(getFunctionName(query)),
    setQuery: (query: Parameters<typeof getFunctionName>[0], _args: unknown, value: unknown) => publish(getFunctionName(query), value),
    getAllQueries: () => [],
  } as unknown as OptimisticLocalStore
  const mutations: string[] = []
  const failures: unknown[] = []
  t.mock.method(client, 'mutation', async (query, args, options) => {
    const path = getFunctionName(query)
    mutations.push(path)
    if (mutations.length > 20) throw new Error('Read-marker feedback loop did not settle')
    options?.optimisticUpdate?.(store, args)
    if (path === 'collaboration/rooms:updateMyState') publish(roomPath, { participants: [] })
    return null
  })
  const directory = t.mock.method(overlayAppClient.conversations, 'getPage', async () => ({ data: [], hasMore: false }))
  const workspace: WorkspaceSummary = { id: 'workspace', name: 'Personal', slug: 'personal', kind: 'personal', status: 'active', role: 'owner' }
  const workspaceClient: WorkspaceClient = {
    list: async () => ({ workspaces: [workspace], activeWorkspaceId: workspace.id }),
    create: async () => { throw new Error('Not used') },
    activate: async () => { throw new Error('Not used') },
  }
  let current!: ReturnType<typeof useRoomState>
  let context!: ReturnType<typeof useCollaborationRealtime>
  let counts!: ReturnType<typeof useCollaborationUnread>
  function Probe({ conversationId }: { conversationId: string }) {
    const { activeWorkspaceId } = useWorkspace()
    const nextContext = useCollaborationRealtime()
    const nextRoom = useRoomState(activeWorkspaceId, conversationId)
    const nextCounts = useCollaborationUnread({ user, activeWorkspaceId, collaborationNotifications: nextContext.notifications })
    const { markVisibleRead } = useReadMarkers({ conversationId, room: nextRoom, markConversationRead: nextContext.markConversationRead })
    useEffect(() => {
      context = nextContext
      current = nextRoom
      counts = nextCounts
    }, [nextContext, nextRoom, nextCounts])
    useEffect(() => {
      void markVisibleRead().catch((error) => failures.push(error))
    }, [markVisibleRead])
    return null
  }
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'fixture' }
  const tree = (conversationId: string) => <AppRouterContext.Provider value={router}>
    <PathnameContext.Provider value="/app/work">
      <WorkspaceProvider client={workspaceClient}>
        <ConvexProviderWithAuth client={client} useAuth={useAuth}>
          <CollaborationRealtimeProvider><Probe conversationId={conversationId} /></CollaborationRealtimeProvider>
        </ConvexProviderWithAuth>
      </WorkspaceProvider>
    </PathnameContext.Provider>
  </AppRouterContext.Provider>
  await act(async () => { renderer = create(tree('onboarding-room')) })
  assert.deepEqual(failures, [])
  assert.deepEqual(mutations, ['collaboration/rooms:updateMyState', 'collaboration/activity:markRead'])
  const initialArgs = current.args
  const initialMarkRead = context.markConversationRead
  const initialRequests = directory.mock.callCount()
  assert.ok(initialRequests > 0 && initialRequests <= 2)
  for (let index = 0; index < 5; index++) {
    await act(async () => {
      publish(roomPath, { participants: [] })
      renderer!.update(tree('onboarding-room'))
    })
    assert.equal(current.args, initialArgs)
    assert.equal(context.markConversationRead, initialMarkRead)
  }
  assert.equal(mutations.length, 2)
  assert.equal(directory.mock.callCount(), initialRequests)
  await act(async () => publish(notificationsPath, []))
  assert.deepEqual(counts, { dms: 0, channels: 0, total: 0 })
  assert.equal(directory.mock.callCount(), initialRequests)
  await act(async () => renderer!.update(tree('different-room')))
  assert.equal(current.args?.conversationId, 'different-room')
  assert.equal(mutations.length, 4, 'changing rooms still acknowledges the newly opened room')
  directory.mock.mockImplementation(async () => { throw new Error('Directory temporarily unavailable') })
  await act(async () => publish(notificationsPath, [{ id: 'notification', conversationId: 'another-room' }]))
  assert.deepEqual(counts, { dms: 0, channels: 0, total: 1 })
  assert.equal(directory.mock.callCount(), initialRequests + 1)
  assert.equal(mutations.length, 4, 'failed directory requests do not restart read acknowledgements')
  assert.deepEqual(failures, [])
})
