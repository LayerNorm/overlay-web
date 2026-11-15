import { defineMutations, defineQueries } from './convex'
import { PEOPLE, VIEWER_PRINCIPAL } from './agents'

type Item = Record<string, unknown> & { id: string; scope: string }
const USER = 'user_mercedes'
const NOW = Date.now()

const day = (offset: number) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

let counter = 0
function make(partial: Partial<Item> & { title: string }): Item {
  counter += 1
  return {
    id: 'k17work' + String(counter).padStart(25, '0'), workspaceId: 'ws_northwind', scope: 'workspace', createdBy: USER, description: null, status: 'todo', blocked: false,
    priority: 2, rank: 'a' + String(counter).padStart(4, '0'), assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null, blockedBy: [],
    doneWhen: [], context: [], archivedAt: null, archivedFromScope: null, createdAt: NOW - counter * 3_600_000, updatedAt: NOW - counter * 600_000,
    ...partial,
  }
}

const launch = make({ title: 'Launch the new homepage', status: 'progress', startDate: day(-6), dueDate: day(14) })
const research = make({ title: 'Q4 customer research', status: 'progress', startDate: day(-2), dueDate: day(24) })
const billing = make({ title: 'Billing cleanup', status: 'todo', startDate: day(3), dueDate: day(22) })
const stripe = make({ title: 'Migrate legacy plan names in Stripe', status: 'todo', priority: 3, parentId: billing.id, startDate: day(3), dueDate: day(10) })
let items: Item[] = [
  launch, research, billing,
  make({ title: 'Write the launch announcement post', status: 'review', priority: 3, assigneePrincipalId: 'p_quill', reviewerUserId: USER, parentId: launch.id, startDate: day(-4), dueDate: day(2), description: 'A launch post that explains the new homepage in plain language.', doneWhen: [{ text: 'Under 600 words', checked: true }, { text: 'Links to the pricing page', checked: false }], assignmentExecution: { status: 'completed', conversationId: 'k17convquillpost0000000000000000' } }),
  make({ title: 'Collect pricing objections from the last 30 sales calls', status: 'review', assigneePrincipalId: 'p_scout', reviewerUserId: 'user_priya', parentId: research.id, startDate: day(-2), dueDate: day(3) }),
  make({ title: 'Which analytics events can we drop before launch?', status: 'progress', blocked: true, assigneePrincipalId: VIEWER_PRINCIPAL, parentId: launch.id, startDate: day(-1), dueDate: day(4) }),
  make({ title: 'Fix the pricing table layout on small screens', status: 'progress', assigneePrincipalId: 'p_atlas', parentId: launch.id, startDate: day(-3), dueDate: day(5), assignmentExecution: { status: 'running', conversationId: 'k17convatlastable000000000000000' } }),
  make({ title: 'Record the 60 second product walkthrough', status: 'progress', priority: 1, assigneePrincipalId: 'p_sam', parentId: launch.id, startDate: day(-6), dueDate: day(3) }),
  make({ title: 'Draft interview questions for churned customers', status: 'todo', parentId: research.id, startDate: day(1), dueDate: day(6) }),
  make({ title: 'Summarize competitor changelogs from October', status: 'todo', priority: 1, assigneePrincipalId: 'p_scout', parentId: research.id, startDate: day(2), dueDate: day(8) }),
  stripe,
  make({ title: 'Reconcile October invoices against the ledger', status: 'backlog', assigneePrincipalId: 'p_ledger', parentId: billing.id, startDate: day(11), dueDate: day(18), blockedBy: [stripe.id] }),
  make({ title: 'Write the refund policy page', status: 'backlog', priority: 1, parentId: billing.id }),
  make({ title: 'Set up the staging domain for QA', status: 'done', assigneePrincipalId: 'p_atlas', parentId: launch.id, startDate: day(-6), dueDate: day(-3) }),
  make({ title: 'Collect launch-day screenshots', status: 'done', priority: 1, assigneePrincipalId: 'p_priya', parentId: launch.id, startDate: day(-5), dueDate: day(-1) }),
  make({ scope: 'personal', title: 'Book flights for the investor trip', status: 'todo', assigneePrincipalId: VIEWER_PRINCIPAL, startDate: day(0), dueDate: day(4) }),
  make({ scope: 'personal', title: 'Review the investor update draft', status: 'review', priority: 3, startDate: day(-2), dueDate: day(1) }),
  make({ scope: 'personal', title: 'Renew the domain names', status: 'progress', priority: 1, assigneePrincipalId: VIEWER_PRINCIPAL, dueDate: day(2) }),
]

const events: Array<Record<string, unknown>> = [
  { id: 'evt_1', workItemId: items[3].id, actorPrincipalId: 'p_quill', kind: 'status', data: { from: 'progress', to: 'review' }, createdAt: NOW - 3_600_000 },
  { id: 'evt_2', workItemId: items[3].id, actorPrincipalId: 'p_quill', kind: 'comment', data: { text: 'Draft is ready. I kept it to 540 words and linked the pricing page twice.' }, createdAt: NOW - 3_500_000 },
]

export function installWorkFixtures() {
  defineQueries({
    'work/browse:list': ({ view }: { view?: string }) => (view === 'archived' ? [] : items.filter((item) => !view || item.scope === view)),
    'work/browse:get': ({ id }: { id: string }) => items.find((item) => item.id === id) ?? null,
    'work/browse:events': ({ workItemId }: { workItemId: string }) => events.filter((event) => event.workItemId === workItemId),
    'work/browse:linkedThread': ({ id }: { id: string }) => {
      const item = items.find((entry) => entry.id === id)
      const execution = item?.assignmentExecution as { status: string; conversationId: string } | undefined
      if (!execution) return null
      const agent = PEOPLE.find((person) => person.principalId === item?.assigneePrincipalId)
      return { visible: true, conversationId: execution.conversationId, agentId: agent?.agentId ?? 'agent_overlay', title: item?.title, state: execution.status === 'running' ? 'working' : 'finished', updatedAt: NOW - 600_000 }
    },
    'work/browse:context': { principalId: VIEWER_PRINCIPAL, role: 'owner', canCreateInWorkspace: true, people: PEOPLE.filter((person) => person.type === 'human' || person.type === 'agent') },
  })
  defineMutations({
    'work/browse:create': (args: Record<string, unknown>) => {
      const item = make({ ...(args as Partial<Item>), title: String(args.title), scope: String(args.scope ?? 'workspace') })
      items = [...items, item]
      return item
    },
    'work/browse:update': (args: Record<string, unknown>) => {
      const { id, workspaceId: _workspaceId, ...patch } = args as Item
      items = items.map((item) => (item.id === id ? { ...item, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? null])), updatedAt: Date.now() } : item))
      return items.find((item) => item.id === id) ?? null
    },
    'work/browse:move': (args: Record<string, unknown>) => {
      const { id, status } = args as { id: string; status?: string }
      items = items.map((item) => (item.id === id ? { ...item, ...(status ? { status } : {}), updatedAt: Date.now() } : item))
      return items.find((item) => item.id === id) ?? null
    },
    'work/browse:addComment': (args: Record<string, unknown>) => {
      events.push({ id: 'evt_' + (events.length + 1), workItemId: args.workItemId, actorPrincipalId: VIEWER_PRINCIPAL, kind: 'comment', data: { text: args.text ?? args.body }, createdAt: Date.now() })
      return null
    },
  })
}
