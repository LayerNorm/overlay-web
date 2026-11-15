import { memoriesToClientListRows } from '@/shared/knowledge/memory-display-segments'
import { defineQueries } from './convex'
import { route } from './fetch'
import { AGENTS, PEOPLE, VIEWER_PRINCIPAL } from './agents'
import { ROOMS } from './rooms'

const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const USER = 'user_mercedes'

/** Personal chats: the Chats surface's own conversations with models. */
type ChatMessage = Record<string, unknown>
const chats = [
  { id: 'k17chatokr0000000000000000000000', title: 'Draft Q1 OKRs for the product team', ago: 40 * MIN, scope: 'personal' },
  { id: 'k17chatboard00000000000000000000', title: 'Board deck outline', ago: 5 * HOUR, scope: 'personal' },
  { id: 'k17chatsql0000000000000000000000', title: 'SQL for weekly active teams', ago: 1 * DAY, scope: 'personal' },
  { id: 'k17chatoffsite000000000000000000', title: 'Offsite agenda ideas', ago: 3 * DAY, scope: 'personal' },
  { id: 'k17chatonboarding000000000000000', title: 'Onboarding checklist for new hires', ago: 6 * HOUR, scope: 'workspace' },
  { id: 'k17chatsupport000000000000000000', title: 'Support macro rewrite', ago: 2 * DAY, scope: 'workspace' },
]

const OKR_REPLY = `Here are three objectives with measurable key results for Q1.

### 1. Make onboarding effortless
- Cut time-to-first-task from 18 minutes to under 8
- Raise week-one activation from 41% to 55%

### 2. Win larger teams
- Ship SSO and audit logs by February 15
- Close 12 Business accounts with 50+ seats

### 3. Earn trust in agent work
- Keep agent task success above 92%
- Answer 95% of support tickets within 4 hours

Want me to turn these into tasks in Work and assign owners?`

function chatMessage(conversationId: string, turnId: string, role: 'user' | 'assistant', content: string, ago: number, extra: ChatMessage = {}): ChatMessage {
  return { _id: conversationId + '_' + role + '_' + turnId, _creationTime: NOW - ago, conversationId, userId: USER, turnId, role, mode: 'ask', content, contentType: 'text', createdAt: NOW - ago, updatedAt: NOW - ago, status: 'completed', ...(role === 'assistant' ? { modelId: 'anthropic/claude-sonnet-5.5', variantIndex: 0, parts: [{ type: 'text', text: content }] } : {}), ...extra }
}

const chatMessages: Record<string, ChatMessage[]> = {
  'k17chatokr0000000000000000000000': [
    chatMessage('k17chatokr0000000000000000000000', 't1', 'user', 'Draft Q1 OKRs for the product team. We want to focus on onboarding, larger teams and reliability.', 42 * MIN),
    chatMessage('k17chatokr0000000000000000000000', 't1', 'assistant', OKR_REPLY, 40 * MIN, { parts: [{ type: 'reasoning', text: 'Three focus areas, so three objectives with two measurable key results each.', state: 'done' }, { type: 'text', text: OKR_REPLY }] }),
  ],
}
for (const chat of chats) if (!chatMessages[chat.id]) chatMessages[chat.id] = [
  chatMessage(chat.id, 't1', 'user', chat.title + '.', chat.ago + MIN),
  chatMessage(chat.id, 't1', 'assistant', 'Here is a first pass at **' + chat.title.toLowerCase() + '**. Tell me what to tighten and I will revise it.', chat.ago),
]

const chatSummary = (chat: (typeof chats)[number], workspaceId = 'ws_northwind') => ({
  _id: chat.id, workspaceId, title: chat.title, lastModified: NOW - chat.ago, createdAt: NOW - chat.ago - HOUR,
  askModelIds: ['anthropic/claude-sonnet-5.5'], actModelId: 'anthropic/claude-sonnet-5.5', lastMode: 'ask', conversationType: 'personal',
  scope: chat.scope, kind: chat.scope, lastMessageAt: NOW - chat.ago, unread: chat.id === 'k17chatboard00000000000000000000',
})

/** Files and notes. */
let fileSeq = 0
function file(partial: Record<string, unknown>) {
  fileSeq += 1
  const name = String(partial.name)
  const extension = name.includes('.') ? name.split('.').pop() : undefined
  return {
    _id: 'k17file' + String(fileSeq).padStart(25, '0'), userId: USER, type: 'file', kind: 'upload', parentId: null, storageId: null, r2Key: null,
    extension, sizeBytes: 24_000 + fileSeq * 3100, indexable: true, indexStatus: 'indexed', isStorageBacked: false,
    scope: 'workspace', createdAt: NOW - fileSeq * 7 * HOUR, updatedAt: NOW - fileSeq * 5 * HOUR, ...partial,
  }
}

const WEEKLY_DIGEST = `# Weekly metrics digest

Week of November 9. Prepared by Overlay from Stripe, PostHog and HubSpot.

## Highlights

- **Signups** rose 14% to 1,284, mostly from the pricing page test.
- **Activation** held at 41%. Teams that invite a second member in week one activate at 68%.
- **Revenue** grew 3.2% week over week to $182,400 MRR.

## Watch list

| Account | Plan | Risk | Owner |
| --- | --- | --- | --- |
| Acme Logistics | Business | Missing SSO | Sam |
| Blue Harbor | Team | Usage down 40% | Priya |

## Next steps

1. Ship SSO to the two Business accounts before December 2.
2. Add a second-member nudge to onboarding.
3. Review the pricing test with Sales on Thursday.
`

export const FILES = [
  file({ _id: 'k17folderlaunch00000000000000000', name: 'Launch', type: 'folder', kind: 'folder', sizeBytes: 0 }),
  file({ _id: 'k17folderresearch000000000000000', name: 'Research', type: 'folder', kind: 'folder', sizeBytes: 0 }),
  file({ _id: 'k17folderfinance0000000000000000', name: 'Finance', type: 'folder', kind: 'folder', sizeBytes: 0, scope: 'personal' }),
  file({ name: 'Pricing benchmark — November', kind: 'note', parentId: 'k17folderresearch000000000000000', previewText: 'Northwind sits below the median on Starter and Team and 22% above it on Business.', textContent: '# Pricing benchmark\n\nNorthwind sits below the median on Starter and Team and 22% above it on Business.' }),
  file({ name: 'Launch announcement — v1', kind: 'note', parentId: 'k17folderlaunch00000000000000000', previewText: 'Today we are launching a faster, simpler Northwind with clearer pricing for every team.', textContent: '# Launch announcement\n\nToday we are launching a faster, simpler Northwind.' }),
  file({ name: 'Weekly metrics digest', kind: 'note', previewText: 'Signups up 14%. Activation steady at 41%. Two Business accounts at risk.', content: WEEKLY_DIGEST, textContent: WEEKLY_DIGEST }),
  file({ name: 'Churn interviews — October.pdf', mimeType: 'application/pdf', parentId: 'k17folderresearch000000000000000', sizeBytes: 1_840_000 }),
  file({ name: 'Homepage hero.png', mimeType: 'image/png', parentId: 'k17folderlaunch00000000000000000', kind: 'output', outputSource: 'image_generation', outputStatus: 'completed', sizeBytes: 920_000 }),
  file({ name: 'Q4 revenue model.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parentId: 'k17folderfinance0000000000000000', scope: 'personal' }),
  file({ name: 'Beta customers.csv', mimeType: 'text/csv', textContent: 'company,seats,plan\nAcme Logistics,42,Business\nBlue Harbor,18,Team' }),
  file({ name: 'Brand guidelines.pdf', mimeType: 'application/pdf', sizeBytes: 5_200_000 }),
  file({ name: 'Investor update — November', kind: 'note', scope: 'personal', previewText: 'Revenue grew 11% month over month. We closed three Business accounts.', textContent: '# Investor update' }),
]

const MEMORIES = memoriesToClientListRows([
  { _id: 'mem_1', userId: USER, content: 'Mercedes prefers short summaries with the recommendation first.', source: 'chat', type: 'preference', createdAt: NOW - 20 * DAY },
  { _id: 'mem_2', userId: USER, content: 'Northwind launches the new homepage and pricing on December 2.', source: 'chat', type: 'project', createdAt: NOW - 2 * DAY },
  { _id: 'mem_3', userId: USER, content: 'Business plan churn is mostly caused by missing SSO.', source: 'agent', type: 'fact', actor: 'agent', createdAt: NOW - 3 * DAY },
  { _id: 'mem_4', userId: USER, content: 'Board meetings are on the first Thursday of each quarter.', source: 'chat', type: 'fact', createdAt: NOW - 30 * DAY },
], { viewerUserId: USER })

const AUTOMATIONS = [
  { _id: 'k17autodigest0000000000000000000', name: 'Weekly metrics digest', description: 'Summarizes signups, activation and at-risk accounts every Monday.', instructions: 'Pull last week\'s metrics and write a short digest note.', enabled: true, schedule: { kind: 'weekly', hourUTC: 16, minuteUTC: 0, dayOfWeekUTC: 1 }, timezone: 'America/Los_Angeles', nextRunAt: NOW + 2 * DAY, lastRunAt: NOW - 5 * DAY, scope: 'workspace', agentId: 'agent_overlay' },
  { _id: 'k17autoinbox00000000000000000000', name: 'Morning inbox triage', description: 'Sorts overnight email into reply, delegate and archive.', instructions: 'Triage my inbox.', enabled: true, schedule: { kind: 'daily', hourUTC: 15, minuteUTC: 30 }, timezone: 'America/Los_Angeles', nextRunAt: NOW + 14 * HOUR, lastRunAt: NOW - 10 * HOUR, scope: 'personal' },
  { _id: 'k17autocompetitors00000000000000', name: 'Competitor pricing watch', description: 'Checks five competitor pricing pages for changes.', instructions: 'Compare pricing pages with last week.', enabled: false, schedule: { kind: 'weekly', hourUTC: 17, minuteUTC: 0, dayOfWeekUTC: 4 }, timezone: 'America/Los_Angeles', nextRunAt: NOW + 4 * DAY, lastRunAt: NOW - 3 * DAY, scope: 'personal', agentId: 'agent_scout' },
  { _id: 'k17autoinvoices00000000000000000', name: 'Overdue invoice reminders', description: 'Drafts reminders for invoices more than 14 days overdue.', instructions: 'Find overdue invoices and draft reminders.', enabled: true, schedule: { kind: 'monthly', hourUTC: 16, minuteUTC: 0, dayOfMonthUTC: 1 }, timezone: 'America/Los_Angeles', nextRunAt: NOW + 17 * DAY, lastRunAt: NOW - 13 * DAY, scope: 'workspace' },
].map((row, index) => ({ ...row, userId: USER, workspaceId: 'ws_northwind', modelId: 'anthropic/claude-sonnet-5.5', concurrencyPolicy: 'skip', createdAt: NOW - (30 + index) * DAY, updatedAt: NOW - index * DAY }))

/** Bundled logos, so the mockup loads nothing from the network; the rest use the app's initials fallback. */
const LOGOS: Record<string, string> = {
  gmail: '/assets/svg/landing/gmail.svg',
  googlecalendar: '/assets/svg/landing/google-calendar.svg',
  slack: '/assets/svg/landing/slack.svg',
  github: '/assets/svg/landing/github.svg',
  notion: '/assets/svg/landing/notion.svg',
  linear: '/assets/svg/landing/linear.svg',
}

const CONNECTORS = [
  { slug: 'gmail', name: 'Gmail', description: 'Read, draft and send email.', connected: true },
  { slug: 'googlecalendar', name: 'Google Calendar', description: 'See and schedule events.', connected: true },
  { slug: 'slack', name: 'Slack', description: 'Read channels and post messages.', connected: true },
  { slug: 'github', name: 'GitHub', description: 'Issues, pull requests and repositories.', connected: true },
  { slug: 'notion', name: 'Notion', description: 'Pages and databases.', connected: false },
  { slug: 'linear', name: 'Linear', description: 'Issues, projects and cycles.', connected: false },
  { slug: 'googledrive', name: 'Google Drive', description: 'Docs, Sheets and files.', connected: false },
  { slug: 'hubspot', name: 'HubSpot', description: 'Contacts, deals and companies.', connected: false },
  { slug: 'stripe', name: 'Stripe', description: 'Customers, invoices and subscriptions.', connected: false },
  { slug: 'figma', name: 'Figma', description: 'Files, comments and components.', connected: false },
  { slug: 'salesforce', name: 'Salesforce', description: 'Accounts, opportunities and reports.', connected: false },
  { slug: 'jira', name: 'Jira', description: 'Issues and sprints.', connected: false },
].map((item) => ({
  id: item.slug, providerKey: item.slug, slug: item.slug, name: item.name, description: item.description, icon: item.slug,
  logoUrl: LOGOS[item.slug] ?? null, isConnected: item.connected, connectedAccountId: item.connected ? 'ca_' + item.slug : null,
  provider: 'composio', authenticationState: item.connected ? 'connected' : 'disconnected',
}))

const SKILLS = [
  { _id: 'skill_brand', name: 'Northwind brand voice', description: 'Tone, vocabulary and formatting rules for anything customers read.', scope: 'workspace', enabled: true },
  { _id: 'skill_sql', name: 'Warehouse SQL', description: 'Table guide and query patterns for the analytics warehouse.', scope: 'workspace', enabled: true },
  { _id: 'skill_inbox', name: 'Inbox triage', description: 'How Mercedes sorts email into reply, delegate and archive.', scope: 'personal', enabled: true },
].map((row) => ({ ...row, userId: USER, workspaceId: 'ws_northwind', instructions: row.description, createdAt: NOW - 9 * DAY, updatedAt: NOW - 2 * DAY, canEdit: true }))

const MCP_SERVERS = [
  { _id: 'mcp_posthog', name: 'PostHog', description: 'Product analytics events, funnels and cohorts.', url: 'https://mcp.posthog.com/sse', scope: 'workspace' },
  { _id: 'mcp_sentry', name: 'Sentry', description: 'Errors, releases and performance issues.', url: 'https://mcp.sentry.dev/mcp', scope: 'workspace' },
].map((row) => ({ ...row, userId: USER, workspaceId: 'ws_northwind', transport: 'http', enabled: true, authType: 'oauth', status: 'connected', createdAt: NOW - 12 * DAY, updatedAt: NOW - 3 * DAY, canEdit: true }))

function peopleView(view: string) {
  if (view === 'chats-agents') return AGENTS.map((agent) => ({ id: agent.principalId as string, kind: 'member', name: agent.name as string, principalId: agent.principalId as string, principalType: 'agent', avatarColor: agent.avatarColor as string | undefined, avatarShape: agent.avatarShape as string | undefined, isDefault: Boolean(agent.isDefault), role: 'member', status: 'active' }))
  if (view === 'teams') return [{ id: 'team_growth', kind: 'team', name: 'Growth', detail: '3 members', teamMemberPrincipalIds: [VIEWER_PRINCIPAL, 'p_priya', 'p_scout'] }, { id: 'team_eng', kind: 'team', name: 'Engineering', detail: '2 members', teamMemberPrincipalIds: ['p_jonah', 'p_atlas'] }]
  if (view === 'roles') return [{ id: 'owner', kind: 'role', name: 'Owner', detail: '1 member' }, { id: 'admin', kind: 'role', name: 'Admin', detail: '1 member' }, { id: 'member', kind: 'role', name: 'Member', detail: '2 members' }]
  if (view === 'guests') return []
  return [
    ...PEOPLE.filter((person) => person.type === 'human').map((person) => ({ id: person.principalId, kind: 'member', name: person.displayName, description: person.email ?? undefined, detail: person.email ?? undefined, principalId: person.principalId, principalType: 'human', role: person.role, status: 'active' })),
    { id: 'inv_1', kind: 'invitation', name: 'lena@northwind.example', detail: 'Invited 2 days ago', badge: 'Pending', role: 'member', status: 'pending', invitationId: 'inv_1' },
  ]
}

const NOTIFICATIONS = [
  { id: 'ntf_1', type: 'mention', conversationId: 'k17convchannellaunch000000000000', conversationType: 'channel', actorPrincipalId: 'p_sam', title: 'Sam Okafor mentioned you in #launch', body: '@Mercedes can you sign off on the pricing copy before Friday?', ago: 12 * MIN },
  { id: 'ntf_2', type: 'message', conversationId: 'k17convdmsam00000000000000000000', conversationType: 'dm', actorPrincipalId: 'p_sam', title: 'Sam Okafor', body: 'Uploaded the final hero image to Launch.', ago: 50 * MIN },
  { id: 'ntf_3', type: 'thread', conversationId: 'k17convchanneleng000000000000000', conversationType: 'channel', actorPrincipalId: 'p_jonah', title: 'Jonah Kim replied in a thread in #engineering', body: 'Staging deploy is green. Shipping the table fix tonight.', ago: 3 * HOUR, read: true },
  { id: 'ntf_4', type: 'reaction', conversationId: 'k17convchannelgeneral00000000000', conversationType: 'channel', actorPrincipalId: 'p_priya', title: 'Priya Nair reacted to your message in #general', body: 'Welcome aboard, Lena!', ago: 1 * DAY, read: true },
].map(({ ago, read, ...row }) => ({ ...row, workspaceId: 'ws_northwind', recipientPrincipalId: VIEWER_PRINCIPAL, createdAt: NOW - ago, readAt: read ? NOW - ago + MIN : undefined }))

export function installWorkspaceFixtures() {
  defineQueries({
    'collaboration/activity:notifications': NOTIFICATIONS,
    'chat/personal:list': ({ scope, archived, workspaceId }: { scope?: string; archived?: boolean; workspaceId: string }) => ({ page: archived ? [] : chats.filter((chat) => !scope || chat.scope === scope).map((chat) => chatSummary(chat, workspaceId)), isDone: true, continueCursor: '' }),
    'chat/personal:getSummary': ({ conversationId, workspaceId }: { conversationId: string; workspaceId: string }) => { const chat = chats.find((entry) => entry.id === conversationId); return chat ? chatSummary(chat, workspaceId) : null },
    'chat/personal:getMessages': ({ conversationId }: { conversationId: string }) => ({ page: (chatMessages[conversationId] ?? []).slice().reverse().map((message) => ({ message, contextUser: null, outputs: [] })), isDone: true, continueCursor: '' }),
    'chat/personal:getExecution': ({ conversationId, workspaceId }: { conversationId: string; workspaceId: string }) => ({ conversationId, workspaceId, userId: USER, compatibility: { readOnly: false }, run: null }),
    'collaboration/roomList:list': ({ kind }: { kind: string }) => ({
      rooms: ROOMS.filter((room) => room.kind !== 'agent' && (kind === 'all' || room.kind === kind)).sort((a, b) => b.lastModified - a.lastModified).map((room) => ({
        _id: room.id, title: room.title, lastModified: room.lastModified, createdAt: room.createdAt, updatedAt: room.lastModified, conversationType: room.kind, scope: 'workspace', workspaceId: 'ws_northwind',
        otherParticipantTypes: room.participants.filter((id) => id !== VIEWER_PRINCIPAL).map((id) => PEOPLE.find((person) => person.principalId === id)?.type ?? 'human'),
      })),
      hasMore: false,
    }),
    'collaboration/management:view': ({ view }: { view: string }) => ({ canManage: true, currentPrincipalId: VIEWER_PRINCIPAL, currentRole: 'owner', items: peopleView(view), workspaceKind: 'team' }),
    'files/browse:list': ({ view }: { view?: string }) => (view === 'archived' ? [] : FILES.filter((entry) => !view || entry.scope === view)),
    'files/browse:get': ({ fileId }: { fileId: string }) => FILES.find((entry) => entry._id === fileId) ?? null,
    'knowledge/memoryBrowse:list': MEMORIES,
    'automations/browse:list': ({ view }: { view?: string }) => (view === 'archived' ? [] : AUTOMATIONS.filter((row) => !view || row.scope === view)),
    'automations/browse:get': ({ automationId }: { automationId: string }) => AUTOMATIONS.find((row) => row._id === automationId) ?? null,
    'automations/browse:runs': [],
    'collaboration/archive:rooms': [],
    'integrations/skillsBrowse:list': ({ view }: { view?: string }) => (view === 'archived' ? [] : SKILLS.filter((row) => !view || row.scope === view)),
    'integrations/mcpBrowse:servers': ({ view }: { view?: string }) => (view === 'archived' ? [] : MCP_SERVERS.filter((row) => !view || row.scope === view)),
    'integrations/mcpBrowse:connections': [],
  })
  route('GET', /^\/api\/v1\/capabilities$/, () => ({ capabilities: { billing: true } }))
  route('GET', /^\/api\/v1\/(?:account|workspaces\/[^/]+)\/profile$/, () => ({ displayName: 'Mercedes Alvarez', photoUrl: null, displayNameOverride: null, hasCustomPhoto: false, email: 'mercedes@northwind.example', accountDisplayName: 'Mercedes Alvarez', accountPhotoUrl: null }))
  route('GET', /^\/api\/v1\/integrations$/, ({ search }) => {
    if (search.get('action') === 'search') return { provider: 'composio', data: CONNECTORS, items: CONNECTORS, hasMore: false }
    const connected = CONNECTORS.filter((item) => item.isConnected)
    return { provider: 'composio', connected: connected.map((item) => item.providerKey), data: connected, items: connected, hasMore: false }
  })
}
