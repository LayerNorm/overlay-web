import type { ReactNode } from 'react'
import { Creature } from '@/components/orb/Creature'
import { LandingLockup } from '../LandingOrb'
import { DIcon, type DemoIconName } from './demo-icons'
import { FILES } from './demo-data-chats'
import type { DemoAction, DemoState } from './demo-state'
import type { Persona, View } from './demo-types'

type Dispatch = (a: DemoAction) => void

const NAV: Array<[View, string, DemoIconName]> = [
  ['agents', 'Agents', 'bot'],
  ['chats', 'Chats', 'chat'],
  ['files', 'Files', 'file'],
  ['extensions', 'Extensions', 'puzzle'],
  ['automations', 'Automations', 'flow'],
]

/** Far-left rail: workspace navigation. */
export function DemoRail({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  return (
    <div className="col1">
      <div className="head"><LandingLockup /><DIcon name="left" /></div>
      <div className="list">
        {NAV.map(([view, label, icon]) => (
          <button key={view} type="button" tabIndex={-1} className={state.view === view ? 'nav-i on' : 'nav-i'} onClick={() => dispatch({ type: 'nav', view })}>
            <DIcon name={icon} />{label}
          </button>
        ))}
      </div>
      <div className="ws"><b>W</b><span>Your workspace<i>You</i></span></div>
    </div>
  )
}

function Avatar({ who }: { who: Persona }) {
  return <span className="cr"><Creature shape={who.shape} color={who.color} size={13} animated={false} /></span>
}

function Row({ on, icon, label, onClick, trailing }: { on: boolean; icon?: ReactNode; label: string; onClick: () => void; trailing?: ReactNode }) {
  return (
    <button type="button" tabIndex={-1} className={on ? 'row on' : 'row'} onClick={onClick}>
      {icon}<span className="lab">{label}</span>{trailing}
    </button>
  )
}

function ScopeTabs({ scope, onPick }: { scope: 'personal' | 'workspace'; onPick: (s: 'personal' | 'workspace') => void }) {
  return (
    <div className="scope">
      <Row on={scope === 'personal'} icon={<DIcon name="user" />} label="Personal" onClick={() => onPick('personal')} />
      <Row on={scope === 'workspace'} icon={<DIcon name="users" />} label="Workspace" onClick={() => onPick('workspace')} />
    </div>
  )
}

function AgentsList({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const keys = state.scope === 'personal' ? state.personal : state.workspace
  return (
    <>
      <div className="head"><span className="ttl">agents</span></div>
      <ScopeTabs scope={state.scope} onPick={(scope) => dispatch({ type: 'scope', scope })} />
      <button type="button" tabIndex={-1} className="newagent" onClick={() => dispatch({ type: 'newagent' })}>New agent</button>
      {keys.map((key) => {
        const agent = state.agents[key]
        const selected = state.agent === key
        return (
          <div key={key}>
            <button type="button" tabIndex={-1} className={selected ? 'agent sel' : 'agent'} onClick={() => dispatch({ type: 'agent', key })}>
              <Avatar who={agent} /><span className="lab">{agent.name}</span>
              <span className="end"><DIcon name={selected ? 'down' : 'right'} /></span>
            </button>
            {selected ? (
              <>
                <button type="button" tabIndex={-1} className={state.thread === 'main' ? 'agent child on' : 'agent child'} onClick={() => dispatch({ type: 'thread', thread: 'main' })}>
                  <DIcon name="chat" /><span className="lab">{agent.name}</span><small>Main</small>
                </button>
                <button type="button" tabIndex={-1} className={state.thread === 'new' ? 'agent child on' : 'agent child dim'} onClick={() => dispatch({ type: 'thread', thread: 'new' })}>
                  <DIcon name="plus" />New thread
                </button>
              </>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

const EXT_FILTERS: Array<[DemoState['extf'], string]> = [
  ['all', 'All'], ['connected', 'Connected'], ['app', 'Apps'], ['skill', 'Skills'], ['mcp', 'MCP servers'],
]

function ExtensionsList({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const count = (f: DemoState['extf']) => state.exts.filter((e) => (f === 'all' ? true : f === 'connected' ? e.on : e.t === f)).length
  return (
    <>
      <div className="head"><span className="ttl">extensions</span></div>
      <div className="scope" style={{ border: 0 }}>
        {EXT_FILTERS.map(([f, label]) => (
          <Row key={f} on={state.extf === f} label={label} onClick={() => dispatch({ type: 'extf', f })} trailing={<span className="count">{count(f)}</span>} />
        ))}
      </div>
    </>
  )
}

/** The second column: the list that belongs to the current page. */
export function DemoList({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const plain = { border: 0 } as const
  let body: ReactNode
  if (state.view === 'agents') body = <AgentsList state={state} dispatch={dispatch} />
  else if (state.view === 'extensions') body = <ExtensionsList state={state} dispatch={dispatch} />
  else if (state.view === 'chats') {
    body = (
      <>
        <div className="head"><span className="ttl">chats</span></div>
        <button type="button" tabIndex={-1} className="newagent" onClick={() => dispatch({ type: 'newchat' })}>New chat</button>
        <div className="scope" style={plain}>
          {state.chats.map((c, i) => <Row key={c.id} on={state.chat === i} icon={<DIcon name="chat" />} label={c.title} onClick={() => dispatch({ type: 'chat', i })} />)}
        </div>
      </>
    )
  } else if (state.view === 'files') {
    body = (
      <>
        <div className="head"><span className="ttl">files</span></div>
        <div className="scope" style={plain}>
          {FILES.map((f, i) => <Row key={f.name} on={state.file === i} icon={<DIcon name={f.kind === 'csv' ? 'table' : 'file'} />} label={f.name} onClick={() => dispatch({ type: 'file', i })} />)}
        </div>
      </>
    )
  } else {
    const visible = state.autos.map((a, i) => ({ a, i })).filter(({ a }) => a.scope === state.ascope)
    body = (
      <>
        <div className="head"><span className="ttl">automations</span></div>
        <ScopeTabs scope={state.ascope} onPick={(scope) => dispatch({ type: 'ascope', scope })} />
        <button type="button" tabIndex={-1} className="newagent" onClick={() => dispatch({ type: 'newauto' })}>New automation</button>
        {visible.map(({ a, i }) => (
          <Row key={a.id} on={state.auto === i} icon={<span className="gi"><DIcon name="flow" /></span>} label={a.n} onClick={() => dispatch({ type: 'auto', i })} />
        ))}
      </>
    )
  }
  return <div className="col2">{body}</div>
}
