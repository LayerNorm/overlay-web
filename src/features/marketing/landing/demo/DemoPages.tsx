import type { ReactNode } from 'react'
import { LandingLogo } from '../LandingLogo'
import { DIcon } from './demo-icons'
import { FILES } from './demo-data-chats'
import type { DemoAction, DemoState } from './demo-state'
import { MODELS } from './demo-state'

/** The non-chat pages of the demo: Files and Extensions, plus the model picker. */

const PLAN_ROWS = [
  ['Free', '$0', '1', '1'],
  ['Pro', '$20', '10', '1'],
  ['Team', '$40', '50', '5+'],
  ['Enterprise', 'Custom', 'Unlimited', 'Custom'],
]

const PDF_BARS: Array<{ width?: string; mt?: number; title?: boolean }> = [
  { width: '55%', title: true }, {}, {}, { width: '80%' }, { mt: 16 }, { width: '90%' }, {}, { width: '60%' }, { mt: 16 }, { width: '85%' }, {},
]

function FileBody({ kind }: { kind: (typeof FILES)[number]['kind'] }) {
  if (kind === 'md') {
    return (
      <div className="doc">
        <h3>Launch plan</h3>
        <p>Ship agents to everyone in three steps, with a clear owner for each.</p>
        <h4>Goals</h4>
        <ul><li>10,000 agents created in the first month</li><li>Median first-reply time under 10 seconds</li><li>Zero data leaving the customer workspace</li></ul>
        <h4>Timeline</h4>
        <ul><li>Week 1 — private beta with 50 teams</li><li>Week 3 — public launch and docs</li><li>Week 6 — self-serve billing for teams</li></ul>
      </div>
    )
  }
  if (kind === 'md2') {
    return (
      <div className="doc">
        <h3>Q3 board notes</h3>
        <h4>Highlights</h4>
        <ul><li>Revenue up 18% quarter over quarter</li><li>Churn improved to 2.1%</li><li>Two enterprise pilots converted to annual</li></ul>
        <h4>Decisions</h4>
        <p>Approved hiring for six roles across engineering and support. Series A timeline unchanged.</p>
      </div>
    )
  }
  if (kind === 'csv') {
    return (
      <table>
        <tbody>
          <tr><th>PLAN</th><th>PRICE / MO</th><th>AGENTS</th><th>SEATS</th></tr>
          {PLAN_ROWS.map((r) => <tr key={r[0]}>{r.map((c) => <td key={c}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    )
  }
  return (
    <div className="pdf">
      {PDF_BARS.map((b, i) => (
        <b key={i} style={{ width: b.width, marginTop: b.mt, ...(b.title ? { height: 10, background: 'var(--foreground)', opacity: 0.8 } : null) }} />
      ))}
    </div>
  )
}

export function FilesPage({ state }: { state: DemoState }) {
  const file = FILES[state.file]
  return (
    <>
      <div className="head">
        <span className="who"><DIcon name="file" />Documents / {file.name}</span>
        <span className="tools"><span><DIcon name="share" />Share</span></span>
      </div>
      <div className="page"><FileBody kind={file.kind} /></div>
    </>
  )
}

export function ExtensionsPage({ state, dispatch }: { state: DemoState; dispatch: (a: DemoAction) => void }) {
  const visible = state.exts
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (state.extf === 'all' ? true : state.extf === 'connected' ? e.on : e.t === state.extf))
  return (
    <>
      <div className="head"><span className="who">Extensions</span><span className="tools"><span><DIcon name="plus" />Add</span></span></div>
      <div className="page">
        <div className="grid">
          {visible.map(({ e, i }) => (
            <div key={e.n} className="card">
              <div className="top"><span className="tile"><LandingLogo name={e.l} className="lg" /></span>{e.n}</div>
              <p>{e.d}</p>
              <button type="button" tabIndex={-1} className={e.on ? 'btn2 on' : 'btn2'} onClick={() => dispatch({ type: 'ext', i })}>{e.on ? 'Connected' : 'Connect'}</button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/** The "GPT 5.6 Luna ⌄" chip with its dropdown, used in the Chats and Automations headers. */
export function ModelMenu({ state, dispatch }: { state: DemoState; dispatch: (a: DemoAction) => void }): ReactNode {
  return (
    <span className="mwrap">
      <button type="button" tabIndex={-1} className="chip" onClick={() => dispatch({ type: 'menu' })}>{state.model} <DIcon name="down" /></button>
      {state.menu ? (
        <div className="menu">
          {MODELS.map((m) => (
            <button key={m} type="button" tabIndex={-1} className={m === state.model ? 'mi on' : 'mi'} onClick={() => dispatch({ type: 'model', name: m })}>{m}</button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
