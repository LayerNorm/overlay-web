'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import {
  ArrowUp, AtSign, Bell, Bot, Check, ChevronDown, ChevronRight, CircleAlert, Circle, CircleCheck, CircleDot, Ellipsis,
  FileCode, FileSpreadsheet, FileText, Files, Folder, Hash, Image, Kanban, Layers, List, ListChecks, Lock, MessageSquare,
  Moon, PanelLeft, PanelRight, Pin, Plus, Receipt, Rocket, RotateCw, Search, Settings, Upload, User, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { LANDING_AGENTS, LANDING_PEOPLE, LandingAgent, LandingPerson, type LandingAgentId } from './LandingAgent'
import {
  CHAT_GROUPS, PREVIEW_AGENTS, PREVIEW_CHATS, PREVIEW_FILES, PREVIEW_WORK, SCOPE_AGENTS, previewThread,
  type FileKind, type Scope, type ThreadMessage, type Who, type WorkStatus,
} from './landingAppData'

type View = 'agents' | 'chats' | 'work' | 'files'
type Tab = 'details' | 'library' | 'computer'
type WorkFilter = 'mine' | 'needs' | 'all'
type PreviewState = {
  view: View; scope: Scope; agent: LandingAgentId; thread: number; chat: string
  work: WorkFilter; folder: string; right: boolean; tab: Tab
}

const isAgent = (who: Who): who is LandingAgentId => who in LANDING_AGENTS
const nameOf = (who: Who) => (isAgent(who) ? LANDING_AGENTS[who].name : LANDING_PEOPLE[who].name)
function Avatar({ who, size, working = false }: { who: Who; size: number; working?: boolean }) {
  return isAgent(who) ? <LandingAgent id={who} size={size} working={working} /> : <LandingPerson id={who} size={size} />
}

/** A clickable element in the preview. Uses the shared Button with its styling reset. */
function Hit({ className, onClick, label, children }: { className: string; onClick: () => void; label?: string; children: ReactNode }) {
  return <Button variant="ghost" type="button" className={unstyledButton(className)} onClick={onClick} aria-label={label}>{children}</Button>
}

const FILE_ICON: Record<FileKind, LucideIcon> = { doc: FileText, code: FileCode, sheet: FileSpreadsheet, image: Image }
const STATUS: Array<[WorkStatus, string, LucideIcon]> = [['progress', 'In progress', CircleDot], ['todo', 'To do', Circle], ['done', 'Done', CircleCheck]]

function Crumb({ scope, view, children }: { scope: Scope; view: string; children?: ReactNode }) {
  return (
    <span className="a-crumb">
      {scope === 'personal' ? 'Personal' : 'Workspace'}<ChevronRight className="i xs" />{view}
      {children ? <><ChevronRight className="i xs" /><b>{children}</b></> : null}
    </span>
  )
}

function Composer({ placeholder, model = false }: { placeholder: string; model?: boolean }) {
  return (
    <div className="a-comp">
      <div className="ph">{placeholder}</div>
      <div className="row"><Plus className="i sm" /><AtSign className="i sm" />{model ? <span className="model">Claude Opus 5.5<ChevronDown className="i xs" /></span> : null}<span className="send"><ArrowUp className="i sm" /></span></div>
    </div>
  )
}

function Orb() {
  return <span className="orb" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
}

function AgentMessage({ agent, message }: { agent: LandingAgentId; message: Exclude<ThreadMessage, { me: ReactNode }> }) {
  return (
    <div className="a-msg">
      <LandingAgent id={agent} size={22} working={Boolean(message.running)} />
      <div className="a-body">
        <div className="a-who">{LANDING_AGENTS[agent].name}<time>{message.time}</time></div>
        {message.tools ? <div className="a-tools">{message.tools}<ChevronRight className="i xs" /></div> : null}
        {message.body}
        {message.running ? <div className="a-run"><Orb />{message.running}</div> : null}
      </div>
    </div>
  )
}

/**
 * The Overlay app as a clickable preview on the home page: the icon rail
 * (Work, Agents, Chats, Files), the Personal/Workspace switch, agents and
 * their threads, channels and DMs, work, files and the right panel
 * (Details, Library, Computer). Layout and colors follow the production
 * shell; content is fixture data from landingAppData.
 */
export function LandingAppPreview({ initial, className = '', label }: { initial?: Partial<PreviewState>; className?: string; label: string }) {
  const [st, setSt] = useState<PreviewState>({
    view: 'agents', scope: 'workspace', agent: 'overlay', thread: 0, chat: 'atlas-launch', work: 'all', folder: '', right: true, tab: 'details', ...initial,
  })
  const set = (patch: Partial<PreviewState>) => setSt((s) => ({ ...s, ...patch }))
  const setScope = (scope: Scope) => set({ scope, agent: SCOPE_AGENTS[scope][0], thread: 0, chat: CHAT_GROUPS[scope][0][1][0], folder: '' })
  const openAgent = (agent: LandingAgentId) => set({ view: 'agents', agent, thread: 0 })
  const hasRight = st.view === 'agents' && st.right

  const seg = (
    <div className="a-seg">
      {(['personal', 'workspace'] as const).map((s) => (
        <Hit key={s} className={st.scope === s ? 'on' : ''} onClick={() => setScope(s)}>{s === 'personal' ? 'Personal' : 'Workspace'}</Hit>
      ))}
    </div>
  )
  const sideHead = (title: string) => <div className="a-side-h">{title}<span className="a-icons"><Bell className="i sm" /><Search className="i sm" /><Plus className="i sm" /></span></div>

  const railItem = (view: View, Icon: LucideIcon, title: string) => (
    <Hit className={st.view === view ? 'a-ri on' : 'a-ri'} onClick={() => set({ view })} label={title}><Icon className="i" /></Hit>
  )
  const rail = (
    <nav className="a-rail" aria-label="App sections">
      <Hit className="a-logo" onClick={() => set({ view: 'agents' })} label="Overlay"><LandingAgent id="overlay" size={22} /></Hit>
      {railItem('work', ListChecks, 'Work')}{railItem('agents', Bot, 'Agents')}{railItem('chats', MessageSquare, 'Chats')}{railItem('files', Folder, 'Files')}
      <span className="a-ri"><Ellipsis className="i" /></span>
      <span className="a-rail-foot"><span className="a-ri"><Moon className="i" /></span><span className="a-ri"><Settings className="i" /></span><span className="a-me"><LandingPerson id="maya" size={26} /></span></span>
    </nav>
  )

  let side: ReactNode
  let main: ReactNode
  if (st.view === 'agents') {
    side = <>{sideHead('Agents')}{seg}{SCOPE_AGENTS[st.scope].map((id) => {
      const p = PREVIEW_AGENTS[id], open = id === st.agent, isChief = 'isDefault' in LANDING_AGENTS[id]
      return (
        <div key={id}>
          <Hit className="a-agent" onClick={() => openAgent(id)}>
            <LandingAgent id={id} size={20} working={Boolean(p.status?.includes('working'))} />
            <span><span className="a-an">{LANDING_AGENTS[id].name}{isChief ? <Pin className="i pin" /> : null}</span>{p.status ? <span className="a-as ok">{p.status}</span> : null}</span>
            <span className="a-ac"><Plus className="i sm" />{open ? <ChevronDown className="i sm" /> : <ChevronRight className="i sm" />}</span>
          </Hit>
          {open ? p.threads.map(([title, state], i) => (
            <Hit key={title} className={st.thread === i ? 'a-thread on' : 'a-thread'} onClick={() => set({ thread: i })}>
              {state === 'run' ? <span className="a-spin" /> : state === 'done' ? <Check className="i sm a-ok" /> : <span className="a-blank" />}{title}
            </Hit>
          )) : null}
        </div>
      )
    })}</>
    main = <>
      <header className="a-head"><PanelLeft className="i sm" /><Crumb scope={st.scope} view="Agents"><LandingAgent id={st.agent} size={18} />{LANDING_AGENTS[st.agent].name}</Crumb>
        <span className="a-icons"><Ellipsis className="i sm" />{st.scope === 'workspace' ? <span className="a-ppl"><Users className="i sm" />3</span> : <Lock className="i sm" />}
          <Hit className={st.right ? 'a-btn on' : 'a-btn'} onClick={() => set({ right: !st.right })} label="Toggle the right panel"><PanelRight className="i sm" /></Hit></span></header>
      <div className="a-scroll">
        <div className="a-date">TUE, NOV 25, 2026</div>
        {previewThread(st.agent, st.thread).map((m, i) => ('me' in m ? <div className="a-me-msg" key={i}>{m.me}</div> : <AgentMessage key={i} agent={st.agent} message={m} />))}
      </div>
      <Composer placeholder="What do you want to get done?" model />
    </>
  } else if (st.view === 'chats') {
    const c = PREVIEW_CHATS[st.chat]
    side = <>{sideHead('Chats')}{seg}{CHAT_GROUPS[st.scope].map(([group, ids]) => (
      <div key={group}>
        <div className="a-grp">{group}<ChevronDown className="i xs" /></div>
        {ids.map((id) => { const chat = PREVIEW_CHATS[id]; return (
          <Hit key={id} className={st.chat === id ? 'a-item on' : 'a-item'} onClick={() => set({ chat: id })}>
            {chat.kind === 'channel' ? <Hash className="i sm" /> : chat.kind === 'ai' ? <MessageSquare className="i sm" /> : <Avatar who={chat.with!} size={18} />}<span>{chat.title}</span>
          </Hit>
        ) })}
      </div>
    ))}</>
    main = <>
      <header className="a-head"><PanelLeft className="i sm" /><Crumb scope={st.scope} view="Chats">{c.kind === 'channel' ? <><Hash className="i sm" />{c.title}<span className="a-sub">{c.members!.length + 1} members</span></> : c.with ? <><Avatar who={c.with} size={18} />{c.title}</> : c.title}</Crumb>
        <span className="a-icons">{c.members ? <span className="a-stack">{c.members.map((m) => <Avatar key={m} who={m} size={20} />)}</span> : null}<Ellipsis className="i sm" /></span></header>
      <div className="a-scroll">
        <div className="a-date">TUE, NOV 25, 2026</div>
        {c.messages.map((m, i) => ('me' in m ? <div className="a-me-msg" key={i}>{m.me}</div> : (
          <div className="a-msg" key={i}><Avatar who={m.who} size={22} /><div className="a-body"><div className="a-who">{nameOf(m.who)}<time>{m.time}</time></div>{typeof m.body === 'string' ? <p>{m.body}</p> : m.body}</div></div>
        )))}
      </div>
      <Composer placeholder={c.kind === 'channel' ? `Message #${c.title}` : c.kind === 'dm' ? `Message ${c.title}` : 'What do you want to get done?'} />
    </>
  } else if (st.view === 'work') {
    const all = PREVIEW_WORK[st.scope]
    const rows = st.work === 'needs' ? all.filter((w) => w.needsYou) : st.work === 'mine' ? all.filter((w) => w.who === 'maya') : all
    const needs = all.filter((w) => w.needsYou).length
    const filters: Array<[WorkFilter, LucideIcon, string]> = [['mine', User, 'Assigned to me'], ['needs', CircleAlert, 'Needs you'], ['all', Layers, 'Everything']]
    side = <>{sideHead('Work')}{seg}
      {filters.map(([f, Icon, t]) => <Hit key={f} className={st.work === f ? 'a-item on' : 'a-item'} onClick={() => set({ work: f })}><Icon className="i sm" /><span>{t}</span>{f === 'needs' && needs ? <span className="a-n">{needs}</span> : null}</Hit>)}
      {st.scope === 'workspace' ? <><div className="a-grp">Projects<ChevronDown className="i xs" /></div><span className="a-item"><Rocket className="i sm" /><span>Atlas launch</span></span><span className="a-item"><Receipt className="i sm" /><span>November close</span></span></> : null}
    </>
    main = <>
      <header className="a-head"><PanelLeft className="i sm" /><Crumb scope={st.scope} view="Work">{filters.find((f) => f[0] === st.work)![2]}</Crumb><span className="a-icons"><List className="i sm" /><Kanban className="i sm" /><Plus className="i sm" /></span></header>
      <div className="a-list">
        {STATUS.map(([k, title, Icon]) => {
          const group = rows.filter((w) => w.status === k)
          if (!group.length) return null
          return (
            <div key={k}>
              <div className="a-lh"><Icon className={`i sm st-${k}`} />{title}<span>{group.length}</span></div>
              {group.map((w) => {
                const inner = <><Icon className={`i sm st-${k}`} /><span className="t">{w.title}</span>{w.needsYou ? <span className="a-tag">Needs you</span> : null}<span className="due">{w.due}</span><span className="who"><Avatar who={w.who} size={20} working={k === 'progress'} />{nameOf(w.who)}</span></>
                const who = w.who
                return isAgent(who) && SCOPE_AGENTS[st.scope].includes(who)
                  ? <Hit key={w.title} className="a-li" onClick={() => openAgent(who)}>{inner}</Hit>
                  : <div key={w.title} className="a-li">{inner}</div>
              })}
            </div>
          )
        })}
      </div>
    </>
  } else {
    const files = PREVIEW_FILES[st.scope]
    const folders = [...new Set(files.map((f) => f.folder))]
    const rows = files.filter((f) => !st.folder || f.folder === st.folder)
    side = <>{sideHead('Files')}{seg}
      <Hit className={!st.folder ? 'a-item on' : 'a-item'} onClick={() => set({ folder: '' })}><Files className="i sm" /><span>All files</span></Hit>
      <div className="a-grp">Folders<ChevronDown className="i xs" /></div>
      {folders.map((f) => <Hit key={f} className={st.folder === f ? 'a-item on' : 'a-item'} onClick={() => set({ folder: f })}><Folder className="i sm" /><span>{f}</span></Hit>)}
    </>
    main = <>
      <header className="a-head"><PanelLeft className="i sm" /><Crumb scope={st.scope} view="Files">{st.folder || 'All files'}</Crumb><span className="a-icons"><Search className="i sm" /><Upload className="i sm" /></span></header>
      <div className="a-list">
        <div className="a-lh files"><span className="t">Name</span><span>Made by</span><span>Updated</span></div>
        {rows.map((f) => { const Icon = FILE_ICON[f.kind]; return (
          <div className="a-li files" key={f.name}><Icon className="i sm" /><span className="t">{f.name}</span><span className="who"><Avatar who={f.by} size={18} />{nameOf(f.by)}</span><span className="due">{f.updated}</span></div>
        ) })}
      </div>
    </>
  }

  let right: ReactNode = null
  if (hasRight) {
    const a = PREVIEW_AGENTS[st.agent], name = LANDING_AGENTS[st.agent].name, chief = 'isDefault' in LANDING_AGENTS[st.agent]
    let body: ReactNode
    if (st.tab === 'details') {
      body = <>
        {st.agent === 'overlay' ? <><div className="a-sec">Working on Atlas launch</div>
          {([['engineering', true], ['growth', true], ['docs', false], ['support', false]] as const).map(([id, working]) => (
            <Hit key={id} className="a-row" onClick={() => openAgent(id)}><LandingAgent id={id} size={18} working={working} /><span className="t">{LANDING_AGENTS[id].name}</span><span className={working ? 's ok' : 's'}>{working ? 'Working' : 'Done'}</span></Hit>
          ))}</> : null}
        <div className="a-sec">Agent</div>
        {[['Model', 'Claude Opus 5.5'], ['Tools', a.tools], ['Approvals', 'Ask'], ['Visible to', st.scope === 'personal' ? 'Only you' : 'Everyone in Acme']].map(([k, v]) => (
          <div className="a-row" key={k}><span className="t">{k}</span><span className="s">{v}<ChevronRight className="i xs" /></span></div>
        ))}
      </>
    } else if (st.tab === 'library') {
      const own = PREVIEW_FILES[st.scope].filter((f) => f.by === st.agent || chief)
      body = <><div className="a-sec">Made by {name}</div>
        {own.length ? own.map((f) => { const Icon = FILE_ICON[f.kind]; return <div className="a-row" key={f.name}><Icon className="i sm" /><span className="t">{f.name}</span><span className="s">{f.updated}</span></div> }) : <div className="a-empty">Nothing here yet</div>}</>
    } else {
      const c = a.computer
      body = <><div className="a-sec">{name}’s computer<span className="a-live">Live</span></div>
        <div className="desk a-desk">
          {c.kind === 'term' ? (
            <div className="a-term"><span className="p">$</span> npm test -- checkout<br /><span className="ok">✓</span> cart totals (41 ms)<br /><span className="ok">✓</span> applies discount (12 ms)<br /><span className="ok">✓</span> mobile checkout · iOS (2.1 s)<br /><span className="p">…</span> mobile checkout · Android<span className="caret" /></div>
          ) : (
            <div className="win">
              <div className="win-bar"><span className="lights"><i /><i /><i /></span><span className="tab">{c.page}</span></div>
              <div className="url"><RotateCw className="i xs" /><span><Lock className="i xs" />{c.url}</span></div>
              <div className="page"><div className="hero-img" /><div className="pg-title">{c.page}</div><div className="pg-sub">{name} is working here now.</div><div className="ff"><label>Notes</label><span>Drafting…<i className="caret" /></span></div></div>
            </div>
          )}
        </div></>
    }
    right = (
      <aside className="a-panel a-right" aria-label={`${name} details`}>
        <div className="a-right-x"><Hit className="a-btn" onClick={() => set({ right: false })} label="Close the panel"><X className="i sm" /></Hit></div>
        <div className="a-id"><LandingAgent id={st.agent} size={52} /><b>{name}</b><span>{a.role}</span><p>{a.desc}</p></div>
        <div className="a-tabs">{(['details', 'library', 'computer'] as const).map((t) => <Hit key={t} className={st.tab === t ? 'on' : ''} onClick={() => set({ tab: t })}>{t[0].toUpperCase() + t.slice(1)}</Hit>)}</div>
        <div className="a-rbody">{body}</div>
      </aside>
    )
  }

  return (
    <div className={`lapp ${className}${hasRight ? '' : ' no-right'}`} aria-label={label}>
      {rail}
      <aside className="a-panel a-side">{side}</aside>
      <section className="a-panel a-main" key={`${st.view}:${st.scope}:${st.agent}:${st.thread}:${st.chat}:${st.work}:${st.folder}`}>{main}</section>
      {right}
    </div>
  )
}
