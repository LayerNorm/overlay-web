import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { NativeCollaborationContext, emptyNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { NativeRoomArchiveOverlayProvider, archiveOverlayRows, useRoomArchiveOverlays } from '@/components/providers/native-room-archive-overlays'
import { NativeRoomStateProvider, useNativeRoomMetadata, type RoomSnapshot, type RoomState } from './NativeRoomState'
import { useRoomActions } from './room-lifecycle-actions'
import { useRoomApi } from './room-state-adapters'

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), announce: vi.fn(), error: vi.fn(), success: vi.fn(), push: vi.fn(), archived: vi.fn(), modified: vi.fn(), legacyPins: vi.fn(), report: vi.fn() }))
vi.mock('convex/react', () => ({
  useMutation: () => mocks.mutation,
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore() {} }),
  useQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined
    const name = getFunctionName(query as never)
    if (name.endsWith(':getRoomState')) return state
    if (name.endsWith(':watchPresence')) return presence
    throw new Error(`Unexpected query ${name}`)
  },
  useQueries: (queries: Record<string, unknown>) => Object.fromEntries(Object.keys(queries).map(key => [key, reactions])),
}))
vi.mock('./NativeCollaborationProvider', async () => {
  const context = await import('@/components/providers/native-collaboration-context')
  return { useNativeCollaboration: context.useNativeCollaboration }
})
vi.mock('@/shared/app/archive-toast', () => ({ announceArchived: mocks.announce }))
vi.mock('@/hooks/use-workspace-href', () => ({ useWorkspaceHref: () => (_workspace: unknown, href: string) => href }))
vi.mock('@/shared/chat/chat-title', () => ({ dispatchChatArchived: mocks.archived, dispatchChatModified: mocks.modified }))
vi.mock('@overlay/ui/primitives', () => ({ toast: { error: mocks.error, success: mocks.success } }))
vi.mock('@/shared/app/overlay-app-client', () => {
  class LegacyClient {
    #marker = 'legacy'
    pins = mocks.legacyPins
    reportMessage(...args: unknown[]) { return mocks.report(this.#marker, ...args) }
  }
  return { overlayAppClient: { conversations: new LegacyClient() } }
})

const room = 'room' as RoomState['conversationId']
const message = 'message' as RoomSnapshot['reactions'][number]['messageId']
const ready = { ...emptyNativeCollaboration, status: 'ready' as const, workspaceId: 'workspace', scopeKey: 'alice:workspace', viewerUserId: 'alice',
  isCurrentScope: () => true, client: { mutation: mocks.mutation } as never }
let state: RoomState | null
let reactions: RoomSnapshot['reactions']
let presence: Array<{ workspaceId: string; conversationId: typeof room; principalId: string; sessionId: string; status: 'online'; lastSeenAt: number; expiresAt: number; typingExpiresAt: number }>
let owner: ReturnType<typeof useNativeRoomMetadata>
let actions: ReturnType<typeof useRoomActions>
let roomApi: ReturnType<typeof useRoomApi>
let summary: { conversationId: typeof room; workspaceId: string; title: string; kind: 'direct'; lastModified: number; archivedAt?: number }
let archivedIds: string[]
let renderer: ReactTestRenderer | undefined

function Probe() {
  const value = useNativeRoomMetadata()
  const api = useRoomApi(room)
  const next = useRoomActions({ conversationId: room, conversationType: 'dm', title: 'Room', activeWorkspaceId: 'workspace',
    router: { push: mocks.push } as never, otherParticipantsCount: 1, currentParticipantArchived: value?.snapshot?.viewerState.archivedAt !== undefined,
    loadParticipants: async () => {}, setMenuOpen() {} })
  useLayoutEffect(() => { owner = value; actions = next; roomApi = api; return () => { owner = null } })
  return null
}
function ArchiveProbe() {
  const { entries } = useRoomArchiveOverlays()
  const rows = archiveOverlayRows(summary.archivedAt === undefined ? [summary] : [], summary.archivedAt === undefined ? [] : [summary], entries, true)
  useLayoutEffect(() => { archivedIds = rows.map(row => row.conversationId) })
  return null
}
function tree(show = true, id = room) {
  return <NativeCollaborationContext.Provider value={ready}><NativeRoomArchiveOverlayProvider><ArchiveProbe />
    {show ? <NativeRoomStateProvider key={id} workspaceId="workspace" conversationId={id} messageIds={[message]}><Probe /></NativeRoomStateProvider> : <div>Another destination</div>}
  </NativeRoomArchiveOverlayProvider></NativeCollaborationContext.Provider>
}
function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function reaction(principalIds: string[]) {
  return [{ conversationId: room, messageId: message, emoji: '👍', principalIds, count: principalIds.length, reactedByCurrentPrincipal: principalIds.includes('alice') }]
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(100_000)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { location: { pathname: '/app/chat', search: '?id=room' } })
  state = { workspaceId: 'workspace', conversationId: room, viewerUserId: 'alice', viewerPrincipalId: 'alice', viewerState: { notificationLevel: 'all' },
    participants: [{ workspaceId: 'workspace', conversationId: room, principalId: 'alice', principalType: 'human', displayName: 'Alice', role: 'moderator', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 }],
    pins: [], pinsCapped: false, follows: [], savedMessages: [] }
  reactions = reaction(['bob']); presence = []
  summary = { conversationId: room, workspaceId: 'workspace', title: 'Room', kind: 'direct', lastModified: 1 }
  mocks.mutation.mockResolvedValue(null)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('native room metadata owner', () => {
  it('preserves prototype-based legacy moderation intake on the native path', async () => {
    await act(async () => { renderer = create(tree()) })
    await roomApi.reportMessage(room, { messageId: message, reason: 'spam' })
    expect(mocks.report).toHaveBeenCalledWith('legacy', room, { messageId: message, reason: 'spam' })
  })
  it('typing expires on the client clock without a database write', async () => {
    presence = [{ workspaceId: 'workspace', conversationId: room, principalId: 'bob', sessionId: 'tab', status: 'online', lastSeenAt: 100_000, expiresAt: 220_000, typingExpiresAt: 106_000 }]
    await act(async () => { renderer = create(tree()) })
    expect(owner?.presence[0].typing).toBe(true)
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(owner?.presence[0].typing).toBe(false)
    expect(owner?.presence[0].status).toBe('online')
    expect(mocks.mutation).not.toHaveBeenCalled()
    expect(presence[0].typingExpiresAt).toBe(106_000)
  })

  it('sessions expire without any subsequent database write', async () => {
    presence = [{ workspaceId: 'workspace', conversationId: room, principalId: 'bob', sessionId: 'tab', status: 'online', lastSeenAt: 100_000, expiresAt: 220_000, typingExpiresAt: 106_000 }]
    await act(async () => { renderer = create(tree()) })
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(owner?.presence).toEqual([])
    expect(mocks.mutation).not.toHaveBeenCalled()
  })

  it('a newer tab keeps a participant online after another session expires', async () => {
    const base = { workspaceId: 'workspace', conversationId: room, principalId: 'bob', status: 'online' as const, typingExpiresAt: 106_000 }
    presence = [{ ...base, sessionId: 'old', lastSeenAt: 90_000, expiresAt: 210_000 }, { ...base, sessionId: 'new', lastSeenAt: 100_000, expiresAt: 220_000 }]
    await act(async () => { renderer = create(tree()) })
    expect(owner?.presence[0].lastSeenAt).toBe(100_000)
    await act(async () => { vi.advanceTimersByTime(110_000) })
    expect(owner?.presence).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(owner?.presence).toEqual([])
    expect(mocks.mutation).not.toHaveBeenCalled()
  })

  it('an earlier rejected reaction removes only its own overlay, retaining later intent and canonical changes', async () => {
    const earlier = deferred(); const later = deferred()
    mocks.mutation.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
    await act(async () => { renderer = create(tree()) })
    let first!: Promise<unknown>; let second!: Promise<unknown>
    await act(async () => {
      first = owner!.act({ kind: 'setReaction', messageId: message, emoji: '👍', enabled: true }).catch(() => {})
      second = owner!.act({ kind: 'setReaction', messageId: message, emoji: '👍', enabled: true })
    })
    reactions = reaction(['bob', 'charlie'])
    await act(async () => { renderer!.update(tree()); earlier.reject(new Error('Rejected')); await first })
    expect(owner?.snapshot?.reactions[0]).toMatchObject({ count: 3, reactedByCurrentPrincipal: true })
    reactions = reaction(['bob', 'charlie', 'alice'])
    await act(async () => { renderer!.update(tree()); later.resolve(null); await second })
    expect(owner?.snapshot?.reactions[0].principalIds).toEqual(['bob', 'charlie', 'alice'])
    expect(getFunctionName(mocks.mutation.mock.calls[0][0])).toBe('collaboration/nativeRoomState:setReaction')
  })

  it('archive and Undo move the shared list overlay without navigating after leaving the room', async () => {
    const archive = deferred(); const restore = deferred()
    mocks.mutation.mockReturnValueOnce(archive.promise).mockReturnValueOnce(restore.promise)
    await act(async () => { renderer = create(tree()) })
    let operation!: Promise<void>
    await act(async () => { operation = actions.archiveConversation('self') })
    expect(archivedIds).toEqual([room])
    expect(owner?.snapshot?.viewerState.archivedAt).toBe(100_000)
    state = { ...state!, viewerState: { notificationLevel: 'all', archivedAt: 100_000 }, participants: state!.participants.map(row => ({ ...row, archivedAt: 100_000 })) }
    summary = { ...summary, archivedAt: 100_000 }
    await act(async () => { renderer!.update(tree()); archive.resolve(null); await operation })
    const undo = mocks.announce.mock.calls[0][0].undo as () => Promise<void>
    await act(async () => { renderer!.update(tree(false)) })
    window.location.search = '?id=another'
    let undone!: Promise<void>
    await act(async () => { undone = undo() })
    expect(archivedIds).toEqual([])
    summary = { ...summary, archivedAt: undefined }
    await act(async () => { renderer!.update(tree(false)); restore.resolve(null); await undone })
    expect(mocks.mutation.mock.calls[1][1]).toMatchObject({ conversationId: room, archived: false, scope: 'self' })
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.archived).not.toHaveBeenCalled(); expect(mocks.modified).not.toHaveBeenCalled()
  })

  it('scope mismatches and revoked/null results clear metadata instead of retaining the previous room', async () => {
    await act(async () => { renderer = create(tree()) })
    expect(owner?.snapshot?.conversationId).toBe(room)
    await act(async () => { renderer!.update(tree(true, 'other' as typeof room)) })
    expect(owner?.snapshot).toBeNull()
    state = null
    await act(async () => { renderer!.update(tree()) })
    expect(owner).toBeNull()
    expect(renderer!.toJSON()).toMatchObject({ type: 'div', children: ['This conversation is unavailable.'] })
  })

  it('disabled room adapters retain the legacy client without native writes', async () => {
    let legacyApi: ReturnType<typeof useRoomApi>
    function LegacyProbe() { const value = useRoomApi(room); useLayoutEffect(() => { legacyApi = value }); return null }
    await act(async () => { renderer = create(<LegacyProbe />) })
    await legacyApi!.pins(room)
    expect(mocks.legacyPins).toHaveBeenCalledWith(room)
    expect(mocks.mutation).not.toHaveBeenCalled()
  })
})
