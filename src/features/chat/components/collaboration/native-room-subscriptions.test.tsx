import { useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeCollaborationContext, emptyNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { NativeRoomStateProvider, useNativeRoomMetadata, type RoomState } from './NativeRoomState'
import { useNativePresence } from './useNativePresence'

const mocks = vi.hoisted(() => ({ query: vi.fn(), maps: vi.fn() }))
vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>()
  return { ...actual, useQuery: mocks.query, useQueries: (queries: Parameters<typeof actual.useQueries>[0]) => {
    mocks.maps(queries)
    return actual.useQueries(queries)
  } }
})
vi.mock('./NativeCollaborationProvider', async () => await import('@/components/providers/native-collaboration-context'))
vi.mock('@/components/providers/native-room-state-client', () => ({ useNativeRoomStateClient: () => ({}) }))

let renderer: ReactTestRenderer | undefined
let metadata: ReturnType<typeof useNativeRoomMetadata>
let visible: ReturnType<typeof useNativePresence>
let renders: number
const room = 'room'
const messages = ['message']
const state = { workspaceId: 'workspace', conversationId: room, viewerUserId: 'alice', viewerPrincipalId: 'alice', viewerState: {}, participants: [], pins: [], savedMessages: [], follows: [] } as unknown as RoomState
const reaction = { conversationId: room, messageId: 'message', emoji: '👍', principalIds: ['alice'] }
const sessions = [{ workspaceId: 'workspace', conversationId: room, principalId: 'bob', sessionId: 'tab', status: 'online', lastSeenAt: 100, expiresAt: Date.now() + 120_000 }]
let presenceRows = sessions
const subscribe = vi.fn(() => () => {})
const watchQuery = vi.fn((query: Parameters<typeof getFunctionName>[0]) => ({
  localQueryResult: () => getFunctionName(query).endsWith('watchPresence') ? presenceRows : [reaction],
  onUpdate: subscribe,
  journal: () => undefined,
}))
const client = { watchQuery } as unknown as ConvexReactClient
function MetadataProbe() { renders++; const next = useNativeRoomMetadata(); useLayoutEffect(() => { metadata = next }); return null }
function PresenceProbe({ enabled, conversationId = room }: { enabled: boolean; conversationId?: string }) {
  renders++; const next = useNativePresence('workspace', conversationId, enabled)
  useLayoutEffect(() => { visible = next }); return null
}
function roomTree(ids = messages, conversationId = room) {
  return <ConvexProvider client={client}><NativeCollaborationContext.Provider value={{ ...emptyNativeCollaboration, status: 'ready', viewerUserId: 'alice' }}>
    <NativeRoomStateProvider workspaceId="workspace" conversationId={conversationId} messageIds={ids}><MetadataProbe /></NativeRoomStateProvider>
  </NativeCollaborationContext.Provider></ConvexProvider>
}
function presenceTree(enabled: boolean, conversationId = room) { return <ConvexProvider client={client}><PresenceProbe enabled={enabled} conversationId={conversationId} /></ConvexProvider> }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.query.mockReturnValue(state); presenceRows = sessions; renders = 0 })
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })

it.each([{ ids: [] }, { ids: messages }])('settles real room subscriptions for message ids $ids and preserves equal-array query identity', async ({ ids }) => {
  await act(async () => { renderer = create(roomTree(ids)) })
  expect(metadata?.snapshot?.reactions).toHaveLength(ids.length)
  const maps = mocks.maps.mock.calls.slice(-2).map(([map]) => map)
  const subscriptions = subscribe.mock.calls.length
  await act(async () => { renderer!.update(roomTree([...ids])) })
  expect(mocks.maps.mock.calls.slice(-2).map(([map]) => map)).toEqual(maps)
  mocks.maps.mock.calls.slice(-2).forEach(([map], i) => expect(map).toBe(maps[i]))
  expect(subscribe).toHaveBeenCalledTimes(subscriptions)
  await act(async () => { renderer!.update(roomTree(['other-message'])) })
  expect(watchQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageIds: ['other-message'] }), {})
  expect(metadata?.snapshot?.reactions).toEqual([])
  expect(renders).toBeLessThan(15)
})

it('settles disabled reaction/presence subscriptions and rechecks changed room access', async () => {
  mocks.query.mockReturnValue(undefined)
  await act(async () => { renderer = create(roomTree()) })
  expect(watchQuery).not.toHaveBeenCalled()
  expect(metadata?.snapshot).toBeNull()
  const maps = mocks.maps.mock.calls.slice(-2).map(([map]) => map)
  await act(async () => { renderer!.update(roomTree([...messages])) })
  mocks.maps.mock.calls.slice(-2).forEach(([map], i) => expect(map).toBe(maps[i]))
  mocks.query.mockReturnValue(state)
  await act(async () => { renderer!.update(roomTree()) })
  expect(metadata?.snapshot?.conversationId).toBe(room)
  await act(async () => { renderer!.update(roomTree(messages, 'foreign-room')) })
  expect(metadata?.snapshot).toBeNull()
  expect(metadata?.presence).toEqual([])
})

it.each([{ enabled: false, rows: [] }, { enabled: true, rows: [] }, { enabled: true, rows: sessions }])('settles real presence subscriptions enabled=$enabled rows=$rows across unchanged and changed inputs', async ({ enabled, rows }) => {
  presenceRows = rows
  await act(async () => { renderer = create(presenceTree(enabled)) })
  expect(visible).toHaveLength(enabled ? rows.length : 0)
  const map = mocks.maps.mock.lastCall![0]
  const subscriptions = subscribe.mock.calls.length
  await act(async () => { renderer!.update(presenceTree(enabled)) })
  expect(mocks.maps.mock.lastCall![0]).toBe(map)
  expect(subscribe).toHaveBeenCalledTimes(subscriptions)
  await act(async () => { renderer!.update(presenceTree(true, 'other-room')) })
  expect(watchQuery).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'workspace', conversationId: 'other-room' }, {})
  await act(async () => { renderer!.update(presenceTree(false)) })
  expect(visible).toEqual([])
  expect(renders).toBeLessThan(15)
})
