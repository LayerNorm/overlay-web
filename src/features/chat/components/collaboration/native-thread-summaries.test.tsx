import { useLayoutEffect, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeCollaborationContext, emptyNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { useNativeThreadSummaries } from './useNativeThreadSummaries'
import { NativeRoomScope, useNativeRoomSession } from './NativeRoomScope'
import type { RoomMessageRecord } from './room-message-view'

vi.mock('./NativeCollaborationProvider', async () => await import('@/components/providers/native-collaboration-context'))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('./NativeRoomState', () => ({ NativeRoomStateProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./useNativeRoomTranscript', () => ({ useNativeRoomTranscript: (args: { threadRootMessageId?: string }) => ({
  rows: args.threadRootMessageId ? [] : [root('root')], status: 'ready', room: { conversationId: 'room', title: 'Room' }, hasMore: false, loadingMore: false, loadMore() {},
}) }))
let renderer: ReactTestRenderer | undefined
let value: ReturnType<typeof useNativeThreadSummaries>
let session: NonNullable<ReturnType<typeof useNativeRoomSession>>
let count: number
let text: string
let acknowledged: string[]
let latestNonce: string
let revoked: boolean
let receiptsLoading: boolean
let queryError: Error | undefined
const listeners = new Set<() => void>()
const watchQuery = vi.fn((_query: unknown, args: { rootMessageIds: string[]; pendingReplyNonces: string[] }) => ({
  localQueryResult: () => {
    if (queryError) throw queryError
    return revoked ? null : receiptsLoading && args.pendingReplyNonces.length ? undefined : { workspaceId: 'workspace', conversationId: 'room', viewerUserId: 'alice', acknowledgedReplyNonces: acknowledged,
    summaries: args.rootMessageIds.map(rootMessageId => ({ rootMessageId, replyCount: { count, capped: false }, latestReplyComplete: true,
      latestReply: count ? { id: 'latest', content: text, authorKind: 'human', authorPrincipalId: 'bob', createdAt: 2, clientNonce: latestNonce } : null })) }
  },
  onUpdate(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback) } }, journal: () => undefined,
}))
const client = { watchQuery } as unknown as ConvexReactClient
function root(id: string): RoomMessageRecord { return { id, turnId: id, authorKind: 'human', content: id, createdAt: 1 } }
function Probe({ roots, pending, panel }: { roots: RoomMessageRecord[]; pending: RoomMessageRecord[]; panel: boolean }) {
  const next = useNativeThreadSummaries('workspace', 'room', roots, pending)
  useLayoutEffect(() => { value = next })
  return <div data-panel={panel}>{next.replyCounts.get(roots[0]?.id)}:{next.threadTeasers.get(roots[0]?.id)?.content}</div>
}
function ScopeProbe() {
  const next = useNativeRoomSession()!
  useLayoutEffect(() => { session = next })
  return <div>{next.threadSummaries.replyCounts.get('root')}:{next.threadSummaries.threadTeasers.get('root')?.content}</div>
}
function tree(roots = [root('root')], pending: RoomMessageRecord[] = [], panel = false, enabled = true) {
  return <ConvexProvider client={client}><NativeCollaborationContext.Provider value={{ ...emptyNativeCollaboration, status: enabled ? 'ready' : 'loading', workspaceId: 'workspace', viewerUserId: 'alice', scopeKey: 'alice:workspace' }}>
    <Probe roots={roots} pending={pending} panel={panel} />
  </NativeCollaborationContext.Provider></ConvexProvider>
}
async function publish() { await act(async () => { for (const listener of listeners) listener() }) }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); count = 2; text = 'Latest reply'; latestNonce = 'other-nonce'; acknowledged = []; revoked = false; receiptsLoading = false; queryError = undefined })
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; listeners.clear(); vi.unstubAllGlobals() })

it('closed-panel observers retain subscribed counts/teasers across panel changes and remote new/edit/delete', async () => {
  await act(async () => { renderer = create(tree()) })
  expect(renderer!.toJSON()).toMatchObject({ children: ['2', ':', 'Latest reply'] })
  const subscriptions = listeners.size
  await act(async () => { renderer!.update(tree([root('root')], [], true)) })
  await act(async () => { renderer!.update(tree([root('root')], [], false)) })
  expect(listeners.size).toBe(subscriptions)
  expect(value.replyCounts.get('root')).toBe(2)
  count = 3; text = 'New reply'; await publish()
  expect(value.replyCounts.get('root')).toBe(3)
  text = 'Edited prefix'; await publish()
  expect(value.threadTeasers.get('root')?.content).toBe('Edited prefix')
  count = 0; await publish()
  expect(value.replyCounts.get('root')).toBe(0)
  expect(value.threadTeasers.has('root')).toBe(false)
  revoked = true; await publish()
  expect(value.replyCounts.size).toBe(0)
})

it('wires summaries into the native room session independently of actual thread selection', async () => {
  await act(async () => { renderer = create(<ConvexProvider client={client}>
    <NativeCollaborationContext.Provider value={{ ...emptyNativeCollaboration, status: 'ready', workspaceId: 'workspace', viewerUserId: 'alice', scopeKey: 'alice:workspace' }}>
      <NativeRoomScope conversationId="room"><ScopeProbe /></NativeRoomScope>
    </NativeCollaborationContext.Provider>
  </ConvexProvider>) })
  expect(renderer!.toJSON()).toMatchObject({ children: ['2', ':', 'Latest reply'] })
  const calls = watchQuery.mock.calls.length
  await act(async () => { session.root[1]('root') })
  expect(session.threadSummaries.replyCounts.get('root')).toBe(2)
  await act(async () => { session.root[1](null) })
  expect(session.threadSummaries.replyCounts.get('root')).toBe(2)
  expect(watchQuery.mock.calls.length).toBe(calls)
  expect(session.transcript.messages.filter(row => row.threadRootMessageId)).toEqual([])
})

it('counts only unacknowledged optimistic nonces, including acknowledgements older than the latest', async () => {
  const pending = [{ ...root('optimistic_nonce'), clientNonce: 'nonce', delivery: 'sending' as const, threadRootMessageId: 'root', createdAt: 3 }]
  await act(async () => { renderer = create(tree()) })
  receiptsLoading = true
  await act(async () => { renderer!.update(tree([root('root')], pending, true)) })
  expect(value.replyCounts.get('root')).toBe(2)
  receiptsLoading = false; await publish()
  expect(value.replyCounts.get('root')).toBe(3)
  count = 3; acknowledged = ['nonce']; latestNonce = 'nonce'; await publish()
  expect(value.replyCounts.get('root')).toBe(3)
  expect(value.threadTeasers.get('root')?.id).toBe('latest')
  count = 4; text = 'Later remote reply'; latestNonce = 'newer-remote-nonce'; await publish()
  expect(value.replyCounts.get('root')).toBe(4)
})

it('subscribes to every loaded root in stable batches beyond 100, and updates changed ids', async () => {
  const roots = Array.from({ length: 120 }, (_, i) => root(`root-${i}`))
  await act(async () => { renderer = create(tree(roots)) })
  expect(value.replyCounts.size).toBe(120)
  expect(listeners.size).toBe(2)
  const calls = watchQuery.mock.calls.length
  await act(async () => { renderer!.update(tree(roots.map(row => ({ ...row })), [], true)) })
  expect(watchQuery.mock.calls.length).toBe(calls)
  await act(async () => { renderer!.update(tree([...roots, root('extra')])) })
  expect(value.replyCounts.size).toBe(121)
})

it('settles an empty root list without a subscription', async () => {
  await act(async () => { renderer = create(tree([])) })
  expect(value.replyCounts.size).toBe(0)
  expect(watchQuery).not.toHaveBeenCalled()
})

it('does not subscribe before readiness and clears summaries when disabled', async () => {
  await act(async () => { renderer = create(tree([root('root')], [], false, false)) })
  expect(watchQuery).not.toHaveBeenCalled()
  await act(async () => { renderer!.update(tree()) })
  expect(value.replyCounts.get('root')).toBe(2)
  await act(async () => { renderer!.update(tree([root('root')], [], false, false)) })
  expect(value.replyCounts.size).toBe(0)
})

it('propagates subscription errors rather than reporting an exact zero', async () => {
  queryError = new Error('summary query failed')
  await expect(act(async () => { renderer = create(tree()) })).rejects.toThrow('summary query failed')
})
