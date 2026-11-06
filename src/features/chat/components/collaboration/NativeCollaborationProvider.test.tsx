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
  execution: undefined as unknown, pageStatus: 'Exhausted', directory: [] as unknown[], directoryMode: 'native',
  mainMore: vi.fn(), replyMore: vi.fn(), httpGet: vi.fn(), directoryGet: vi.fn(),
  calls: vi.fn(), loadMore: vi.fn(), mutation: vi.fn(), addMessage: vi.fn(), legacyEdit: vi.fn(),
  query: vi.fn(), legacyCreateDirect: vi.fn(), legacyCreateChannel: vi.fn(),
  legacyDelete: vi.fn(), legacyParticipantUpdate: vi.fn(),
}))
vi.mock('@/components/providers/ConvexAuthProvider', () => ({ useConvexAuthConfiguration: () => mocks.configuration }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => mocks.workspace }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/components/providers/AgentDirectoryProvider', () => ({ useAgentDirectory: () => ({ mode: mocks.directoryMode, workspaceId: mocks.workspace.activeWorkspaceId, directory: mocks.directory }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/app/chat' }))
vi.mock('../DirectMessageExperience', () => ({ DirectMessageExperience: ({ conversationId }: { conversationId: string }) => <div>{conversationId}</div> }))
vi.mock('@/shared/app/overlay-app-client', () => ({ overlayAppClient: { conversations: {
  get: mocks.httpGet,
  deleteResponse: mocks.legacyDelete, updateParticipantState: mocks.legacyParticipantUpdate,
  addMessage: mocks.addMessage, editCollaborativeMessage: mocks.legacyEdit,
  createWorkspaceDirectMessage: mocks.legacyCreateDirect, createWorkspaceChannel: mocks.legacyCreateChannel,
}, agents: { list: mocks.directoryGet } } }))
vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server')
  return {
    useConvex: () => ({ query: mocks.query }),
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useMutation: () => mocks.mutation,
    useQueries: () => ({}),
    useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
      mocks.calls(getFunctionName(fn), args)
      if (args === 'skip') return undefined
      const name = getFunctionName(fn)
      return name.endsWith(':getExecution') ? mocks.execution : name.endsWith(':getRoom') ? mocks.room : name.endsWith(':getMessageAnchor') ? mocks.anchor : undefined
    },
    usePaginatedQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
      const name = getFunctionName(fn)
      mocks.calls(name, args)
      if (mocks.throwQuery && args !== 'skip') throw new Error('native query failed')
      const replies = args !== 'skip' && Boolean((args as { threadRootMessageId?: string }).threadRootMessageId)
      return { results: args === 'skip' ? [] : name.endsWith(':listRooms') ? mocks.lists : mocks.rows, status: mocks.pageStatus, loadMore: name.endsWith(':listMessages') ? (replies ? mocks.replyMore : mocks.mainMore) : mocks.loadMore }
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
import { useAgentDirectory, useDraftConversation, useSendMessage, type SendMessage } from '../DirectMessageExperience.hooks'
import { useNativeRoomSafety } from './useNativeRoomSafety'
import { RoomThreadPanel } from './RoomSidePanels'
import { RoomSidePanel } from '../DirectMessageExperience.parts'

let renderer: ReactTestRenderer | undefined
let session: ReturnType<typeof useNativeRoomSession>
let status: ReturnType<typeof useNativeCollaboration>['status']
let send: SendMessage
let writes: ReturnType<typeof useRoomMessageWrites>
let list: ReturnType<typeof useNativeRoomLists>
let creation: ReturnType<typeof useRoomCreation>
let safety: ReturnType<typeof useNativeRoomSafety>
let directory: ReturnType<typeof useAgentDirectory>
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
  const nextSafety = useNativeRoomSafety({ conversationId: nextSession?.room?.conversationId ?? null, workspaceId: mocks.workspace.activeWorkspaceId, threadRootMessageId: nextSession?.root[0] ?? undefined })
  const nextDirectory = useAgentDirectory({ activeWorkspaceId: mocks.workspace.activeWorkspaceId, conversationId: 'room' })
  React.useLayoutEffect(() => { safety = nextSafety; directory = nextDirectory })
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
  mocks.execution = { workspaceId: 'workspace', conversationId: 'room', userId: 'alice', compatibility: { readOnly: false } }
  mocks.pageStatus = 'Exhausted'; mocks.directory = []; mocks.directoryMode = 'native'
  mocks.room = room()
  mocks.rows = [message('first')]
  mocks.lists = [{ conversationId: 'room', workspaceId: 'workspace', title: 'Room', kind: 'direct', lastModified: 1 }]
  mocks.anchor = undefined
  mocks.mutation.mockResolvedValue(true)
  mocks.legacyDelete.mockResolvedValue({ ok: true })
  session = null
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })

function DraftProbe() {
  const [rows] = React.useState<[]>([])
  const messages = React.useRef(rows)
  useDraftConversation({ conversationId: 'room', conversationType: 'dm', draft: true,
    title: 'Shared DM', messages: rows, messagesRef: messages })
  return null
}

test.each(['ready', 'loading', 'unavailable'] as const)('leaving an empty native DM marked draft never removes its creator while %s', async (state) => {
  if (state === 'loading') mocks.pageStatus = 'LoadingFirstPage'
  if (state === 'unavailable') mocks.configuration.hasConvexClient = false
  await render(<React.StrictMode><NativeCollaborationProvider backendReady><StatusProbe /><DraftProbe /></NativeCollaborationProvider></React.StrictMode>)
  expect(status).toBe(state)
  await render(<div>Another conversation</div>)
  expect(mocks.legacyDelete).not.toHaveBeenCalled()
  expect(mocks.legacyParticipantUpdate).not.toHaveBeenCalled()
})

test('losing native readiness never enables legacy draft cleanup', async () => {
  await render(<NativeCollaborationProvider backendReady><DraftProbe /></NativeCollaborationProvider>)
  mocks.configuration.hasConvexClient = false
  await render(<NativeCollaborationProvider backendReady><DraftProbe /></NativeCollaborationProvider>)
  await render(<div>Another conversation</div>)
  expect(mocks.legacyDelete).not.toHaveBeenCalled()
  expect(mocks.legacyParticipantUpdate).not.toHaveBeenCalled()
})

test('native-off legacy empty DM draft cleanup is retained', async () => {
  await render(<NativeCollaborationProvider><DraftProbe /></NativeCollaborationProvider>)
  await render(<div>Another conversation</div>)
  expect(mocks.legacyDelete).toHaveBeenCalledExactlyOnceWith({ conversationId: 'room', scope: 'self' })
})

test('native execution is reactive, fail-closed and never performs compatibility GETs', async () => {
  await render()
  expect(safety.status).toBe('writable')
  for (const execution of [undefined, null,
    { ...mocks.execution as object, userId: 'bob' },
    { ...mocks.execution as object, workspaceId: 'other' },
    { ...mocks.execution as object, conversationId: 'other' },
    { workspaceId: 'workspace', conversationId: 'room', userId: 'alice', compatibility: { readOnly: true, code: 'native_runner_retired' } },
  ]) {
    mocks.execution = execution
    await render()
    expect(safety.readOnly).toBe(true)
    expect((await safety.checkWritable()).accepted).toBe(false)
  }
  expect(mocks.httpGet).not.toHaveBeenCalled()
})

test('selected replies paginate independently and require their own scoped execution', async () => {
  mocks.pageStatus = 'CanLoadMore'
  await render()
  await act(async () => { session!.root[1]('root') })
  expect(safety.readOnly).toBe(true)
  mocks.execution = { workspaceId: 'workspace', conversationId: 'room', userId: 'alice', threadRootMessageId: 'root', compatibility: { readOnly: false } }
  await render()
  expect(safety.status).toBe('writable')
  expect(session!.threadHistory.hasMore).toBe(true)
  session!.threadHistory.loadMore()
  expect(mocks.replyMore).toHaveBeenCalledTimes(1)
  expect(mocks.mainMore).not.toHaveBeenCalled()
  await session!.transcript.loadOlderMessages()
  expect(mocks.mainMore).toHaveBeenCalledTimes(1)
})

test('native agent identity revisions replace room snapshots without a directory HTTP request', async () => {
  mocks.directory = [{ id: 'agent', principalId: 'principal', name: 'Before', avatarColor: 'blue', avatarShape: 'round', isDefault: false }]
  await render()
  expect(directory.get('principal')?.name).toBe('Before')
  mocks.directory = [{ ...mocks.directory[0] as object, name: 'Remote rename', avatarColor: 'green', isDefault: true }]
  await render()
  expect(directory.get('principal')).toMatchObject({ name: 'Remote rename', avatarColor: 'green', isDefault: true })
  await act(async () => { window.dispatchEvent(new CustomEvent('overlay:agent-draft-preview', { detail: {
    workspaceId: 'workspace', principalId: 'principal', patch: { name: 'Unsaved', avatarColor: 'pink' },
  } })) })
  expect(directory.get('principal')?.name).toBe('Unsaved')
  mocks.directory = [{ ...mocks.directory[0] as object, name: 'Another remote rename' }]
  await render()
  expect(directory.get('principal')?.name).toBe('Unsaved')
  mocks.user.id = 'bob'; mocks.room = room('room', 'workspace', 'bob')
  await render()
  expect(directory.get('principal')?.name).toBe('Another remote rename')
  mocks.directory = []
  await render()
  expect(directory.size).toBe(0)
  expect(mocks.directoryGet).not.toHaveBeenCalled()
})

test('stream growth follows the bottom only while sticky and does not need another message', async () => {
  mocks.rows = [{ ...message('stream'), status: 'generating', content: 'a' }]
  await render()
  const node = { scrollTop: 100, scrollHeight: 100, clientHeight: 40 }
  session!.transcript.listRef.current = node as HTMLDivElement
  node.scrollHeight = 200
  mocks.rows = [{ ...mocks.rows[0] as object, content: 'a longer response' }]
  await render()
  expect(node.scrollTop).toBe(200)
  await act(async () => { session!.transcript.setStickToBottom(false) })
  node.scrollTop = 50; node.scrollHeight = 300
  mocks.rows = [{ ...mocks.rows[0] as object, content: 'an even longer response' }]
  await render()
  expect(node.scrollTop).toBe(50)
})

test('thread panel exposes an accessible older-replies control and disables it during pagination', async () => {
  const loadMore = vi.fn()
  const panel = (loading = false) => <RoomThreadPanel roomLabel="Room" replyCount={2} following={false} onToggleFollow={() => {}}
    messages={<div>Replies</div>} onClose={() => {}} input="" onInputChange={() => {}} onSubmit={() => {}} history={{ hasMore: true, loading, loadMore }} />
  await act(async () => { renderer = create(panel()) })
  const older = renderer!.root.findAllByType('button').find(button => button.props.children === 'Load older replies')!
  expect(older).toBeDefined()
  await act(async () => { older.props.onClick() })
  expect(loadMore).toHaveBeenCalledTimes(1)
  await act(async () => { renderer!.update(panel(true)) })
  expect(renderer!.root.findAllByType('button').find(button => button.props.children === 'Loading older replies…')?.props.disabled).toBe(true)
})

test('native thread header uses canonical totals rather than loaded replies or tombstones', async () => {
  type Props = Parameters<typeof RoomSidePanel>[0]
  let panel: React.ReactElement<Parameters<typeof RoomThreadPanel>[0]>
  let count: number | undefined = 1
  let capped = false
  function HeaderProbe() {
    const vm = { threadRoot: message('root'), threadReplies: [message('live', 'room', 'root'),
      { ...message('deleted', 'room', 'root'), deletedAt: 2 }], pinnedSummaries: [],
      replyCounts: new Map(count === undefined ? [] : [['root', count]]), replyCountsCapped: new Set(capped ? ['root'] : []) }
    panel = RoomSidePanel({ roomPanel: 'thread', conversationType: 'dm', title: 'Room', vm,
      thread: {}, navigation: {}, actions: {}, ctx: {}, onClosePanel() {} } as Props) as typeof panel
    return null
  }
  const headerTree = () => <NativeCollaborationProvider backendReady><NativeRoomScope conversationId="room"><HeaderProbe /></NativeRoomScope></NativeCollaborationProvider>
  await render(headerTree())
  expect(panel!.props.replyCount).toBe(1)
  expect(panel!.props.messages).toHaveLength(3)
  count = 64; capped = true
  await render(headerTree())
  expect(panel!.props.replyCount).toBe(64)
  expect(panel!.props.replyCountCapped).toBe(true)
  count = undefined
  await render(headerTree())
  expect(panel!.props.replyCount).toBeUndefined()
})

test.each([[1, false, '1 reply'], [64, true, '64+ replies'], [0, true, 'Replies'],
  [0, false, '0 replies'], [undefined, false, 'Replies']] as const)('thread panel presents count %s capped %s honestly', async (replyCount, replyCountCapped, label) => {
  await act(async () => { renderer = create(<RoomThreadPanel roomLabel="Room" replyCount={replyCount} replyCountCapped={replyCountCapped}
    following={false} onToggleFollow={() => {}} messages={null} onClose={() => {}} input="" onInputChange={() => {}} onSubmit={() => {}} />) })
  expect(JSON.stringify(renderer!.toJSON())).toContain(`Room · ${label}`)
})

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
  expect(mocks.calls.mock.calls.every(([, args]) => args === 'skip')).toBe(true)
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
