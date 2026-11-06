import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configuration: { nativeAuthConfigured: true, hasConvexClient: true },
  workspace: { activeWorkspaceId: 'workspace', switchingWorkspaceId: null as string | null },
  user: { id: 'alice' },
  room: undefined as unknown,
  rows: [] as unknown[], lists: [] as unknown[], anchor: undefined as unknown,
  throwQuery: false,
  calls: vi.fn(), loadMore: vi.fn(), mutation: vi.fn(), addMessage: vi.fn(), legacyEdit: vi.fn(),
  query: vi.fn(), legacyCreateDirect: vi.fn(), legacyCreateChannel: vi.fn(),
}))
vi.mock('@/components/providers/ConvexAuthProvider', () => ({ useConvexAuthConfiguration: () => mocks.configuration }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => mocks.workspace }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/app/chat' }))
vi.mock('../DirectMessageExperience', () => ({ DirectMessageExperience: ({ conversationId }: { conversationId: string }) => <div>{conversationId}</div> }))
vi.mock('@/shared/app/overlay-app-client', () => ({ overlayAppClient: { conversations: {
  addMessage: mocks.addMessage, editCollaborativeMessage: mocks.legacyEdit,
  createWorkspaceDirectMessage: mocks.legacyCreateDirect, createWorkspaceChannel: mocks.legacyCreateChannel,
} } }))
vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server')
  return {
    useConvex: () => ({ query: mocks.query }),
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useMutation: () => mocks.mutation,
    useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
      mocks.calls(getFunctionName(fn), args)
      if (args === 'skip') return undefined
      return getFunctionName(fn).endsWith(':getRoom') ? mocks.room : mocks.anchor
    },
    usePaginatedQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
      const name = getFunctionName(fn)
      mocks.calls(name, args)
      if (mocks.throwQuery && args !== 'skip') throw new Error('native query failed')
      return { results: args === 'skip' ? [] : name.endsWith(':listRooms') ? mocks.lists : mocks.rows, status: 'Exhausted', loadMore: mocks.loadMore }
    },
  }
})
import { NativeCollaborationProvider, useNativeCollaboration } from './NativeCollaborationProvider'
import { NativeRoomScope, useNativeRoomSession } from './NativeRoomScope'
import { useRoomMessageWrites } from './native-room-adapters'
import { useNativeRoomLists } from './native-room-lists'
import { nativeRoomRouteKey } from './native-room-routing'
import { useRoomCreation } from './native-room-create'
import { NativeArchivedRoomEntry } from './NativeArchivedRoomEntry'
import { useSendMessage, type SendMessage } from '../DirectMessageExperience.hooks'

let renderer: ReactTestRenderer | undefined
let session: ReturnType<typeof useNativeRoomSession>
let status: ReturnType<typeof useNativeCollaboration>['status']
let send: SendMessage
let writes: ReturnType<typeof useRoomMessageWrites>
let list: ReturnType<typeof useNativeRoomLists>
let creation: ReturnType<typeof useRoomCreation>
function StatusProbe() {
  const next = useNativeCollaboration().status
  React.useLayoutEffect(() => { status = next })
  return null
}
function Probe({ sender = false }: { sender?: boolean }) {
  const nextSession = useNativeRoomSession()
  const nextStatus = useNativeCollaboration().status
  const nextList = useNativeRoomLists('dms')
  const nextWrites = useRoomMessageWrites('room')
  const nextCreation = useRoomCreation()
  React.useLayoutEffect(() => { session = nextSession; status = nextStatus; list = nextList; writes = nextWrites; creation = nextCreation })
  return sender ? <Sender /> : null
}
function Sender() {
  const current = useNativeRoomSession()!
  const transcript = current.transcript
  const nextSend = useSendMessage({
    canSendToThread: () => true, ensureCanSendToThread: async () => ({ accepted: true, status: 'writable' }),
    nativeThreadSafetyStatusValue: 'writable', selectedThreadSafetyStatus: 'writable', currentThreadRootId: null,
    currentPrincipalId: 'alice-p', conversationId: 'room', participants: [], conversationType: 'channel',
    loading: transcript.loading, conversationTitle: 'Room', soloAgentParticipant: null, messagesRef: transcript.messagesRef,
    memoryEnabled: false, convexRoomSubscriptionEnabled: false, loadMessages: transcript.loadMessages,
    commitDraftConversation() {}, setAgentResponding() {}, setConversationTitle() {},
    messages: transcript.messages, setMessages: transcript.setMessages, mentions: [],
  })
  React.useLayoutEffect(() => { send = nextSend })
  return null
}
const room = (id = 'room', workspaceId = 'workspace', viewerUserId = 'alice') => ({
  conversationId: id, workspaceId, viewerUserId, viewerPrincipalId: `${viewerUserId}-p`, title: 'Room', kind: 'direct',
  participants: [], lastModified: 1, createdAt: 1, updatedAt: 1,
})
const message = (id: string, conversationId = 'room', threadRootMessageId?: string, clientNonce?: string) => ({
  id, conversationId, threadRootMessageId, clientNonce, turnId: `turn-${id}`, role: 'user', authorKind: 'human',
  content: id, partsJson: '[]', agentPlanJson: '[]', createdAt: 1,
})
const tree = (conversationId = 'room', backendReady = true, sender = false) => <NativeCollaborationProvider backendReady={backendReady}>
  <StatusProbe />
  <NativeRoomScope conversationId={conversationId}><Probe sender={sender} /></NativeRoomScope>
</NativeCollaborationProvider>
async function render(element = tree()) {
  await act(async () => { if (renderer) renderer.update(element); else renderer = create(element) })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const storage = { getItem: () => null, setItem() {}, removeItem() {} }
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage, sessionStorage: storage, setTimeout, clearTimeout }))
  mocks.workspace.activeWorkspaceId = 'workspace'
  mocks.workspace.switchingWorkspaceId = null
  mocks.user.id = 'alice'
  mocks.configuration.nativeAuthConfigured = true
  mocks.configuration.hasConvexClient = true
  mocks.throwQuery = false
  mocks.room = room()
  mocks.rows = [message('first')]
  mocks.lists = [{ conversationId: 'room', workspaceId: 'workspace', title: 'Room', kind: 'direct', lastModified: 1 }]
  mocks.anchor = undefined
  mocks.mutation.mockResolvedValue(true)
  session = null
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each(['workspace', 'room', 'account'] as const)('scope switch %s synchronously rejects previous scope data', async scope => {
  await render()
  expect(session?.transcript.messages.map(row => row.id)).toEqual(['first'])
  if (scope === 'workspace') mocks.workspace.activeWorkspaceId = 'other-workspace'
  if (scope === 'account') mocks.user.id = 'bob'
  await render(tree(scope === 'room' ? 'other-room' : 'room'))
  expect(session?.transcript.messages ?? []).toEqual([])
})

test('thread switches discard previous replies and their pending overlays', async () => {
  await render()
  await act(async () => session!.root[1]('root-a'))
  mocks.rows = [message('reply-a', 'room', 'root-a')]
  await render()
  expect(session!.transcript.messages.map(row => row.id)).toEqual(['reply-a'])
  await act(async () => session!.transcript.setMessages(current => [...current, { id: 'optimistic_pending', turnId: 'pending', authorKind: 'human', content: 'pending', createdAt: 2, threadRootMessageId: 'root-a' }]))
  const oldSetter = session!.transcript.setMessages
  await act(async () => session!.root[1]('root-b'))
  expect(session!.transcript.messages).toEqual([])
  await act(async () => session!.transcript.setMessages([{ id: 'optimistic_next', turnId: 'next', authorKind: 'human', content: 'next', createdAt: 2, threadRootMessageId: 'root-b' }]))
  await act(async () => oldSetter([]))
  expect(session!.transcript.messages.map(row => row.id)).toEqual(['optimistic_next'])
})

test('revoked/null detail clears canonical and pending transcript immediately', async () => {
  await render()
  await act(async () => session!.transcript.setMessages(current => [...current, { id: 'optimistic_failed', turnId: 'pending', authorKind: 'human', content: 'pending', createdAt: 2 }]))
  mocks.room = null
  await render()
  expect(renderer!.toJSON()).toMatchObject({ props: { role: 'status' }, children: ['This conversation is unavailable.'] })
  expect(mocks.calls.mock.calls.filter(([name, args]) => name.endsWith(':listMessages') && args === 'skip').length).toBeGreaterThan(0)
  mocks.room = room()
  await render()
  expect(session!.transcript.messages.map(row => row.id)).toEqual(['first'])
})

test('retry reuses nonce and turn, then canonical subscription replaces pending without a duplicate', async () => {
  mocks.rows = []
  mocks.addMessage.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ messageId: 'canonical' })
  await render(tree('room', true, true))
  await act(async () => { expect((await send('hello')).accepted).toBe(false) })
  const failed = session!.transcript.messages[0]
  expect(failed.delivery).toBe('failed')
  await act(async () => { expect((await send('hello', { existing: failed })).accepted).toBe(true) })
  expect(mocks.addMessage.mock.calls[1][0]).toMatchObject({ clientNonce: mocks.addMessage.mock.calls[0][0].clientNonce, turnId: mocks.addMessage.mock.calls[0][0].turnId })
  mocks.rows = [message('canonical', 'room', undefined, failed.clientNonce)]
  await render(tree('room', true, true))
  expect(session!.transcript.messages.map(row => row.id)).toEqual(['canonical'])
})

test('disabled retains legacy adapters without any native query or mutation', async () => {
  mocks.legacyEdit.mockResolvedValue(true)
  await render(tree('room', false))
  expect(status).toBe('disabled')
  expect(session).toBeNull()
  await writes.edit('message', 'edited')
  mocks.legacyCreateDirect.mockResolvedValue({ directMessage: { conversationId: 'legacy' } })
  mocks.legacyCreateChannel.mockResolvedValue({ channel: { conversationId: 'legacy-channel' } })
  await creation.direct('workspace', { principalIds: ['bob'] })
  await creation.channel('workspace', { name: 'Legacy', visibility: 'public' })
  expect(mocks.legacyCreateDirect).toHaveBeenCalledWith('workspace', { principalIds: ['bob'] })
  expect(mocks.legacyCreateChannel).toHaveBeenCalledWith('workspace', { name: 'Legacy', visibility: 'public' })
  expect(mocks.legacyEdit).toHaveBeenCalledWith('room', 'message', 'edited')
  expect(mocks.calls).not.toHaveBeenCalled()
  expect(mocks.mutation).not.toHaveBeenCalled()
  expect(nativeRoomRouteKey('disabled', 'dms', { pathScope: 'workspace', conversationId: 'room' })).not.toBeNull()
})

test('native edits and deletes never use legacy mutations or HTTP reloads', async () => {
  await render()
  await writes.edit('message', 'edited')
  await writes.remove('message')
  expect(mocks.mutation.mock.calls).toEqual([
    [{ workspaceId: 'workspace', conversationId: 'room', messageId: 'message', content: 'edited' }],
    [{ workspaceId: 'workspace', conversationId: 'room', messageId: 'message' }],
  ])
  expect(mocks.legacyEdit).not.toHaveBeenCalled()
  expect(nativeRoomRouteKey('ready', 'dms', { pathScope: 'workspace', conversationId: 'room' })).toBeNull()
})

test('native creates use mutations and failed admission never retries through legacy', async () => {
  mocks.mutation.mockResolvedValue({ conversationId: 'created' })
  mocks.query.mockResolvedValue(room('created'))
  await render()
  expect(await creation.direct('workspace', { principalIds: ['bob'] })).toMatchObject({ directMessage: { conversationId: 'created', title: 'Room' } })
  expect(await creation.channel('workspace', { name: 'Native', visibility: 'private' })).toMatchObject({ channel: { conversationId: 'created', name: 'Native' } })
  expect(mocks.mutation).toHaveBeenCalledWith({ workspaceId: 'workspace', name: 'Native', visibility: 'private' })
  mocks.mutation.mockRejectedValueOnce(new Error('access denied'))
  await expect(creation.channel('workspace', { name: 'Denied', visibility: 'private' })).rejects.toThrow('access denied')
  expect(mocks.legacyCreateDirect).not.toHaveBeenCalled()
  expect(mocks.legacyCreateChannel).not.toHaveBeenCalled()
})

test('empty native room lists and transcripts settle ready', async () => {
  mocks.lists = []
  mocks.rows = []
  await render()
  expect(status).toBe('ready')
  expect(list.rows).toEqual([])
  expect(session!.transcript.messages).toEqual([])
  expect(session!.transcript.loading).toBe(false)
})

test('configured native mode without a client is unavailable, never legacy', async () => {
  mocks.configuration.hasConvexClient = false
  await render()
  expect(status).toBe('unavailable')
  expect(mocks.calls).not.toHaveBeenCalled()
})

test('exact archived native entry bypasses personal/legacy loading, including rooms outside loaded lists', async () => {
  mocks.room = { ...room(), archivedAt: 1 }
  await render(<NativeCollaborationProvider backendReady><NativeArchivedRoomEntry conversationId="room" personalFallback={<div>personal</div>} /></NativeCollaborationProvider>)
  expect(renderer!.toJSON()).toMatchObject({ children: ['room'] })
  mocks.room = { ...room('other'), archivedAt: 1 }
  await render(<NativeCollaborationProvider backendReady><NativeArchivedRoomEntry conversationId="room" personalFallback={<div>personal</div>} /></NativeCollaborationProvider>)
  expect(renderer!.toJSON()).toMatchObject({ children: ['This archived conversation is unavailable.'] })
})

test('non-room archived entry preserves personal ownership; pending query never renders the personal fallback', async () => {
  mocks.room = undefined
  const archived = () => <NativeCollaborationProvider backendReady><NativeArchivedRoomEntry conversationId="room" personalFallback={<div>personal</div>} /></NativeCollaborationProvider>
  await render(archived())
  expect(renderer!.toJSON()).toMatchObject({ children: ['Loading archived conversation…'] })
  mocks.room = null
  await render(archived())
  expect(renderer!.toJSON()).toMatchObject({ children: ['personal'] })
})

test('ready then query error becomes sticky unavailable with no legacy fallback', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await render()
  expect(status).toBe('ready')
  mocks.throwQuery = true
  await render()
  expect(renderer!.toJSON()).toMatchObject({ children: ['This conversation is unavailable.'] })
  expect(status).toBe('unavailable')
  mocks.throwQuery = false
  await render()
  expect(renderer!.toJSON()).toMatchObject({ children: ['This conversation is unavailable.'] })
  expect(mocks.legacyEdit).not.toHaveBeenCalled()
})

test('loss of readiness after activation cannot silently return to legacy', async () => {
  await render()
  expect(status).toBe('ready')
  mocks.calls.mockClear()
  await render(tree('room', false))
  expect(renderer!.toJSON()).toMatchObject({ children: ['This conversation is unavailable.'] })
  expect(mocks.calls).not.toHaveBeenCalled()
})

test('native list ownership filters legacy rows and never retains them when unavailable', async () => {
  await render()
  expect(list.merge([{ _id: 'stale-room', conversationType: 'dm' }]).map(row => row._id)).toEqual(['room'])
  expect(list.suppressLegacy(false)).toBe(true)
  expect(list.rows).toHaveLength(1)
})
