/**
 * An in-page stand-in for /api/v1/work and /api/v1/scope, so the real Work UI can be driven in a browser without a
 * backend. It follows the same rules as Convex closely enough for the UI: scope views, end-of-column ranks, moves between
 * neighbours, null-to-clear patches, events, and refusals.
 */
import { rankBetween } from '../../../src/shared/work/rank'

type Item = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- a loose in-page fixture
type Event = { id: string; workItemId: string; actorPrincipalId: string; kind: string; data: Record<string, unknown> | null; createdAt: number }

const ME = { principalId: 'p-me', userId: 'user-me' }
const PEOPLE = [
  { principalId: 'p-me', type: 'human', userId: 'user-me', displayName: 'Mercedes Rend' },
  { principalId: 'p-sam', type: 'human', userId: 'user-sam', displayName: 'Sam Okafor' },
  { principalId: 'p-priya', type: 'human', userId: 'user-priya', displayName: 'Priya Nair' },
  { principalId: 'p-research', type: 'agent', userId: null, displayName: 'Research Agent' },
  { principalId: 'p-code', type: 'agent', userId: null, displayName: 'Code Agent' },
]

const day = (offset: number) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

let counter = 0
let rankCounter = 0
const nextRank = () => {
  // ascending, well spread ranks for the seed
  rankCounter += 1
  return String.fromCharCode(65 + (rankCounter % 26)) + String(rankCounter).padStart(2, '1')
}

function make(partial: Item): Item {
  counter += 1
  return {
    id: `t${counter}`, workspaceId: 'ws-1', scope: 'workspace', createdBy: 'user-me', title: 'Task', description: null, status: 'todo', blocked: false,
    priority: 2, rank: nextRank(), assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null, blockedBy: [],
    doneWhen: [], context: [], archivedAt: null, archivedFromScope: null, createdAt: Date.now() - counter * 60_000, updatedAt: Date.now() - counter * 60_000,
    ...partial,
  }
}

function seed(): Item[] {
  const launch = make({ title: 'Launch the new homepage', status: 'progress', startDate: day(-6), dueDate: day(14) })
  const research = make({ title: 'Q4 customer research', status: 'progress', startDate: day(-2), dueDate: day(24) })
  const billing = make({ title: 'Billing cleanup', status: 'todo', startDate: day(3), dueDate: day(22) })
  const post = make({ title: 'Write the launch announcement post', status: 'review', priority: 3, assigneePrincipalId: 'p-research', reviewerUserId: 'user-me', parentId: launch.id, startDate: day(-4), dueDate: day(2), description: 'A launch post that explains the new homepage in plain language.', doneWhen: [{ text: 'Under 600 words', checked: true }, { text: 'Links to the pricing page', checked: false }] })
  const objections = make({ title: 'Collect pricing objections from the last 30 sales calls', status: 'review', assigneePrincipalId: 'p-research', reviewerUserId: 'user-priya', parentId: research.id, startDate: day(-2), dueDate: day(3) })
  const analytics = make({ title: 'Which analytics events can we drop before launch?', status: 'progress', blocked: true, assigneePrincipalId: 'p-me', parentId: launch.id, startDate: day(-1), dueDate: day(4) })
  const pricing = make({ title: 'Fix the pricing table layout on small screens', status: 'progress', assigneePrincipalId: 'p-code', parentId: launch.id, startDate: day(-3), dueDate: day(5) })
  const video = make({ title: 'Record the 60 second product walkthrough', status: 'progress', priority: 1, assigneePrincipalId: 'p-sam', parentId: launch.id, startDate: day(-6), dueDate: day(3) })
  const interview = make({ title: 'Draft interview questions for churned customers', status: 'todo', parentId: research.id, startDate: day(1), dueDate: day(6) })
  const changelogs = make({ title: 'Summarize competitor changelogs from September', status: 'todo', priority: 1, assigneePrincipalId: 'p-research', parentId: research.id, startDate: day(2), dueDate: day(8) })
  const stripe = make({ title: 'Migrate legacy plan names in Stripe', status: 'todo', priority: 3, parentId: billing.id, startDate: day(3), dueDate: day(10) })
  const invoices = make({ title: 'Reconcile September invoices against the ledger', status: 'backlog', parentId: billing.id, startDate: day(11), dueDate: day(18), blockedBy: [stripe.id] })
  const refund = make({ title: 'Write the refund policy page', status: 'backlog', priority: 1, parentId: billing.id })
  const staging = make({ title: 'Set up the staging domain for QA', status: 'done', assigneePrincipalId: 'p-code', parentId: launch.id, startDate: day(-6), dueDate: day(-3) })
  const shots = make({ title: 'Collect launch-day screenshots', status: 'done', priority: 1, assigneePrincipalId: 'p-priya', parentId: launch.id, startDate: day(-5), dueDate: day(-1) })
  const flights = make({ scope: 'personal', title: 'Book flights for the investor trip', status: 'todo', assigneePrincipalId: 'p-me', startDate: day(0), dueDate: day(4) })
  const update = make({ scope: 'personal', title: 'Review the investor update draft', status: 'review', priority: 3, startDate: day(-2), dueDate: day(1) })
  const domains = make({ scope: 'personal', title: 'Renew the domain names', status: 'progress', priority: 1, assigneePrincipalId: 'p-me', dueDate: day(2) })
  return [launch, research, billing, post, objections, analytics, pricing, video, interview, changelogs, stripe, invoices, refund, staging, shots, flights, update, domains]
}

export function installFakeWorkApi() {
  let items = seed()
  let events: Event[] = [
    { id: 'e0', workItemId: items[3].id, actorPrincipalId: 'p-research', kind: 'status', data: { from: 'progress', to: 'review' }, createdAt: Date.now() - 3_600_000 },
  ]
  const state = { latency: 40, failNext: null as null | { match: RegExp; status: number; error: string }, calls: [] as Array<{ method: string; path: string; body: unknown }> }
  if (new URLSearchParams(window.location.search).get('failList') === '1') state.failNext = { match: /GET \/api\/v1\/work$/, status: 500, error: 'Work request failed' }
  const original = window.fetch.bind(window)

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const clean = (item: Item) => ({ ...item })
  const visible = (item: Item) => item.scope === 'workspace' || item.createdBy === ME.userId

  function log(item: Item, kind: string, data: Record<string, unknown> | null = null) {
    events.push({ id: `e${events.length + 1}`, workItemId: item.id, actorPrincipalId: ME.principalId, kind, data, createdAt: Date.now() })
  }

  function endRank(status: string, exceptId?: string) {
    const column = items.filter((item) => item.status === status && item.id !== exceptId).sort((a, b) => (a.rank < b.rank ? -1 : 1))
    return rankBetween(column.at(-1)?.rank ?? null, null)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handle(method: string, url: URL, body: any): Promise<Response> {
    const path = url.pathname
    if (path === '/api/v1/work/context' && method === 'GET') {
      return json({ principalId: ME.principalId, role: new URLSearchParams(window.location.search).get('role') ?? 'owner', canCreateInWorkspace: true, people: PEOPLE })
    }
    if (path === '/api/v1/work' && method === 'GET') {
      const view = url.searchParams.get('view')
      const rows = items.filter((item) => visible(item) && (view === 'archived' ? item.archivedAt !== null : item.archivedAt === null) && (!view || view === 'archived' || item.scope === view))
      return json({ items: rows.map(clean).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)) })
    }
    if (path === '/api/v1/work' && method === 'POST') {
      if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: 'Give the task a title.', code: 'work_title_required' }, 400)
      const status = body.status ?? 'todo'
      const item = make({ ...body, title: body.title.trim(), scope: body.scope ?? 'personal', status, rank: endRank(status), createdBy: ME.userId, createdAt: Date.now(), updatedAt: Date.now() })
      items.push(item)
      log(item, 'created', { status })
      return json({ item: clean(item) }, 201)
    }
    const match = /^\/api\/v1\/work\/([^/]+)(?:\/(move|events))?$/.exec(path)
    if (match) {
      const item = items.find((candidate) => candidate.id === decodeURIComponent(match[1]))
      if (!item || !visible(item)) return json({ error: 'Task not found.', code: 'work_not_found' }, 404)
      if (!match[2] && method === 'GET') return json({ item: clean(item) })
      if (!match[2] && method === 'PATCH') {
        if (item.archivedAt !== null) return json({ error: 'Restore the task first.', code: 'work_archived' }, 409)
        if ('status' in body && body.status !== item.status) { log(item, 'status', { from: item.status, to: body.status }); item.rank = endRank(body.status, item.id) }
        if ('assigneePrincipalId' in body && body.assigneePrincipalId !== item.assigneePrincipalId) log(item, 'assignee', { from: item.assigneePrincipalId, to: body.assigneePrincipalId })
        if ('title' in body) { if (!String(body.title).trim()) return json({ error: 'Give the task a title.', code: 'work_title_required' }, 400); body.title = String(body.title).trim() }
        if ('dueDate' in body || 'startDate' in body) {
          const start = 'startDate' in body ? body.startDate : item.startDate
          const due = 'dueDate' in body ? body.dueDate : item.dueDate
          if (start && due && start > due) return json({ error: 'The start date must be on or before the due date.', code: 'work_date_order' }, 400)
          log(item, 'dates', { startDate: start, dueDate: due })
        }
        if ('parentId' in body && body.parentId) {
          let cursor: Item | undefined = items.find((candidate) => candidate.id === body.parentId)
          for (let i = 0; cursor && i < 4; i += 1) { if (cursor.id === item.id) return json({ error: 'A task cannot be moved inside one of its own subtasks.', code: 'work_descendant' }, 400); cursor = items.find((candidate) => candidate.id === cursor!.parentId) }
        }
        if ('blockedBy' in body) {
          const stack = [...body.blockedBy]
          const seen = new Set<string>()
          while (stack.length) {
            const id = stack.pop()!
            if (id === item.id) return json({ error: 'That would make two tasks wait on each other.', code: 'work_cycle' }, 400)
            if (seen.has(id)) continue
            seen.add(id)
            stack.push(...(items.find((candidate) => candidate.id === id)?.blockedBy ?? []))
          }
        }
        Object.assign(item, body, { updatedAt: Date.now() })
        return json({ item: clean(item) })
      }
      if (match[2] === 'move' && method === 'POST') {
        const status = body.status ?? item.status
        const above = items.find((candidate) => candidate.id === body.afterId && candidate.status === status)
        const below = items.find((candidate) => candidate.id === body.beforeId && candidate.status === status)
        if (status !== item.status) log(item, 'status', { from: item.status, to: status })
        item.rank = above || below ? rankBetween(above?.rank ?? null, below?.rank ?? null) : endRank(status, item.id)
        item.status = status
        item.updatedAt = Date.now()
        return json({ item: clean(item) })
      }
      if (match[2] === 'events' && method === 'GET') return json({ events: events.filter((event) => event.workItemId === item.id) })
      if (match[2] === 'events' && method === 'POST') {
        if (!String(body.body ?? '').trim()) return json({ error: 'Write a comment first.', code: 'work_comment_required' }, 400)
        log(item, 'comment', { body: String(body.body).trim() })
        return json({ success: true }, 201)
      }
    }
    if (path === '/api/v1/scope' && method === 'POST') {
      const item = items.find((candidate) => candidate.id === body.id)
      if (!item || !visible(item)) return json({ error: 'Not found.', reason: 'not_found' }, 404)
      if (body.action === 'move') { log(item, 'scope', { from: item.scope, to: body.to }); item.scope = body.to }
      if (body.action === 'archive') {
        const ids = [item.id, ...items.filter((child) => child.parentId === item.id).map((child) => child.id)]
        for (const id of ids) { const row = items.find((candidate) => candidate.id === id)!; row.archivedFromScope = row.scope; row.archivedAt = Date.now() }
        log(item, 'archived')
      }
      if (body.action === 'restore') {
        const archivedAt = item.archivedAt
        for (const row of items.filter((candidate) => candidate.archivedAt === archivedAt || candidate.id === item.id)) { row.scope = row.archivedFromScope ?? row.scope; row.archivedAt = null; row.archivedFromScope = null }
        log(item, 'restored')
      }
      return json({ success: true })
    }
    return json({ error: `Unhandled ${method} ${path}` }, 500)
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.origin)
    if (!url.pathname.startsWith('/api/v1/work') && url.pathname !== '/api/v1/scope') return original(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {}
    state.calls.push({ method, path: url.pathname + url.search, body })
    await new Promise((resolve) => setTimeout(resolve, state.latency))
    if (state.failNext && state.failNext.match.test(`${method} ${url.pathname}`)) {
      const failure = state.failNext
      state.failNext = null
      return json({ error: failure.error }, failure.status)
    }
    return handle(method, url, body)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__work = {
    state,
    dump: () => items.map(clean),
    events: () => events,
    reset: () => { items = seed(); events = [] },
    clear: () => { items = [] },
    add: (partial: Item) => { const item = make(partial); items.push(item); return item },
  }
}
