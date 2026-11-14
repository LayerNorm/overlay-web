import { defineMutations, defineQueries } from './convex'
import { route } from './fetch'
import { AGENTS, PEOPLE, VIEWER_PRINCIPAL } from './agents'

const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Part = Record<string, unknown>
type Message = {
  id: string
  conversationId: string
  turnId: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorPrincipalId: string
  content: string
  parts?: Part[]
  createdAt: number
  updatedAt: number
  status?: string
  threadRootMessageId?: string
}

export type Room = {
  id: string
  kind: 'agent' | 'dm' | 'channel'
  title: string
  agentId?: string
  participants: string[]
  lastModified: number
  createdAt: number
  activity?: 'working' | 'needs_input' | 'ready' | 'completed' | 'idle'
  pullRequests?: Array<Record<string, unknown>>
  topic?: string
  slug?: string
  unread?: number
  messages: Message[]
}

let sequence = 0
function message(room: string, author: string, ago: number, content: string, parts?: Part[], extra: Partial<Message> = {}): Message {
  sequence += 1
  const person = PEOPLE.find((entry) => entry.principalId === author)
  return {
    id: 'msg_' + sequence,
    conversationId: room,
    turnId: 'turn_' + sequence,
    authorKind: person?.type === 'agent' ? 'agent' : 'human',
    authorPrincipalId: author,
    content,
    parts: parts ?? [{ type: 'text', text: content }],
    createdAt: NOW - ago,
    updatedAt: NOW - ago,
    status: 'complete',
    ...extra,
  }
}

const tool = (id: string, toolName: string, toolInput: Record<string, unknown>, toolOutput: unknown = { success: true }, state = 'output-available'): Part =>
  ({ type: 'tool-invocation', toolInvocation: { toolCallId: id, toolName, state, toolInput, toolOutput } })
const text = (value: string): Part => ({ type: 'text', text: value })
const reasoning = (value: string): Part => ({ type: 'reasoning', text: value, state: 'done' })

const PRICING_REPLY = `Here's where Northwind's pricing sits against the five closest competitors.

| Plan | Northwind | Median competitor | Gap |
| --- | ---: | ---: | ---: |
| Starter | $12 | $15 | −20% |
| Team | $29 | $32 | −9% |
| Business | $79 | $65 | +22% |

**Recommendation:** keep Starter and Team where they are, and either drop Business to $69 or add SSO and audit logs to justify the premium. Most churned Business accounts cited SSO in their exit survey.

I saved the full comparison to **Pricing benchmark — November** in Files.`

const LAUNCH_PLAN = `Here's the plan for the Q4 launch. I've split it across the team and set the dependencies in Work.

1. **Scout** collects pricing objections from the last 30 sales calls (due Friday).
2. **Atlas** fixes the pricing table on small screens and ships the new homepage behind a flag.
3. **Quill** drafts the launch post once the pricing decision lands.
4. **Ledger** models the revenue impact of the Business price change.

I'll check in each morning and flag anything that slips.`

const rooms: Room[] = []

function agentRoom(id: string, agentId: string, title: string, ago: number, activity: Room['activity'], messages: (room: string, agent: string) => Message[], extra: Partial<Room> = {}): Room {
  const agent = AGENTS.find((entry) => entry.id === agentId)!
  return { id, kind: 'agent', title, agentId, participants: [VIEWER_PRINCIPAL, agent.principalId as string], lastModified: NOW - ago, createdAt: NOW - ago - 2 * DAY, activity, messages: messages(id, agent.principalId as string), ...extra }
}

rooms.push(
  agentRoom('k17convlaunch0000000000000000000', 'agent_overlay', 'Plan the Q4 launch', 3 * MIN, 'working', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 52 * MIN, 'We launch the new homepage and pricing on December 2. Can you plan it across the team?'),
    message(room, agent, 50 * MIN, LAUNCH_PLAN, [
      reasoning('The launch needs research, engineering, copy and finance. I should check what is already in Work before creating tasks.'),
      tool('t1', 'list_work', { scope: 'workspace' }, { items: 14 }),
      tool('t2', 'create_work_item', { title: 'Collect pricing objections from the last 30 sales calls', assignee: 'Scout' }, { success: true }),
      tool('t3', 'create_work_item', { title: 'Fix the pricing table layout on small screens', assignee: 'Atlas' }, { success: true }),
      text(LAUNCH_PLAN),
    ]),
    message(room, VIEWER_PRINCIPAL, 12 * MIN, 'Looks good. Also benchmark our pricing against competitors before Quill starts writing.'),
    message(room, agent, 3 * MIN, 'Benchmarking now. I will compare our three plans with the five closest competitors.', [
      tool('t4', 'web_search', { query: 'B2B workspace software pricing per seat 2026' }, { results: [{ title: 'SaaS pricing benchmarks 2026', url: 'https://example.com/benchmarks' }] }),
      tool('t5', 'computer_exec', { command: 'python analyze_pricing.py --competitors 5' }, undefined, 'input-available'),
    ], { status: 'streaming' }),
  ]),
  agentRoom('k17convpricing000000000000000000', 'agent_overlay', 'Review subscription pricing', 2 * HOUR, 'ready', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 3 * HOUR, 'Review our subscription pricing and compare it with the current market.'),
    message(room, agent, 2 * HOUR, PRICING_REPLY, [
      tool('p1', 'web_search', { query: 'workspace collaboration software pricing Business plan' }, { results: [] }),
      tool('p2', 'computer_read_file', { path: 'data/pricing/competitors.csv' }, { success: true }),
      tool('p3', 'computer_write_file', { path: 'reports/pricing-benchmark.md', contents: '# Pricing' }, { success: true, created: true, linesAdded: 48, linesRemoved: 0 }),
      text(PRICING_REPLY),
    ]),
  ]),
  agentRoom('k17convdigest0000000000000000000', 'agent_overlay', 'Weekly metrics digest', 1 * DAY, 'completed', (room, agent) => [
    message(room, agent, 1 * DAY, 'Weekly digest: signups up 14%, activation steady at 41%, and two Business accounts are at risk. Details are in the digest note.'),
  ]),
  agentRoom('k17convscoutpricing0000000000000', 'agent_scout', 'Competitor pricing scan', 20 * MIN, 'working', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 40 * MIN, 'Scan the pricing pages of our five closest competitors and note any changes since September.'),
    message(room, agent, 20 * MIN, 'Checking pricing pages now.', [tool('s1', 'computer_open_url', { url: 'https://example.com/pricing' }, undefined, 'input-available')], { status: 'streaming' }),
  ]),
  agentRoom('k17convscoutchurn000000000000000', 'agent_scout', 'Churn interview synthesis', 3 * DAY, 'completed', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 3 * DAY + HOUR, 'Summarize the churn interviews from October.'),
    message(room, agent, 3 * DAY, 'Three themes came up in 9 of 12 interviews: missing SSO, slow onboarding for large teams, and unclear seat pricing.'),
  ]),
  agentRoom('k17convatlastable000000000000000', 'agent_atlas', 'Fix pricing table on mobile', 35 * MIN, 'needs_input', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 2 * HOUR, 'The pricing table overflows on phones. Please fix it and open a PR.'),
    message(room, agent, 35 * MIN, 'The fix is ready in a pull request. Should I also collapse the feature comparison into an accordion below 480px?', [
      tool('a1', 'computer_exec', { command: 'npm test -- pricing-table' }, { success: true, exitCode: 0 }),
      tool('a2', 'computer_write_file', { path: 'src/components/PricingTable.tsx' }, { success: true, created: false, linesAdded: 24, linesRemoved: 9 }),
      text('The fix is ready in a pull request. Should I also collapse the feature comparison into an accordion below 480px?'),
    ]),
  ], { pullRequests: [{ owner: 'northwind', repo: 'web', number: 482, title: 'Fix pricing table overflow on small screens', url: 'https://github.com/northwind/web/pull/482', state: 'open', observedAt: NOW - 30 * MIN, updatedAt: NOW - 30 * MIN }] }),
  agentRoom('k17convatlasnext0000000000000000', 'agent_atlas', 'Upgrade to Next.js 16', 5 * DAY, 'completed', (room, agent) => [
    message(room, agent, 5 * DAY, 'Upgraded to Next.js 16. All 412 tests pass and the bundle is 6% smaller.'),
  ]),
  agentRoom('k17convquillpost0000000000000000', 'agent_quill', 'Launch announcement draft', 4 * HOUR, 'ready', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 6 * HOUR, 'Draft the launch announcement for the new homepage.'),
    message(room, agent, 4 * HOUR, 'The first draft is in Files as **Launch announcement — v1**. It is 540 words and links to the pricing page.'),
  ]),
  agentRoom('k17convledgerclose00000000000000', 'agent_ledger', 'September close', 2 * DAY, 'completed', (room, agent) => [
    message(room, agent, 2 * DAY, 'September is reconciled. Two invoices from Acme Logistics are still unpaid; I added a reminder task.'),
  ]),
)

rooms.push(
  {
    id: 'k17convchannellaunch000000000000', kind: 'channel', title: 'launch', slug: 'launch', topic: 'Everything for the December 2 launch', participants: [VIEWER_PRINCIPAL, 'p_sam', 'p_priya', 'p_jonah', 'p_overlay'], lastModified: NOW - 8 * MIN, createdAt: NOW - 20 * DAY, unread: 3,
    messages: [
      message('k17convchannellaunch000000000000', 'p_sam', 3 * HOUR, 'Homepage copy is locked. Design is doing the last pass on the hero illustration.'),
      message('k17convchannellaunch000000000000', 'p_priya', 2 * HOUR, 'Can we get the pricing decision by Thursday? Sales needs a day to update the deck.'),
      message('k17convchannellaunch000000000000', VIEWER_PRINCIPAL, 90 * MIN, '@Overlay can you pull together the open launch tasks for standup?'),
      message('k17convchannellaunch000000000000', 'p_overlay', 88 * MIN, 'Seven launch tasks are open. Two need you: the pricing decision and the launch post review. Atlas is blocked on one question about the mobile pricing table.'),
      message('k17convchannellaunch000000000000', 'p_jonah', 8 * MIN, 'Staging is up with the new homepage behind the flag.'),
    ],
  },
  {
    id: 'k17convchannelgeneral00000000000', kind: 'channel', title: 'general', slug: 'general', topic: 'Company-wide announcements', participants: [VIEWER_PRINCIPAL, 'p_sam', 'p_priya', 'p_jonah'], lastModified: NOW - 5 * HOUR, createdAt: NOW - 90 * DAY,
    messages: [message('k17convchannelgeneral00000000000', 'p_sam', 5 * HOUR, 'Reminder: all-hands moves to Thursday at 10am this week.')],
  },
  {
    id: 'k17convchanneleng000000000000000', kind: 'channel', title: 'engineering', slug: 'engineering', topic: 'Builds, reviews and incidents', participants: [VIEWER_PRINCIPAL, 'p_jonah', 'p_atlas'], lastModified: NOW - 1 * DAY, createdAt: NOW - 60 * DAY,
    messages: [message('k17convchanneleng000000000000000', 'p_atlas', 1 * DAY, 'Nightly build is green. Coverage is 87%.')],
  },
  {
    id: 'k17convdmsam00000000000000000000', kind: 'dm', title: 'Sam Okafor', participants: [VIEWER_PRINCIPAL, 'p_sam'], lastModified: NOW - 25 * MIN, createdAt: NOW - 30 * DAY, unread: 1,
    messages: [
      message('k17convdmsam00000000000000000000', VIEWER_PRINCIPAL, 2 * HOUR, 'Do you have ten minutes before the board prep?'),
      message('k17convdmsam00000000000000000000', 'p_sam', 25 * MIN, 'Yes, after 3pm works. I will bring the updated forecast.'),
    ],
  },
  {
    id: 'k17convdmpriya000000000000000000', kind: 'dm', title: 'Priya Nair', participants: [VIEWER_PRINCIPAL, 'p_priya'], lastModified: NOW - 3 * DAY, createdAt: NOW - 30 * DAY,
    messages: [message('k17convdmpriya000000000000000000', 'p_priya', 3 * DAY, 'Shared the customer list for the beta in Files.')],
  },
)

export const ROOMS = rooms

function participantsFor(room: Room) {
  return room.participants.map((principalId, index) => {
    const person = PEOPLE.find((entry) => entry.principalId === principalId)!
    return {
      conversationId: room.id,
      workspaceId: 'ws_northwind',
      principalId,
      principalType: person.type,
      displayName: person.displayName,
      email: person.email ?? undefined,
      userId: person.userId ?? undefined,
      role: index === 0 ? 'owner' : 'member',
      joinedAt: room.createdAt + index,
      lastReadAt: room.unread ? room.lastModified - 60 * MIN : room.lastModified,
      status: 'active',
      ...(person.type === 'agent' ? { agentId: (person as { agentId?: string }).agentId } : {}),
    }
  })
}

const roomById = (id: unknown) => rooms.find((room) => room.id === id)

export function installRoomFixtures() {
  defineQueries({
    'agents/threads:bundle': ({ agentId }: { agentId: string }) => {
      const threads = rooms.filter((room) => room.agentId === agentId)
      const oldest = [...threads].sort((a, b) => a.createdAt - b.createdAt)[0]
      return {
        threads: threads.map((room) => ({ conversationId: room.id, title: room.title, lastModified: room.lastModified, createdAt: room.createdAt, isMain: room === oldest, ...(room.pullRequests ? { pullRequests: room.pullRequests } : {}) })),
        automations: [],
      }
    },
    'agents/threads:activity': ({ agentId }: { agentId: string }) => rooms.filter((room) => room.agentId === agentId).map((room) => ({ conversationId: room.id, status: room.activity ?? 'idle' })),
    'agents/threads:archived': [],
    'collaboration/rooms:state': ({ conversationId }: { conversationId: string }) => {
      const room = roomById(conversationId)
      if (!room) return null
      return {
        currentPrincipalId: VIEWER_PRINCIPAL,
        channel: room.kind === 'channel' ? { conversationId: room.id, workspaceId: 'ws_northwind', name: room.title, slug: room.slug ?? room.title, topic: room.topic, visibility: 'public', participantCount: room.participants.length, createdAt: room.createdAt, updatedAt: room.lastModified } : null,
        participants: participantsFor(room),
        reactions: [],
        pins: [],
        saved: [],
        follows: [],
        presence: [],
      }
    },
    'collaboration/rooms:messages': ({ conversationId, threadRootMessageId }: { conversationId: string; threadRootMessageId?: string }) => {
      const room = roomById(conversationId)
      const page = (room?.messages ?? []).filter((entry) => entry.threadRootMessageId === threadRootMessageId).slice().sort((a, b) => b.createdAt - a.createdAt)
      return { page, isDone: true, continueCursor: '' }
    },
    'collaboration/rooms:message': ({ conversationId, messageId }: { conversationId: string; messageId: string }) => roomById(conversationId)?.messages.find((entry) => entry.id === messageId) ?? null,
    'collaboration/rooms:activePublicStreams': [],
    'collaboration/rooms:runLiveness': null,
    'collaboration/rooms:access': ({ conversationId }: { conversationId: string }) => (roomById(conversationId) ? { canRead: true, canWrite: true, canManage: true } : null),
    'collaboration/rooms:compatibility': { compatibility: { readOnly: false } },
    'collaboration/rooms:scope': ({ conversationId }: { conversationId: string }) => { const room = ROOMS.find((entry) => entry.id === conversationId); return room ? { conversationType: room.kind === 'channel' ? 'channel' : 'dm', scope: 'workspace' } : null },
  })
  defineMutations({
    'agents/threads:resolveMain': ({ agentId }: { agentId: string }) => {
      const threads = rooms.filter((room) => room.agentId === agentId).sort((a, b) => a.createdAt - b.createdAt)
      return { conversationId: threads[0]?.id ?? 'k17convlaunch0000000000000000000', title: threads[0]?.title ?? 'Agent thread' }
    },
  })
  route('POST', /^\/api\/v1\/conversations\/direct-messages$/, () => ({ directMessage: { conversationId: 'k17convdmsam00000000000000000000' } }))
}
