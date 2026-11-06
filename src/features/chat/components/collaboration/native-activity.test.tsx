import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useLayoutEffect } from 'react'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeCollaborationContext, emptyNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { useNativeActivity, type NativeNotification, type UnreadCounts } from '@/components/providers/native-activity-context'
import { NativeActivityProvider } from './NativeActivityProvider'
import { nativeNotificationHref } from './native-notification-navigation'
import { observedRenderedSequence } from './native-room-read-markers'
import { useObservedNotificationReads } from './useObservedNotificationReads'

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), http: vi.fn(), toastError: vi.fn(), realQueries: false }))
vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>()
  return {
    ConvexProvider: actual.ConvexProvider,
    useMutation: () => mocks.mutation,
    useQuery: (...args: unknown[]) => { mocks.query(...args); return counts },
    usePaginatedQuery: () => ({ results: items, status: 'Exhausted', loadMore() {} }),
    useQueries: (queries: Parameters<typeof actual.useQueries>[0]) => mocks.realQueries ? actual.useQueries(queries) : { rooms: counts },
  }
})
vi.mock('./NativeCollaborationProvider', async () => (await import('@/components/providers/native-collaboration-context')))
vi.mock('./NativeRoomState', () => ({ useNativeRoomMetadata: () => null }))
vi.mock('./NativeRoomScope', () => ({ useNativeRoomSession: () => null }))
vi.mock('@overlay/ui/primitives', () => ({ toast: { error: mocks.toastError } }))
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
  mocks.realQueries = false
  items = ['one', 'two'].map((id, i) => ({ id, workspaceId: 'workspace', viewerUserId: 'alice', recipientPrincipalId: 'alice', type: 'message', actorPrincipalId: 'bob', conversationId: room, title: id, createdAt: i + 1,
    destination: { conversationId: room, kind: 'direct', archived: false } }))
  counts = { workspaceId: 'workspace', viewerUserId: 'alice', notifications: bucket(2), rooms: bucket(1), byConversation: { [room]: bucket(2) }, byKind: { direct: bucket(2), channel: bucket(0), agentThread: bucket(0) }, observedThrough: 2 }
  mocks.mutation.mockResolvedValue(0)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })

it.each(['ready', 'loading', 'unavailable'] as const)('settles native activity with the real Convex subscription when %s', async (status) => {
  mocks.realQueries = true
  const client = {} as ConvexReactClient
  await act(async () => { renderer = create(<ConvexProvider client={client}>{tree({ ...ready, status })}</ConvexProvider>) })
  expect(value.status).toBe(status)
  expect(value.ready).toBe(status === 'ready')
  expect(mocks.query.mock.calls.length).toBeLessThan(10)
})

it('updates real Convex room subscriptions when the native scope and room list change', async () => {
  mocks.realQueries = true
  const watchQuery = vi.fn(() => ({ localQueryResult: () => counts, onUpdate: () => () => {}, journal: () => undefined }))
  const client = { watchQuery } as unknown as ConvexReactClient
  const rows = [{ conversationId: room }] as typeof ready.direct.rows
  const native = { ...ready, direct: { ...ready.direct, rows } }
  await act(async () => { renderer = create(<ConvexProvider client={client}>{tree(native)}</ConvexProvider>) })
  expect(value.counts?.byConversation[room]).toEqual(bucket(2))
  expect(watchQuery).toHaveBeenLastCalledWith(expect.anything(), { workspaceId: 'workspace', conversationIds: [room] }, {})
  const other = 'other-room' as typeof room
  await act(async () => { renderer!.update(<ConvexProvider client={client}>{tree({ ...native, workspaceId: 'other-workspace', direct: { ...native.direct, rows: [{ conversationId: other }] as typeof rows } })}</ConvexProvider>) })
  expect(watchQuery).toHaveBeenLastCalledWith(expect.anything(), { workspaceId: 'other-workspace', conversationIds: [other] }, {})
  expect(value.counts).toBeNull()
  expect(mocks.query.mock.calls.length).toBeLessThan(10)
})

it('propagates real Convex room query errors without a render loop', async () => {
  mocks.realQueries = true
  const client = { watchQuery: () => ({ localQueryResult() { throw new Error('room query failed') }, onUpdate: () => () => {}, journal: () => undefined }) } as unknown as ConvexReactClient
  const native = { ...ready, direct: { ...ready.direct, rows: [{ conversationId: room }] as typeof ready.direct.rows } }
  await expect(act(async () => { renderer = create(<ConvexProvider client={client}>{tree(native)}</ConvexProvider>) })).rejects.toThrow('room query failed')
  expect(mocks.query.mock.calls.length).toBeLessThan(10)
})

it('observes only intersecting rendered rows in a visible document and retries failed reads', async () => {
  const document = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
  vi.stubGlobal('document', document)
  const nodes = Array.from({ length: 50 }, (_, i) => ({ dataset: { notificationId: String(i) } }))
  let intersect!: (entries: unknown[]) => void
  const observe = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe = observe
    disconnect() {}
  })
  const mark = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const native = { ready: true, counts, notifications: Array.from({ length: 100 }, (_, i) => ({ ...items[0], id: String(i), createdAt: i + 1 })), mark } as unknown as NonNullable<typeof value>
  function Observer() {
    const ref = useObservedNotificationReads(native, nodes.map(node => node.dataset.notificationId))
    return <ul ref={ref} />
  }
  await act(async () => { renderer = create(<Observer />, { createNodeMock: () => ({ querySelectorAll: () => nodes }) }) })
  expect(observe).not.toHaveBeenCalled()
  expect(mark).not.toHaveBeenCalled()
  document.visibilityState = 'visible'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(observe).toHaveBeenCalledTimes(50)
  await act(async () => { intersect([
    { target: nodes[0], isIntersecting: true, intersectionRatio: 1 },
    { target: nodes[1], isIntersecting: false, intersectionRatio: 0 },
  ]) })
  expect(mark).toHaveBeenCalledWith(['0'], 1)
  expect(mocks.toastError).toHaveBeenCalledTimes(1)
  await act(async () => { mocks.toastError.mock.calls[0][1].action.onClick() })
  expect(mark).toHaveBeenCalledTimes(2)
  document.visibilityState = 'hidden'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); intersect([{ target: nodes[2], isIntersecting: true, intersectionRatio: 1 }]) })
  expect(mark).toHaveBeenCalledTimes(2)
  expect(mark.mock.calls.every(([ids]) => !ids.includes('99') && !ids.includes('1') && !ids.includes('2'))).toBe(true)
  native.notifications = [{ ...items[0], id: 'arrival', createdAt: 101 }, ...native.notifications]
  nodes[0] = { dataset: { notificationId: 'arrival' } }
  await act(async () => { renderer!.update(<Observer />) })
  expect(mark).toHaveBeenCalledTimes(2)
  document.visibilityState = 'visible'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); intersect([{ target: nodes[0], isIntersecting: false, intersectionRatio: 0 }]) })
  expect(mark).toHaveBeenCalledTimes(2)
  await act(async () => { intersect([{ target: nodes[0], isIntersecting: true, intersectionRatio: 1 }]) })
  expect(mark).toHaveBeenLastCalledWith(['arrival'], 101)
})

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
