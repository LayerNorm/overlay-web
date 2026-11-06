import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeCollaborationContext, emptyNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { useNativeActivity, type NativeNotification, type UnreadCounts } from '@/components/providers/native-activity-context'
import { NativeActivityProvider } from './NativeActivityProvider'
import { nativeNotificationHref } from './native-notification-navigation'
import { observedRenderedSequence } from './native-room-read-markers'

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), http: vi.fn() }))
vi.mock('convex/react', () => ({
  useMutation: () => mocks.mutation,
  useQuery: (...args: unknown[]) => { mocks.query(...args); return counts },
  usePaginatedQuery: () => ({ results: items, status: 'Exhausted', loadMore() {} }),
  useQueries: () => ({ rooms: counts }),
}))
vi.mock('./NativeCollaborationProvider', async () => (await import('@/components/providers/native-collaboration-context')))
vi.mock('./NativeRoomState', () => ({ useNativeRoomMetadata: () => null }))
vi.mock('./NativeRoomScope', () => ({ useNativeRoomSession: () => null }))
vi.mock('@overlay/ui/primitives', () => ({ toast: { error() {} } }))
vi.mock('@/shared/app/overlay-app-client', () => ({ overlayAppClient: { conversations: { get: mocks.http } } }))

const room = 'room' as NativeNotification['conversationId']
const ready = { ...emptyNativeCollaboration, status: 'ready' as const, workspaceId: 'workspace', scopeKey: 'alice:workspace', viewerUserId: 'alice', isCurrentScope: () => true }
const bucket = (count: number) => ({ count, capped: false })
let counts: UnreadCounts
let items: NativeNotification[]
let value: ReturnType<typeof useNativeActivity>
let renderer: ReactTestRenderer | undefined
function Probe() { const next = useNativeActivity(); useLayoutEffect(() => { value = next }); return null }
function tree(native = ready) { return <NativeCollaborationContext.Provider value={native}><NativeActivityProvider><Probe /></NativeActivityProvider></NativeCollaborationContext.Provider> }
function deferred() {
  let resolve!: (value: unknown) => void; let reject!: (error: Error) => void
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  items = ['one', 'two'].map((id, i) => ({ id, workspaceId: 'workspace', viewerUserId: 'alice', recipientPrincipalId: 'alice', type: 'message', actorPrincipalId: 'bob', conversationId: room, title: id, createdAt: i + 1,
    destination: { conversationId: room, kind: 'direct', archived: false } }))
  counts = { workspaceId: 'workspace', viewerUserId: 'alice', notifications: bucket(2), rooms: bucket(1), byConversation: { [room]: bucket(2) }, byKind: { direct: bucket(2), channel: bucket(0), agentThread: bucket(0) }, observedThrough: 2 }
  mocks.mutation.mockResolvedValue(0)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })

it('an earlier failed read only removes its own overlay; a later success and canonical arrival survive', async () => {
  const first = deferred(); const later = deferred()
  mocks.mutation.mockReturnValueOnce(first.promise).mockReturnValueOnce(later.promise)
  await act(async () => { renderer = create(tree()) })
  let failed!: Promise<void>; let success!: Promise<void>
  await act(async () => { failed = value!.mark(['one'], 1).catch(() => {}); success = value!.mark(['two'], 2) })
  expect(value!.notifications.every(item => item.readAt !== undefined)).toBe(true)
  items = [items[0], { ...items[1], readAt: 9 }, { ...items[0], id: 'arrival', createdAt: 3 }]
  counts = { ...counts, notifications: bucket(2), byConversation: { [room]: bucket(2) }, byKind: { ...counts.byKind, direct: bucket(2) } }
  await act(async () => { renderer!.update(tree()); later.resolve(1); await success })
  await act(async () => { first.reject(new Error('denied')); await failed })
  expect(value!.notifications.map(item => [item.id, item.readAt !== undefined])).toEqual([['one', false], ['two', true], ['arrival', false]])
  expect(value!.counts?.notifications.count).toBe(2)
})

it('mark-all continues bounded pages with the same watermark and errors preserve canonical reads', async () => {
  mocks.mutation.mockResolvedValueOnce({ hasMore: true }).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { renderer = create(tree()) })
  await act(async () => { await value!.markAll(2).catch(() => {}) })
  expect(mocks.mutation.mock.calls.map(call => call[0])).toEqual([{ workspaceId: 'workspace', observedThrough: 2 }, { workspaceId: 'workspace', observedThrough: 2 }])
  expect(value!.notifications.every(item => item.readAt === undefined)).toBe(true)
})

it('room reads optimistically use the observed sequence and continue without advancing it', async () => {
  const first = deferred(); const later = deferred()
  mocks.mutation.mockReturnValueOnce(first.promise).mockReturnValueOnce(later.promise)
  await act(async () => { renderer = create(tree()) })
  let pending!: Promise<void>
  await act(async () => { pending = value!.markRoom(room, 20) })
  expect(value!.readSequence(room, 10)).toBe(20)
  expect(value!.counts?.notifications.count).toBe(0)
  await act(async () => { first.resolve({ sequence: 20, hasMore: true }) })
  expect(mocks.mutation.mock.calls.map(call => call[0].observedSequence)).toEqual([20, 20])
  items = items.map(item => ({ ...item, readAt: 9 }))
  counts = { ...counts, notifications: bucket(0), rooms: bucket(0), byConversation: { [room]: bucket(0) }, byKind: { ...counts.byKind, direct: bucket(0) } }
  await act(async () => { renderer!.update(tree()); later.resolve({ sequence: 20, hasMore: false }); await pending })
  expect(value!.counts?.notifications.count).toBe(0)
  expect(value!.readSequence(room, 20)).toBe(20)
})

it('empty and mismatched account results clear immediately; disabled mode never subscribes', async () => {
  await act(async () => { renderer = create(tree()) })
  await act(async () => { renderer!.update(tree({ ...ready, scopeKey: 'bob:workspace', viewerUserId: 'bob' })) })
  expect(value!.notifications).toEqual([]); expect(value!.counts).toBeNull()
  await act(async () => { renderer!.unmount() }); renderer = undefined
  mocks.query.mockClear()
  await act(async () => { renderer = create(tree({ ...ready, status: 'disabled' as never })) })
  expect(value).toBeNull(); expect(mocks.query).not.toHaveBeenCalled()
})

it('notification destinations select direct, channel, thread and archived routes without HTTP lookup', () => {
  for (const kind of ['direct', 'channel', 'agentThread'] as const) {
    const item = { ...items[0], destination: { conversationId: room, kind, agentId: kind === 'agentThread' ? 'native-agent:agent' : undefined, threadRootMessageId: 'root' as never, messageId: 'message' as never, archived: false } }
    const url = new URL(nativeNotificationHref(item), 'https://example.test')
    expect(url.searchParams.get('id')).toBe(room)
    expect(url.searchParams.get('thread')).toBe('root'); expect(url.searchParams.get('message')).toBe('message')
    if (kind === 'agentThread') { expect(url.pathname).toContain('/agents'); expect(url.searchParams.get('agent')).toBe('native-agent:agent') }
    else expect(url.searchParams.get('view')).toBe(kind === 'channel' ? 'channels' : 'dms')
  }
  expect(new URL(nativeNotificationHref({ ...items[0], destination: { ...items[0].destination, archived: true } }), 'https://example.test').pathname).toContain('/archived')
  expect(mocks.http).not.toHaveBeenCalled()
})

it('the visible read watermark ignores loaded rows outside the rendered viewport', () => {
  const node = (sequence: number, top: number, bottom: number) => ({ dataset: { roomEventSequence: String(sequence) }, getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) })
  const list = { getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => [node(10, -50, -10), node(20, 10, 50), node(30, 110, 140)] }
  expect(observedRenderedSequence(list as unknown as HTMLElement)).toBe(20)
  expect(observedRenderedSequence(null)).toBe(0)
})
