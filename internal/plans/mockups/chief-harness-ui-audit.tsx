import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, ArrowUpRight, Bot, ChevronRight, Folder, Info, ListChecks, Menu, MessageSquare, Plus, Settings, Sun, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { RunPlan } from '../../../packages/overlay-chat-react/src/components/exchange/run-plan'
import { Creature } from '../../../src/components/orb/Creature'
import { AgentThreadRows } from '../../../src/components/layout/AppSidebarAgentThreads'
import { AgentActivitySummary, ThreadActivityIndicator } from '../../../src/components/layout/sidebar/ThreadActivityIndicator'
import { AgentAssignments } from '../../../src/features/chat/components/AgentAssignments'
import { LegacyAssignmentRows as AssignmentExecutionRows } from './legacy-work-assignment-rows'
import { THREAD_ACTIVITY_LABELS, resolveThreadActivity, type ThreadActivityStatus } from '../../../src/shared/agents/thread-activity'
import type { AssignmentExecution } from '../../../src/shared/work/assignment-execution'

type Scenario = 'working' | 'blocked' | 'revision' | 'complete' | 'exceptions'
type Page = 'chief' | 'sales' | 'product' | 'support' | 'extra' | 'work' | 'mirror' | 'ordinary' | 'guide'
const workers = [
  { id: 'sales', name: 'Sales', title: 'Assess enterprise pipeline', color: '#899eaa', result: 'Acme and Northstar are the strongest pilot candidates. Both have a confirmed sponsor and a clear need for SSO.' },
  { id: 'product', name: 'Product', title: 'Identify launch blockers', color: '#b599bb', result: 'Start a limited pilot after SSO validation. Keep general availability gated on audit-log export and the security review.' },
  { id: 'support', name: 'Support', title: 'Summarize customer concerns', color: '#c8a27a', result: 'Publish migration guidance and name an incident owner before inviting pilot accounts.' },
  { id: 'extra', name: 'Sales', title: 'Review pilot renewal terms', color: '#899eaa', result: 'Return a separate renewal recommendation. This is a second assignment, not a revision of the pipeline task.' },
] as const
const scenarios: { id: Scenario; label: string }[] = [
  { id: 'working', label: 'Working' }, { id: 'blocked', label: 'Needs you' },
  { id: 'revision', label: 'Revision' }, { id: 'complete', label: 'Completed' }, { id: 'exceptions', label: 'Exceptions' },
]
const inventory = [
  ['Chief assignment panel', 'Collapsible Assignments section at the transcript footer, completed/total count, linked title, specialist name and execution status. Excluded assignments show their stated reason.', 'AgentAssignments.tsx; DirectMessageExperience.tsx'],
  ['Specialist thread navigation', 'Each assignment opens its own thread. Assigned from returns to the Chief. Revisions continue in that thread; another assignment to the same agent creates another thread.', 'AgentAssignments.tsx; AgentAssignmentSubscription.tsx'],
  ['Live agent activity', 'Per-agent counts summarize working, ready, needs-you and failed threads. Expanded lists gain new threads without collapsing or refreshing.', 'AgentThreadActivityProvider.tsx; useLiveAgentBundle.ts; AppSidebarAgentsPanel.tsx'],
  ['Thread state icons', 'Working, Needs you, Ready to review, Completed, Failed and Cancelled have distinct icons and tooltips. Opening a completed thread updates its read state. A new idle thread has no status icon.', 'ThreadActivityIndicator.tsx; thread-activity.ts; DirectMessageExperience.hooks.ts'],
  ['Sidebar layout and mobile parity', 'Agent rows reserve a second line for activity. Single-line thread rows include status and hover actions. The mobile drawer reuses the chosen desktop sidebar, including DoubleSidebar or UnifiedSidebar. Existing resizable rail, scope, archive and delete are not new harness features.', 'AppSidebar.tsx; AppSidebarChrome.tsx; AppSidebarAgentThreads.tsx; double-sidebar.css'],
  ['Read-only Work execution rows', 'Agent assignments appear separately below tasks and in the All section of the Work sidebar. They have links to both the child and Chief, agent/status text, Accepted or Excluded text where applicable, and no task checkbox, task edit panel or duplicate editable task.', 'WorkAssignmentExecutions.tsx; WorkPage.tsx; WorkSidebarSection.tsx'],
  ['Work discovery', 'Page search filters loaded assignment titles and agent names. Load more assignments requests the next 25. Workspace/personal scope, archive and access filtering come from the backend; unauthorized rows disappear rather than leaking titles.', 'use-live-work.ts; convex/work/browse.ts'],
  ['Authorized Slack origin', 'Origin: Slack · #channel may appear in the conversation and Work rows when a canonical authorized link exists. Revoked or inaccessible origins are omitted. No new clickable Slack destination is added by this component.', 'AgentAssignments.tsx; WorkAssignmentExecutions.tsx'],
  ['Read-only mirror wording', 'The existing mirror footer now explicitly says: Mirrored from Slack. Read-only here; reply in the original thread. No web-to-Slack send flow is implemented.', 'DirectMessageExperience.parts.tsx'],
  ['Existing Plan stays synchronized', 'Accepting or excluding an assignment now updates the existing delivery/transcript Plan projection as well as Harness state. This is a reliability fix, not a new Plan widget or a compulsory plan.', 'convex/harness/runs.ts'],
  ['Clean navigation', 'Stable read-marker arguments and mutation callbacks prevent idle rerenders from repeatedly writing read state. The empty-composer navigation warning is fixed without disabling the notes editor’s genuine unsaved-change warning.', 'useRoomState.ts; CollaborationRealtimeProvider.tsx'],
  ['No invented control surfaces', 'Acceptance, cancellation, exclusion and revision are agent tools, not new buttons. Attempts/results have no new standalone inspector. Slack Chief routing, personal-Chief consent screens and external-agent flows remain out of scope.', 'Phases 1–3 implementation boundary'],
]

function executionStatus(id: string, scenario: Scenario) {
  if (scenario === 'complete') return 'completed'
  if (scenario === 'exceptions') return id === 'product' ? 'failed' : id === 'support' ? 'cancelled' : 'completed'
  if (id === 'sales') return 'completed'
  if (scenario === 'blocked') return id === 'product' ? 'waiting_for_input' : 'completed'
  if (scenario === 'revision') return id === 'product' ? 'running' : 'completed'
  return 'running'
}

function Guide() {
  const [settled, setSettled] = React.useState(true)
  return <article className="audit-guide">
    <div className="audit-kicker">Implementation inventory · not a product screen</div>
    <h1>What the Chief harness changed</h1>
    <p className="audit-intro">A code-grounded tour of PR #409, not the earlier proposed Slack design. Fictional data, no live services. The preview controls above the workspace switch fixtures; they are not product controls.</p>
    <div className="audit-merge"><strong>Not merge-ready</strong><p>Reviewed branch 5ae65dcbe against main 94b6d5efe. Main has 82 commits absent from the branch. A non-mutating merge check found five conflicted files; no branch merge, deployment or combined-revision testing was performed.</p>
      <ul><li>agent-tooling.ts: combine inherited privacy restrictions with main’s task-scoped tools.</li><li>native-turn-start.ts: keep turn serialization and main’s retry-policy preservation.</li><li>directMessages.ts: preserve queue admission and public-stream imports.</li><li>WorkPage.tsx: retain main’s composer/onboarding and the assignment section.</li><li>CHANGELOG.md: retain both histories.</li></ul>
      <p>Streaming, long-response continuation, cancellation and assignment recovery still need integrated regression testing after reconciliation. The Work preview shows the branch snapshot, not a proposed replacement for main’s newer composer.</p>
    </div>
    <ol>{inventory.map(([title, detail, source]) => <li key={title}><h2>{title}</h2><p>{detail}</p><code>{source}</code></li>)}</ol>
    <h2>Every activity state</h2><div className="audit-state-gallery">{(Object.keys(THREAD_ACTIVITY_LABELS) as ThreadActivityStatus[]).map(status => <span key={status}><ThreadActivityIndicator status={status} />{THREAD_ACTIVITY_LABELS[status]}</span>)}</div>
    <h2>Existing Plan: corrected settlement projection</h2>
    <p className="audit-intro">Same product component, different persisted state. This fixture illustrates the previously stale milestone and the corrected projection after acceptance or exclusion. The settled plan normally lives inside the existing Worked for dropdown.</p>
    <Button size="sm" variant="outline" onClick={() => setSettled(value => !value)}>{settled ? 'Show former stale state' : 'Show corrected state'}</Button>
    <RunPlan phase={settled ? 'ended' : 'active'} steps={[{ id: 'collect', title: 'Collect specialist recommendations', status: settled ? 'done' : 'running' }, { id: 'synthesize', title: 'Deliver the launch recommendation', status: 'done' }]} />
    <p className="audit-intro">Presentation reused directly: AgentAssignments, AssignmentExecutionRows, AgentThreadRows, activity indicators, production DoubleSidebar, OverlayMark and creature avatars. Routing and data hooks are offline adapters. Surrounding transcript copy is illustrative. Plan synchronization and navigation safeguards are documented here, not claimed as tested by a static mockup.</p>
    <a href="https://github.com/LayerNorm/overlay-web/pull/409" target="_blank" rel="noreferrer">Open PR #409 <ArrowUpRight size={13} /></a>
  </article>
}

function App() {
  const [page, setPage] = React.useState<Page>('chief')
  const [scenario, setScenario] = React.useState<Scenario>('working')
  const [dark, setDark] = React.useState(false)
  const [scope, setScope] = React.useState<'workspace' | 'personal'>('workspace')
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [closedAgents, setClosedAgents] = React.useState<string[]>([])
  const [read, setRead] = React.useState<string[]>([])
  const [archived, setArchived] = React.useState<string[]>([])
  const [extra, setExtra] = React.useState(false)
  const [origin, setOrigin] = React.useState(false)
  const [restricted, setRestricted] = React.useState(false)
  const [more, setMore] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const current = workers.find(item => item.id === page)
  const open = React.useCallback((id: string) => {
    if (location.hash !== `#${id}`) location.hash = id
    setPage(id as Page); setMobileOpen(false); setDraft('')
    setRead(previous => previous.includes(id) ? previous : [...previous, id])
  }, [])
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  React.useEffect(() => {
    const onHash = () => { const id = location.hash.slice(1); if (['chief', 'sales', 'product', 'support', 'extra', 'work', 'mirror', 'ordinary', 'guide'].includes(id)) open(id) }
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('hashchange', onHash); window.addEventListener('keydown', close)
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', close) }
  }, [open])
  React.useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer) }, [notice])
  const showOrigin = (origin || page === 'mirror') && !restricted
  const originValue = showOrigin ? { platform: 'slack' as const, channelId: 'launch', channelName: 'launch', threadLinkId: 'preview-link' } : undefined
  const allItems: AssignmentExecution[] = workers.filter(item => item.id !== 'extra' || extra).map(item => ({
    kind: 'agent_assignment', assignmentId: item.id, attemptId: scenario === 'revision' && item.id === 'product' ? 'attempt-2' : 'attempt-1',
    conversationId: item.id, agentId: item.id === 'extra' ? 'sales' : item.id, agentName: item.name, title: item.title, scope,
    agent: { avatarColor: item.color }, brief: `${item.title}. Return a concise recommendation using authorized workspace context.`, createdAt: 1,
    status: executionStatus(item.id, scenario),
    disposition: scenario === 'exceptions' && item.id !== 'sales' ? 'excluded' : scenario === 'complete' || item.id === 'sales' ? 'accepted' : undefined,
    dispositionReason: scenario === 'exceptions' ? item.id === 'product' ? 'Release data unavailable; omitted from this recommendation.' : 'Optional follow-up cancelled by the Chief.' : undefined,
    parent: { conversationId: 'chief', agentId: 'chief', title: 'Enterprise launch plan', scope }, origin: originValue,
  }))
  const accessible = restricted ? [] : allItems
  const workItems = accessible.filter(item => !archived.includes(item.conversationId))
  const searchItems = workItems.filter(item => `${item.title} ${item.agentName}`.toLowerCase().includes(query.toLowerCase()))
  const chiefStatus = scenario === 'complete' ? 'completed' : scenario === 'blocked' ? 'waiting_for_input' : 'running'
  const activity = (id: string, status: string): ThreadActivityStatus => resolveThreadActivity({ status, updatedAt: 100, completedAt: status === 'completed' ? 100 : undefined }, { lastReadAt: read.includes(id) ? 101 : 0 })
  const mutedAction = () => setNotice('Existing product control. This offline mockup does not change account or workspace data.')
  const parent = current && !restricted ? { assignmentId: current.id, title: 'Enterprise launch plan', href: '#chief' } : null
  const title = page === 'work' ? 'List' : page === 'guide' ? 'UI change guide' : page === 'ordinary' ? 'Draft a customer follow-up' : current?.title ?? 'Enterprise launch plan'

  const agentMenu = <SidebarMenu className="cos-agents-menu">{[{ id: 'chief', name: 'Overlay', color: '' }, ...workers.slice(0, 3)].map(agent => {
    const entries = agent.id === 'chief' ? [{ conversationId: 'chief', title: 'Enterprise launch plan', status: chiefStatus }]
      : accessible.filter(item => item.agentId === agent.id).map(item => ({ conversationId: item.conversationId, title: item.title, status: item.status }))
    const visible = entries.filter(item => !archived.includes(item.conversationId))
    const statuses = visible.map(item => ({ conversationId: item.conversationId, status: activity(item.conversationId, item.status) }))
    const expanded = !closedAgents.includes(agent.id)
    return <SidebarMenuItem key={agent.id}><div className="cos-agent-row">
      <SidebarMenuButton className="cos-agent-button" onClick={() => open(agent.id)}>
        <span className="cos-agent-avatar">{agent.id === 'chief' ? <OverlayMark size={24} /> : <Creature color={agent.color} size={24} animated={false} />}</span>
        <span className="cos-agent-copy"><span>{agent.name}</span><AgentActivitySummary activity={statuses} fallback={agent.id === 'chief' ? 'Workspace Chief of Staff' : undefined} /></span>
      </SidebarMenuButton>
      <SidebarMenuAction className="cos-new-thread" aria-label={`New thread with ${agent.name}`} onClick={mutedAction}><Plus /></SidebarMenuAction>
      <SidebarMenuAction className="cos-expand-agent" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${agent.name}`} aria-expanded={expanded} onClick={() => setClosedAgents(previous => expanded ? [...previous, agent.id] : previous.filter(id => id !== agent.id))}><ChevronRight className={expanded ? 'rotate-90' : ''} /></SidebarMenuAction>
    </div>{expanded && <AgentThreadRows agent={agent as unknown as React.ComponentProps<typeof AgentThreadRows>['agent']}
      bundle={{ threads: visible, automations: [] } as unknown as React.ComponentProps<typeof AgentThreadRows>['bundle']}
      activeConversationId={page} activity={statuses} onOpenThread={(_agent, id) => open(id)} onOpenAutomation={mutedAction}
      onArchiveThread={(_agent, id) => { setArchived(previous => [...previous, id]); setNotice('Archived in this preview. Undo restores the thread and Work row.') }} onDeleteThread={mutedAction} />}</SidebarMenuItem>
  })}</SidebarMenu>

  const workSidebar = <div className="audit-work-sidebar"><Button variant="ghost" className="audit-all" onClick={() => open('work')}><ListChecks size={15} />All</Button><p className="audit-existing">Publish launch checklist</p>
    {workItems.length > 0 && <section aria-label="Sidebar agent assignments" className="mt-3 border-t border-(--border) pt-3"><h2 className="px-2 text-xs font-medium text-(--muted)">Agent assignments</h2><AssignmentExecutionRows items={workItems} /></section>}
  </div>

  return <>
    <div className="audit-toolbar" aria-label="Mockup controls"><div className="audit-toolbar-title"><strong>Chief harness</strong><span>Implemented UI · PR #409</span></div>
      <div className="cos-switch">{(['chief', 'work', 'mirror', 'guide'] as const).map(id => <Button key={id} variant="ghost" size="sm" aria-pressed={page === id} onClick={() => open(id)}>{id === 'chief' ? 'Chief' : id === 'work' ? 'Work' : id === 'mirror' ? 'Slack origin' : 'Change guide'}</Button>)}</div>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(value => !value)}><Sun size={15} /></Button>
    </div>
    <div className="audit-fixtures" aria-label="Fixture controls"><span>Preview state</span><div className="audit-scenarios">{scenarios.map(item => <Button size="sm" variant="ghost" key={item.id} aria-pressed={scenario === item.id} onClick={() => { setScenario(item.id); setRead([]) }}>{item.label}</Button>)}</div>
      <Button size="sm" variant="ghost" onClick={() => { setExtra(value => !value); setClosedAgents(previous => previous.filter(id => id !== 'sales')) }}>{extra ? 'Remove new assignment' : 'Simulate new assignment'}</Button>
      <Button size="sm" variant="ghost" aria-pressed={restricted} onClick={() => setRestricted(value => !value)}>{restricted ? 'Restore access' : 'Restricted viewer'}</Button>
    </div>
    <div data-app-shell className={`cos-shell audit-shell ${mobileOpen ? 'cos-nav-open' : ''}`}>
      <div className="cos-navigation" data-sidebar-drawer={mobileOpen || undefined}><DoubleSidebar brand={<BrandLockup />} railBrand={<OverlayMark size={26} />} title={page === 'work' ? 'Work' : 'Agents'} collapsed={collapsed} onCollapsedChange={setCollapsed} resizable keyboardShortcut
        panelId="audit-sidebar" panelKind={page === 'work' ? 'work' : 'agents'} themePreset={dark ? 'default-dark' : 'default-light'} scope={scope}
        panelNav={{ activeId: scope, onSelect: id => setScope(id as 'personal' | 'workspace'), items: [{ id: 'personal', label: 'Personal' }, { id: 'workspace', label: 'Workspace' }] }}
        items={[{ id: 'work', label: 'Work', icon: ListChecks, active: page === 'work', onSelect: () => open('work') }, { id: 'agents', label: 'Agents', icon: Bot, active: page !== 'work', onSelect: () => open('chief') }, { id: 'chat', label: 'Chats', icon: MessageSquare, onSelect: () => open('ordinary') }, { id: 'files', label: 'Files', icon: Folder, onSelect: mutedAction }, { id: 'automations', label: 'Automations', icon: Workflow, onSelect: mutedAction }]}
        footerItems={[{ id: 'settings', label: 'Settings', icon: Settings, onSelect: mutedAction }]} onSearch={mutedAction} panelAction={{ label: 'Add agent', onClick: mutedAction }}
        account={<Button size="icon-sm" variant="ghost" className="cos-account" aria-label="Account" onClick={mutedAction}>DL</Button>}>{page === 'work' ? workSidebar : agentMenu}</DoubleSidebar></div>
      {mobileOpen && <Button variant="ghost" className="cos-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="cos-main"><header className="cos-header"><Button variant="ghost" size="icon-sm" className="cos-menu" aria-label="Open navigation" onClick={() => setMobileOpen(value => !value)}><Menu size={17} /></Button><span className="cos-muted">{page === 'work' ? 'Work' : 'Agents'}</span><ChevronRight size={12} /><span className="cos-truncate">{current?.name ?? 'Overlay'}</span><span className="cos-grow" /><span className="audit-header-note">{scope === 'workspace' ? 'Workspace' : 'Personal'}</span></header>
        <div className="cos-scroll" key={`${page}-${scope}`}>{page === 'guide' ? <Guide /> : page === 'work' ? <div className="audit-work">
          <div className="audit-work-header"><h1>List</h1><Input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <div className="audit-branch-note"><Info size={14} /><span>Branch snapshot. Main’s newer task composer and onboarding must be retained when reconciling. Assignment rows below are the harness addition.</span></div>
          <Button variant="ghost" className="audit-quick-add" onClick={mutedAction}><Plus size={15} />Add a task…</Button>
          {!query && <div className="audit-task"><span className="audit-task-circle" /><span>Publish launch checklist</span><span className="cos-grow" /><span className="cos-muted">Dev</span></div>}
          {searchItems.length > 0 && <section className="audit-work-executions" aria-label="Agent assignments"><h2 className="px-2 text-xs font-medium text-(--muted)">Agent assignments</h2><AssignmentExecutionRows items={searchItems} />
            {more && <AssignmentExecutionRows items={[{ ...searchItems[0], assignmentId: 'older-preview', title: 'Earlier assignment (pagination fixture)' }]} />}
            {!more && <Button size="sm" variant="ghost" onClick={() => setMore(true)}>Load more assignments</Button>}</section>}
          <div className="audit-caption">Read-only execution records, separate from editable Work tasks. {restricted ? 'Restricted-viewer fixture hides assignments.' : 'Search matches loaded titles and agent names.'} Pagination is illustrated with a short fixture, not 25 real records.</div>
        </div> : <div className="cos-transcript audit-transcript">
          <h1>{title}</h1>
          {page === 'mirror' && <div className="audit-branch-note"><Info size={14} /><span>Authorized legacy Slack-origin fixture. Chief-only Slack execution is not enabled in this PR.</span></div>}
          {restricted && <div className="audit-branch-note">Assignments and origin metadata are withheld in this viewer fixture. The visible parent transcript is illustrative, not a live permission test.</div>}
          {current ? <>
            <div className="cos-human"><div className="cos-human-meta">Overlay · assignment brief</div><p>{current.title}. Return a concise recommendation using authorized workspace context.</p></div>
            <div className="cos-message-label"><Creature color={current.color} size={24} animated={false} /><strong>{current.name}</strong></div>
            <p>{scenario === 'exceptions' && current.id !== 'sales' ? current.id === 'product' ? 'I could not obtain the release data. This assignment failed.' : 'This assignment was cancelled before completion.' : executionStatus(current.id, scenario) === 'completed' ? current.result : scenario === 'blocked' && current.id === 'product' ? 'Should the recommendation cover a limited pilot or general availability?' : 'I’m reviewing the brief and the available workspace context.'}</p>
            {scenario === 'revision' && current.id === 'product' && <><div className="cos-divider">Later in the same assignment thread</div><div className="cos-human"><div className="cos-human-meta">Overlay</div><p>Revise the recommendation to separate pilot gates from general-availability gates.</p></div><p>I’ll revise the readiness assessment in this thread.</p></>}
            <AgentAssignments parent={parent} assignments={[]} />
          </> : <>
            <div className="cos-human"><div className="cos-human-meta">Dev{page === 'mirror' ? ' · via Slack' : ''}</div><p>{page === 'ordinary' ? 'Draft a concise follow-up for a customer.' : 'Prepare an enterprise launch plan using pipeline, product readiness and support feedback.'}</p></div>
            <div className="cos-message-label"><OverlayMark size={24} /><strong>Overlay</strong></div>
            <p>{page === 'ordinary' ? 'Here is a short draft you can adapt for the customer.' : scenario === 'complete' ? 'Start with a two-account pilot, not a broad launch. Sales identified the accounts, Product separated the release gates, and Support prepared the onboarding checklist.' : scenario === 'blocked' ? 'Product needs a decision on the rollout scope. Should this plan cover a limited pilot or general availability?' : scenario === 'exceptions' ? 'The pipeline review is available. Product failed and the optional Support follow-up was cancelled; neither is represented as successful work.' : scenario === 'revision' ? 'I’ve asked Product to revise its readiness assessment in the existing assignment thread.' : 'I’ll coordinate Sales, Product and Support, gather their findings and return one launch recommendation.'}</p>
            {page !== 'ordinary' && <AgentAssignments parent={null} origin={originValue} assignments={accessible.map(item => ({ assignmentId: item.assignmentId, title: item.title, href: `#${item.conversationId}`, agentName: item.agentName, status: item.status, disposition: item.disposition, dispositionReason: item.dispositionReason }))} />}
          </>}
          {page !== 'ordinary' && !['completed', 'failed', 'cancelled'].includes(current ? executionStatus(current.id, scenario) : chiefStatus) && <OverlayMark size={24} motion="look" />}
        </div>}</div>
        {page !== 'guide' && page !== 'work' && (page === 'mirror' ? <div className="audit-read-only">Mirrored from Slack. Read-only here; reply in the original thread.</div> : <div className="cos-composer-wrap"><div className="cos-composer"><Textarea aria-label="Preview message" placeholder="Message…" value={draft} onChange={event => setDraft(event.target.value)} /><div><span>Illustrative conversation · nothing is sent</span><Button variant="secondary" size="icon-sm" aria-label="Send preview message" onClick={() => { setNotice('Mockup only. No request was sent.'); setDraft('') }}><ArrowUp size={16} /></Button></div></div></div>)}
        <footer className="audit-footer"><span>{page === 'work' ? 'New: assignment execution rows, links and dispositions.' : current ? 'New: dedicated assignment thread and Assigned from backlink.' : page === 'mirror' ? 'New: authorized origin label and explicit read-only wording.' : page === 'guide' ? 'Source-grounded inventory, including nonvisual fixes and excluded scope.' : page === 'ordinary' ? 'Unchanged: ordinary threads have no assignment panel.' : 'New: assignment panel, live sidebar states and navigation.'}</span><Button variant="ghost" size="sm" onClick={() => setOrigin(value => !value)}>{origin ? 'Hide origin fixture' : 'Show origin fixture'}</Button></footer>
      </main>
    </div>
    {notice && <div role="status" className="cos-toast audit-toast"><span>{notice}</span>{archived.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setArchived([]); setNotice('Thread and execution row restored.') }}>Undo</Button>}<Button variant="ghost" size="icon-sm" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></Button></div>}
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
