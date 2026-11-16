'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import type { WorkItem, WorkPerson, WorkStatus } from '@overlay/app-core'
import { WorkDataContext, type WorkData } from '../components/WorkDataProvider'
import { WorkList } from '../components/WorkList'
import { WorkBoard } from '../components/WorkBoard'
import { WorkTimeline } from '../components/WorkTimeline'
import { Avatar, StatusIcon } from '../components/work-ui'
import { RoomMessageItem, type RoomMessageView } from '@/features/chat/components/collaboration/RoomMessageItem'

const TODAY = '2026-11-16'
const NOW = new Date('2026-11-16T10:00:00').getTime()

const PEOPLE: WorkPerson[] = [
  { principalId: 'p-maya', type: 'human', userId: 'u-maya', displayName: 'Maya Chen' },
  { principalId: 'p-sam', type: 'human', userId: 'u-sam', displayName: 'Sam Ortiz' },
  { principalId: 'p-research', type: 'agent', userId: null, displayName: 'Research', avatarColor: '#7c5cff', avatarShape: 'circle', agentVisibility: 'workspace' },
  { principalId: 'p-support', type: 'agent', userId: null, displayName: 'Support', avatarColor: '#f59e0b', avatarShape: 'square', agentVisibility: 'workspace' },
  { principalId: 'p-finance', type: 'agent', userId: null, displayName: 'Finance', avatarColor: '#10b981', avatarShape: 'triangle', agentVisibility: 'workspace' },
]

function task(id: string, title: string, status: WorkStatus, owner: string | null, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id, workspaceId: 'ws', scope: 'workspace', createdBy: 'u-maya', title, description: null, status,
    blocked: false, priority: 2, rank: id, assigneePrincipalId: owner, reviewerUserId: 'u-maya',
    startDate: null, dueDate: null, parentId: null, blockedBy: [], doneWhen: [], context: [],
    archivedAt: null, archivedFromScope: null, createdAt: NOW - 86400000, updatedAt: NOW, ...extra,
  }
}

export const DAY04_TASKS: WorkItem[] = [
  task('t1', 'Competitor pricing brief', 'review', 'p-research', { startDate: '2026-11-12', dueDate: '2026-11-17', doneWhen: [
    { text: 'Compare 6 competitors', checked: true }, { text: 'Cite every price', checked: true }, { text: 'One-page summary', checked: true }] }),
  task('t2', 'Draft Q4 renewal emails', 'review', 'p-support', { startDate: '2026-11-13', dueDate: '2026-11-18' }),
  task('t3', 'Reconcile November invoices', 'progress', 'p-finance', { startDate: '2026-11-14', dueDate: '2026-11-19' }),
  task('t4', 'Pricing page copy', 'progress', 'p-sam', { startDate: '2026-11-15', dueDate: '2026-11-20' }),
  task('t5', 'Summarize churn interviews', 'todo', 'p-research', { startDate: '2026-11-17', dueDate: '2026-11-21' }),
  task('t6', 'Board update deck', 'todo', 'p-maya', { startDate: '2026-11-18', dueDate: '2026-11-22', priority: 1 }),
  task('t7', 'Tag open support tickets', 'todo', 'p-support', { startDate: '2026-11-16', dueDate: '2026-11-18' }),
  task('t8', 'Vendor contract review', 'backlog', null, { startDate: '2026-11-20', dueDate: '2026-11-25' }),
  task('t9', 'Weekly metrics digest', 'done', 'p-finance', { startDate: '2026-11-10', dueDate: '2026-11-13' }),
  task('t10', 'Customer FAQ refresh', 'done', 'p-support', { startDate: '2026-11-09', dueDate: '2026-11-12' }),
]

function useFakeWork(items: WorkItem[]): WorkData {
  return useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]))
    const personByPrincipal = new Map(PEOPLE.map((p) => [p.principalId, p]))
    const noop = async () => null
    return {
      state: 'ready', items, byId, context: { principalId: 'p-maya', role: 'owner', canCreateInWorkspace: true, people: PEOPLE },
      people: PEOPLE, personByPrincipal, viewer: { userId: 'u-maya', principalId: 'p-maya' }, truncated: false,
      canWork: () => true, createTask: noop, updateTask: noop, moveTask: noop, adoptTask: () => {},
    }
  }, [items])
}

const noop = () => {}

function msg(id: string, authorName: string, kind: 'human' | 'agent', text: string, minutesAgo: number, extra: Partial<RoomMessageView> = {}): RoomMessageView {
  const person = PEOPLE.find((p) => p.displayName.startsWith(authorName))
  return {
    id, mine: false, authorName: person?.displayName ?? authorName, authorKind: kind,
    authorColor: person?.avatarColor, authorShape: person?.avatarShape, createdAt: NOW - minutesAgo * 60000 - 3600000,
    text, blocks: kind === 'agent' ? [{ kind: 'text', text }] : [], images: [], documentNames: [], mentions: [], ...extra,
  } as RoomMessageView
}

function Message({ m, grouped = false }: { m: RoomMessageView; grouped?: boolean }) {
  return (
    <RoomMessageItem
      readOnly hideToolbar message={m} reactions={[]} replyCount={0} pinned={false} saved={false}
      editing={false} editingContent="" onEditingContentChange={noop} onSaveEdit={noop} onCancelEdit={noop}
      onStartEdit={noop} onDelete={noop} onReport={noop} onToggleReaction={noop} onTogglePinned={noop}
      onToggleSaved={noop} onOpenThread={noop} onQuoteReply={noop} onRetrySend={noop}
      onOpenAttachmentPreview={noop} onCopyPermalink={noop} grouped={grouped}
    />
  )
}

function Frame({ id, label, children, width = 1440 }: { id: string; label: string; children: ReactNode; width?: number }) {
  return (
    <section data-shot={id} className="mb-16">
      <p className="mb-2 text-xs uppercase tracking-widest text-(--muted-light)">{label}</p>
      <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--background) shadow-sm" style={{ width }}>{children}</div>
    </section>
  )
}

function Header({ title, meta, tabs }: { title: string; meta?: string; tabs?: string[] }) {
  return (
    <div className="flex h-14 items-center gap-4 border-b border-(--border) px-6">
      <h1 className="text-[15px] font-semibold text-(--foreground)">{title}</h1>
      {tabs ? (
        <div className="flex gap-1 text-[13px]">
          {tabs.map((t, i) => (
            <span key={t} className={`rounded-md px-2.5 py-1 ${i === 0 ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'}`}>{t}</span>
          ))}
        </div>
      ) : null}
      {meta ? <span className="text-xs text-(--muted-light)">{meta}</span> : null}
    </div>
  )
}

export function VideoDay04Fixture() {
  const work = useFakeWork(DAY04_TASKS)
  const peekTask = DAY04_TASKS[0]
  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.colorScheme = 'light'
  }, [])

  const channel = [
    msg('m1', 'Maya', 'human', 'Can someone pull together a competitor pricing brief before Thursday?', 14),
    msg('m2', 'Sam', 'human', 'I can take the page copy once we have it.', 12),
    msg('m3', 'Maya', 'human', '@Research this is yours. Linked the task: Competitor pricing brief.', 9, {
      mentions: [{ type: 'agent', id: 'p-research', name: 'Research', avatarColor: '#7c5cff', avatarShape: 'circle' }] as RoomMessageView['mentions'] }),
    msg('m4', 'Research', 'agent', 'On it. I moved Competitor pricing brief to In progress and will check off the Done when list as I go.', 8),
    msg('m5', 'Research', 'agent', 'Done. Compared 6 competitors with cited prices, one-page summary attached. Moved it to In review for @Maya.', 2),
  ]

  return (
    <WorkDataContext.Provider value={work}>
      <main className="overlay-chat-surface min-h-screen bg-(--background) p-10 text-(--foreground)">
        <Frame id="list" label="Work · List">
          <Header title="Tasks" tabs={['List', 'Board', 'Timeline']} meta="8 open" />
          <WorkList items={DAY04_TASKS} byId={work.byId} today={TODAY} selectedId={null} onOpen={noop} />
        </Frame>

        <Frame id="list-narrow" label="Work · List (narrow)" width={900}>
          <Header title="Tasks" tabs={['List', 'Board', 'Timeline']} meta="8 open" />
          <WorkList items={DAY04_TASKS.slice(0, 7)} byId={work.byId} today={TODAY} selectedId={null} onOpen={noop} />
        </Frame>

        <Frame id="board" label="Work · Board" width={1600}>
          <Header title="Tasks" tabs={['Board', 'List', 'Timeline']} meta="8 open" />
          <div className="h-[560px] overflow-hidden"><WorkBoard items={DAY04_TASKS} today={TODAY} selectedId={null} onOpen={noop} /></div>
        </Frame>

        <Frame id="timeline" label="Work · Timeline" width={1600}>
          <Header title="Tasks" tabs={['Timeline', 'List', 'Board']} meta="8 open" />
          <div className="h-[560px]"><WorkTimeline items={DAY04_TASKS} today={TODAY} selectedId={null} onOpen={noop} /></div>
        </Frame>

        <Frame id="channel" label="Channel · #q4-pricing" width={1100}>
          <div className="flex h-14 items-center gap-2 border-b border-(--border) px-6">
            <span className="text-(--muted)">#</span>
            <h1 className="text-[15px] font-semibold">q4-pricing</h1>
            <div className="ml-auto flex -space-x-1.5">
              {PEOPLE.slice(0, 4).map((p) => <Avatar key={p.principalId} person={p} size={24} />)}
            </div>
          </div>
          <div className="py-4">{channel.map((m, i) => <Message key={m.id} m={m} grouped={i > 0 && channel[i - 1].authorName === m.authorName} />)}</div>
        </Frame>

        <Frame id="assign" label="Task panel · assigned" width={560}>
          <div className="p-6">
            <div className="mb-1 text-xs text-(--muted)">Tasks</div>
            <h2 className="mb-5 text-xl font-semibold">{peekTask.title}</h2>
            <dl className="mb-6 grid grid-cols-[110px_1fr] gap-y-3 text-[13px]">
              <dt className="text-(--muted)">Status</dt><dd className="flex items-center gap-2"><StatusIcon status="todo" />Todo</dd>
              <dt className="text-(--muted)">Owner</dt><dd data-mark="owner" className="flex items-center gap-2"><Avatar person={PEOPLE[2]} size={20} />Research</dd>
              <dt className="text-(--muted)">Reviewer</dt><dd className="flex items-center gap-2"><Avatar person={PEOPLE[0]} size={20} />Maya Chen</dd>
              <dt className="text-(--muted)">Due</dt><dd>Nov 17</dd>
            </dl>
            <div className="mb-2 text-[13px] font-medium">Done when</div>
            {peekTask.doneWhen.map((d) => (
              <div key={d.text} className="flex items-center gap-2 py-1 text-[13.5px] text-(--muted)"><StatusIcon status="todo" size={14} />{d.text}</div>
            ))}
          </div>
        </Frame>

        <Frame id="review" label="Task panel · review" width={560}>
          <div className="p-6">
            <div className="mb-1 text-xs text-(--muted)">Tasks</div>
            <h2 className="mb-5 text-xl font-semibold">{peekTask.title}</h2>
            <div className="mb-6 rounded-xl border border-violet-300/70 bg-(--surface-elevated) p-4" data-testid="work-review-card">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-medium"><StatusIcon status="review" />Waiting for your review</div>
              <p className="mb-3 text-[13.5px] leading-relaxed text-(--muted)">“{peekTask.title}” is ready. Approve it to mark it done, or send it back to keep working.</p>
              <div className="flex gap-2">
                <span className="rounded-md bg-(--foreground) px-3 py-1.5 text-[13px] font-medium text-(--background)">Approve</span>
                <span className="rounded-md border border-(--border) px-3 py-1.5 text-[13px] font-medium">Request changes</span>
              </div>
            </div>
            <dl className="mb-6 grid grid-cols-[110px_1fr] gap-y-3 text-[13px]">
              <dt className="text-(--muted)">Status</dt><dd className="flex items-center gap-2"><StatusIcon status="review" />In review</dd>
              <dt className="text-(--muted)">Owner</dt><dd className="flex items-center gap-2"><Avatar person={PEOPLE[2]} size={20} />Research</dd>
              <dt className="text-(--muted)">Reviewer</dt><dd className="flex items-center gap-2"><Avatar person={PEOPLE[0]} size={20} />Maya Chen</dd>
              <dt className="text-(--muted)">Due</dt><dd>Nov 17</dd>
            </dl>
            <div className="mb-2 text-[13px] font-medium">Done when</div>
            {peekTask.doneWhen.map((d) => (
              <div key={d.text} className="flex items-center gap-2 py-1 text-[13.5px] text-(--muted)"><StatusIcon status="done" size={14} />{d.text}</div>
            ))}
          </div>
        </Frame>
      </main>
    </WorkDataContext.Provider>
  )
}
