import type { CSSProperties } from 'react'
import { LandingLogo } from '../LandingLogo'
import { LandingOrb } from '../LandingOrb'
import { AMBER, Cr, Gi, sv } from './gfx-parts'

/* Sections 4–6 — cloud, multiplayer, open source. Coordinates are on the 640x440 graphic stage. */

const CLOUD = '#7c3aed'

/** The same short thread, shown on every device; `t0..t2` time each message. */
function Thread({ t0, t1, t2 }: { t0: number; t1: number; t2: number }) {
  return (
    <div className="dm">
      <div className="you" data-in={`${t0},${t0 + 0.08}`} data-mode="up">Deploy the staging build</div>
      <div className="agt" data-in={`${t1},${t2}`} data-mode="up">
        <Cr shape="cloud" color={CLOUD} size={14} />
        <span>Deployed. All checks are passing.<b>✓</b></span>
      </div>
    </div>
  )
}

function DevHead({ style }: { style?: CSSProperties }) {
  return (
    <div className="dh" style={style}>
      <Cr shape="hexagon" color={AMBER} size={13} />Claude Code
    </div>
  )
}

/** 9 — cloud: one agent in the cloud, the same thread on every device. */
export function GfxCloud() {
  return (
    <>
      <svg className="lines">
        <path data-line=".08,.3" pathLength="1" d="M320 120 L320 190" />
        <path data-line=".14,.36" pathLength="1" d="M320 120 C 320 170, 92 150, 92 206" />
        <path data-line=".2,.42" pathLength="1" d="M320 120 C 320 170, 548 150, 548 206" />
      </svg>
      <div className="abs pulse" data-in=".56,.7" data-mode="scale" style={{ left: 262, top: 12, width: 116, height: 116, opacity: 0 }} />
      <div className="abs" data-in="0,.1" data-mode="scale" style={{ left: 272, top: 22 }}>
        <Cr shape="cloud" color={CLOUD} size={96} bob />
      </div>
      <div className="dev laptop" data-in=".1,.3" data-mode="up" style={{ left: 176, top: 192, width: 288, height: 188 }}>
        <DevHead /><Thread t0={0.44} t1={0.62} t2={0.74} />
      </div>
      <div className="dbase" data-in=".1,.3" data-mode="up" style={{ left: 150, top: 380, width: 340 }} />
      <div className="dev phone" data-in=".18,.38" data-mode="left" style={{ left: 42, top: 208, width: 104, height: 194 }}>
        <DevHead style={{ paddingTop: 8, height: 30 }} /><Thread t0={0.52} t1={0.64} t2={0.76} />
      </div>
      <div className="dev tablet" data-in=".26,.46" data-mode="right" style={{ left: 494, top: 208, width: 116, height: 164 }}>
        <DevHead /><Thread t0={0.52} t1={0.64} t2={0.76} />
      </div>
      <div className="abs where" data-in=".82,.94" data-mode="none" style={{ left: 320, top: 402 }}>At the office</div>
      <div className="abs where" data-in=".86,.98" data-mode="none" style={{ left: 94, top: 412 }}>On the train</div>
      <div className="abs where" data-in=".9,1" data-mode="none" style={{ left: 552, top: 384 }}>At home</div>
    </>
  )
}

const PEOPLE = [
  { name: 'Priya', color: '#db2777', block: 'DATE', text: 'Launch on Tuesday, October 14', type: '.1,.34', top: 76, move: '.1,.34,52,108,258,108' },
  { name: 'Sam', color: '#2563eb', block: 'OWNERS', text: 'Owner: Sam · Reviewer: Priya', type: '.28,.54', top: 146, move: '.28,.54,52,178,250,178' },
  { name: 'Docs agent', color: CLOUD, block: 'DOCS', text: 'Docs updated with the new plan names', type: '.46,.74', top: 216, move: '.46,.74,52,248,298,248' },
]

/** 10 — multiplayer: people and agents in the same document, live. */
export function GfxMultiplayer() {
  return (
    <div className="abs card docc" data-in="0,.1" data-mode="none" style={{ left: 60, top: 36, width: 520, height: 368 }}>
      <div className="dochd">
        <h4>Launch plan</h4>
        <div className="pres">
          <span className="pa" data-in=".02,.12" data-mode="scale" style={{ background: '#db2777' }}>P</span>
          <span className="pa" data-in=".06,.16" data-mode="scale" style={{ background: '#2563eb' }}>S</span>
          <div data-in=".1,.2" data-mode="scale"><Cr shape="hexagon" color={AMBER} size={28} /></div>
          <div data-in=".14,.24" data-mode="scale"><Cr shape="cloud" color={CLOUD} size={28} /></div>
          <small>4 here</small>
        </div>
      </div>
      {PEOPLE.map((p) => (
        <div key={p.block} className="dblock" style={sv({ top: p.top, '--c': p.color })}>
          <em>{p.block}</em>
          <div className="dline" data-type={p.type} data-text={p.text} />
        </div>
      ))}
      {PEOPLE.map((p, i) => (
        <div key={p.name} className="abs ctag" style={sv({ '--c': p.color })} data-move={p.move}>
          {i === 2 ? <Cr shape="cloud" color="#ffffff" size={14} /> : null}
          {p.name}
        </div>
      ))}
      <div className="abs card cmt" data-in=".8,.92" data-mode="up">
        <Cr shape="hexagon" color={AMBER} size={22} />
        <div><small>Claude Code · just now</small>Updated the pricing table to match.</div>
      </div>
    </div>
  )
}

/** 11 — open source: read it, run it on your own servers, keep your data. */
export function GfxOpenSource() {
  return (
    <>
      <div className="abs tcard" data-in="0,.1" data-mode="none" style={{ left: 60, top: 24, width: 520, height: 146 }}>
        <div className="ln" data-type=".06,.2" data-text="$ docker compose up -d" />
        <div className="ln ok" data-in=".24,.25" data-mode="none">✔ overlay-web      started</div>
        <div className="ln ok" data-in=".28,.29" data-mode="none">✔ overlay-agents   started</div>
        <div className="ln ok" data-in=".32,.33" data-mode="none">✔ database         started</div>
        <div className="ln" data-in=".38,.39" data-mode="none">→ https://agents.acme.co</div>
      </div>
      <div className="abs infra" data-in=".4,.5" data-mode="none" style={{ left: 60, top: 204, width: 520, height: 208 }} />
      <div className="abs infralab" data-in=".4,.52" data-mode="none" style={{ left: 84, top: 190 }}><Gi name="lock" size={13} />Your infrastructure</div>
      <div className="abs ghchip" data-in=".52,.64" data-mode="none" style={{ left: 420, top: 190 }}><LandingLogo name="github" />Source on GitHub</div>
      <svg className="lines">
        <path data-line=".6,.74" pathLength="1" d="M226 300 L254 300" />
        <path data-line=".68,.82" pathLength="1" d="M386 300 L414 300" />
      </svg>
      <div className="abs card nodeC" data-in=".5,.64" data-mode="up" style={{ left: 94, top: 244 }}>
        <div className="big"><LandingOrb /></div>Overlay
      </div>
      <div className="abs card nodeC" data-in=".58,.72" data-mode="up" style={{ left: 254, top: 244 }}>
        <div className="big"><Gi name="database" size={32} /></div>Your database
      </div>
      <div className="abs card nodeC" data-in=".66,.8" data-mode="up" style={{ left: 414, top: 244 }}>
        <div className="big"><Cr shape="hexagon" color={AMBER} size={34} /><Cr shape="blob" color="#db2777" size={34} /></div>Your agents
      </div>
      <div className="abs stay" data-in=".84,.96" data-mode="up" style={{ left: 320, top: 370 }}><i><Gi name="check" size={11} /></i>Your data stays here</div>
    </>
  )
}
