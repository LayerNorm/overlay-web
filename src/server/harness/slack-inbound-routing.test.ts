import { beforeEach, expect, test, vi } from 'vitest'
import { registerSlackSurfaceHandlers } from '@/server/surfaces/slack-inbound'

const mocks = vi.hoisted(() => ({ bindings: vi.fn(), start: vi.fn(), post: vi.fn(), info: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow/api', () => ({ start: mocks.start }))
vi.mock('@/server/workflows/surface-agent-turn', () => ({ surfaceAgentTurnWorkflow: vi.fn() }))
vi.mock('@/server/surfaces/slack-reply', () => ({ postSlackAgentMessage: mocks.post }))
vi.mock('@/server/surfaces/surface-authors', () => ({ resolveSurfaceAuthorStatus: vi.fn(async () => 'member') }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: { resolveInboundBindings: mocks.bindings },
}) }))

const source = {
  binding: { id: 'binding', channelName: 'general' },
  agent: { id: 'chief', agentRole: 'workspace_chief', name: 'Overlay', harness: 'overlay', principalId: 'chief-principal' },
  connection: { id: 'connection', workspaceId: 'workspace' },
  creatorUserId: 'creator', creatorPrincipalId: 'creator-principal',
}
const adapter = {
  decodeThreadId: () => ({ channel: 'C1', threadTs: '123.0' }),
  getInstallation: vi.fn(async () => ({ botToken: 'fixture-token' })),
  withBotToken: async (_token: string, callback: () => Promise<unknown>) => await callback(),
  webClient: { conversations: { info: mocks.info } },
}
const thread = { id: 'thread', setState: vi.fn(), subscribe: vi.fn(), post: vi.fn() }
const message = {
  id: '123.1', text: 'Scout review this', raw: { team_id: 'T1', text: '<@U12345> Scout review this' },
  author: { userId: 'SLACK_USER', fullName: 'Sender' },
}
type Handler = (thread: unknown, message: unknown) => Promise<void>
let mention: Handler
let subscribed: Handler
beforeEach(() => {
  vi.clearAllMocks()
  mocks.bindings.mockResolvedValue([source])
  mocks.info.mockResolvedValue({ channel: { is_channel: true, is_private: false, is_shared: false } })
  mocks.post.mockResolvedValue({ posted: true, ts: 'placeholder' })
  thread.subscribe.mockResolvedValue(undefined)
  thread.setState.mockResolvedValue(undefined)
  registerSlackSurfaceHandlers({
    getAdapter: () => adapter,
    onNewMention: (handler: Handler) => { mention = handler },
    onSubscribedMessage: (handler: Handler) => { subscribed = handler },
  } as never)
})

test('specialist prefixes target the Chief unchanged and turn identity survives rebinding', async () => {
  await mention(thread, message)
  expect(mocks.start.mock.calls[0][1][0]).toMatchObject({
    userId: 'creator', workspaceId: 'workspace', instructions: 'Scout review this',
    turnId: 'surface:slack:T1:C1:123.1', surface: { agentId: 'chief', creatorPrincipalId: 'creator-principal' },
  })
  mocks.bindings.mockResolvedValue([{ ...source, binding: { ...source.binding, id: 'rebound' } }])
  await subscribed(thread, message)
  expect(mocks.start.mock.calls[1][1][0].turnId).toBe(mocks.start.mock.calls[0][1][0].turnId)
})

test('legacy specialist and unbound channels produce neither posts nor runs', async () => {
  for (const candidates of [[], [{ ...source, agent: { ...source.agent, agentRole: 'agent' } }]]) {
    mocks.bindings.mockResolvedValue(candidates)
    await mention(thread, message)
    await subscribed(thread, message)
  }
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
  expect(thread.post).not.toHaveBeenCalled()
  expect(thread.subscribe).not.toHaveBeenCalled()
})

test.each([
  { is_im: true }, { is_mpim: true }, { is_channel: true, is_private: true },
  { is_channel: true, is_shared: true }, { is_channel: true, is_ext_shared: true },
  { is_channel: true, is_org_shared: true },
])('unsupported inbound audience is silent: %j', async (channel) => {
  mocks.info.mockResolvedValue({ channel })
  await mention(thread, message)
  await subscribed(thread, message)
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
  expect(thread.post).not.toHaveBeenCalled()
})

test('channel metadata failure is fail-closed', async () => {
  mocks.info.mockRejectedValueOnce(new Error('channel_not_found'))
  await mention(thread, message)
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
})
