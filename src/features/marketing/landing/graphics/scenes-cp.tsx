import type { ReactNode } from 'react'
import type { CreatureShape } from '@/components/orb/Creature'
import { LandingLogo } from '../LandingLogo'
import { LandingLockup } from '../LandingOrb'
import { AMBER, Cr, Gi } from './gfx-parts'

/* Section 3 — control plane. Coordinates are on the 640x440 graphic stage. */

/** 5 — create: describe it, and it assembles itself. */
export function GfxCreate() {
  return (
    <>
      <div className="abs card cpanel" data-in="0,.12" data-mode="none" style={{ left: 28, top: 36, width: 340, height: 368 }}>
        <div className="panelhd" style={{ padding: '18px 20px 0' }}>New agent</div>
        <div className="lab2">What should it do?</div>
        <div className="prompt">
          <span data-type=".05,.4" data-text="Triage new support tickets every morning and flag anything urgent." />
          <i />
        </div>
        <div className="lab2">Setup</div>
        <div className="chips2">
          <span className="chip2" data-in=".42,.52" data-mode="scale"><LandingLogo name="slack" />Slack</span>
          <span className="chip2" data-in=".5,.6" data-mode="scale"><LandingLogo name="linear" />Linear</span>
          <span className="chip2" data-in=".58,.68" data-mode="scale"><Gi name="memory" size={14} />Memory</span>
          <span className="chip2" data-in=".66,.76" data-mode="scale"><Gi name="clock" size={14} />Weekdays · 8:00 AM</span>
        </div>
        <div className="cbtn" data-on=".84">Create agent</div>
      </div>
      <div className="abs card pv" data-in=".2,.4" data-mode="right" style={{ left: 400, top: 96, width: 212, height: 236 }}>
        <div data-in=".44,.6" data-mode="scale" style={{ display: 'grid', placeItems: 'center' }}>
          <Cr shape="blob" color="#db2777" size={84} bob />
        </div>
        <div className="nm2" data-type=".46,.62" data-text="Support triage" />
        <div className="role2" data-in=".62,.72" data-mode="none">Reads tickets, flags urgent ones</div>
        <div className="state" data-on=".88"><i /><span className="a">Draft</span><span className="b">Live</span></div>
      </div>
    </>
  )
}

type ManageRow = [CreatureShape, string, string, string, string, string, number, number]
const MANAGE_ROWS: ManageRow[] = [
  ['hexagon', '#f59e0b', 'Claude Code', 'Engineering', 'run', 'Running', 12, 50],
  ['pill', '#2563eb', 'PR agent', 'Code review', 'run', 'Running', 8, 20],
  ['squircle', '#ea580c', 'Support agent', 'Customer support', 'run', 'Running', 21, 40],
  ['triangle', '#16a34a', 'Fundraising', 'Investor outreach', 'hold', 'Paused', 4, 30],
  ['cloud', '#7c3aed', 'Docs agent', 'Documentation', '', 'Idle', 2, 25],
]

/** 6 — manage: every agent with its status, budget and permissions. */
export function GfxManage() {
  return (
    <>
      <div className="abs card" data-in="0,.1" data-mode="none" style={{ left: 28, top: 40, width: 372, height: 360, overflow: 'hidden' }}>
        <div className="mhead"><span>AGENT</span><span>STATUS</span><span>BUDGET TODAY</span></div>
        {MANAGE_ROWS.map(([shape, color, name, role, state, label, spent, cap], i) => (
          <div key={name} className="mrow" data-on={i === 0 ? '.5' : undefined} data-in={`${0.04 + i * 0.07},${0.16 + i * 0.07}`} data-mode="up" style={{ top: 44 + i * 62 }}>
            <Cr shape={shape} color={color} size={30} />
            <div className="who">{name}<small>{role}</small></div>
            <div className={`st ${state}`.trim()}><i />{label}</div>
            <div className="bud">
              ${spent} / ${cap}
              <div className="bar2"><i data-bar={`.2,.5,${Math.round((spent / cap) * 100)}`} /></div>
            </div>
          </div>
        ))}
      </div>
      <div className="abs card perm" data-in=".5,.64" data-mode="right" style={{ left: 424, top: 40, width: 188, height: 360 }}>
        <div className="ph">
          <Cr shape="hexagon" color={AMBER} size={26} />
          <div>Claude Code<small>Permissions</small></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="prow"><div>Read repositories</div><span className="sw" style={{ marginLeft: 'auto' }} data-on=".62" /></div>
          <div className="prow"><div>Open pull requests</div><span className="sw" style={{ marginLeft: 'auto' }} data-on=".7" /></div>
          <div className="prow" data-in=".76,.86" data-mode="none"><div>Merge to main</div><span className="pill2">Ask first</span></div>
          <div className="prow" data-in=".84,.94" data-mode="none"><div>Daily spend cap</div><span className="val2">$50</span></div>
        </div>
      </div>
    </>
  )
}

type Lane = { icon: ReactNode; title: string; sub: string; top: number; cy: number; live: string }
const LANES: Lane[] = [
  { icon: <Gi name="clock" size={22} />, title: 'Every weekday', sub: '8:00 AM, your timezone', top: 36, cy: 82, live: '.34' },
  { icon: <Gi name="zap" size={22} />, title: 'On every push', sub: 'GitHub · main branch', top: 174, cy: 220, live: '.52' },
  { icon: <LandingLogo name="slack" />, title: '#support in Slack', sub: 'Replies to new tickets', top: 312, cy: 358, live: '.7' },
]

/** 7 — deploy: schedules, triggers and channels. */
export function GfxDeploy() {
  return (
    <>
      <svg className="lines">
        {LANES.map((l, i) => (
          <path key={l.title} data-line={`${0.08 + i * 0.18},${0.3 + i * 0.18}`} pathLength="1" d={`M168 220 C 240 220, 232 ${l.cy}, 292 ${l.cy}`} />
        ))}
      </svg>
      <div className="abs" style={{ left: 48, top: 152 }}><Cr shape="hexagon" color={AMBER} size={120} bob /></div>
      <div className="abs tag2" data-in=".86,.98" data-mode="none" style={{ left: 24, top: 290, width: 168 }}>
        <span className="state on" style={{ margin: 0 }}><i />3 deployments live</span>
      </div>
      {LANES.map((l, i) => (
        <div key={l.title} className="abs card lane" data-in={`${0.08 + i * 0.18},${0.3 + i * 0.18}`} data-mode="right" style={{ left: 292, top: l.top, width: 320 }}>
          <span className="lt2">{l.icon}</span>
          <div><b>{l.title}</b><small>{l.sub}</small></div>
          <span className="state" data-on={l.live}><i /><span className="a">Deploying</span><span className="b">Live</span></span>
        </div>
      ))}
    </>
  )
}

type Outside = { logo: ReactNode; name: string; maker: string; shape: CreatureShape; color: string; via: string }
const OUTSIDE: Outside[] = [
  { logo: <LandingLogo name="claude" />, name: 'Claude Code', maker: 'Anthropic', shape: 'hexagon', color: '#f59e0b', via: 'MCP' },
  { logo: <LandingLogo name="openai" />, name: 'Codex', maker: 'OpenAI', shape: 'hexagon', color: '#14b8a6', via: 'MCP' },
  { logo: <LandingLogo name="cursor" />, name: 'Cursor', maker: 'Cursor', shape: 'pill', color: '#2563eb', via: 'MCP' },
  { logo: <Gi name="code" size={18} />, name: 'Your own agent', maker: 'Any agent via the API', shape: 'blob', color: '#db2777', via: 'API' },
]

/** 8 — bring your own agents: other agents plug into the same control plane. */
export function GfxByoa() {
  return (
    <>
      <svg className="lines">
        {OUTSIDE.map((o, i) => (
          <path key={o.name} data-line={`${0.1 + i * 0.16},${0.3 + i * 0.16}`} pathLength="1" d={`M228 ${75 + i * 84} L392 ${75 + i * 84}`} />
        ))}
      </svg>
      {OUTSIDE.map((o, i) => (
        <div key={o.name}>
          <div className={i === 3 ? 'abs card ext dash' : 'abs card ext'} data-in={`${i * 0.1},${0.14 + i * 0.1}`} data-mode="left" style={{ left: 28, top: 44 + i * 84 }}>
            <span className="lt2">{o.logo}</span>
            <div><b>{o.name}</b><small>{o.maker}</small></div>
          </div>
          <span className="abs proto" data-in={`${0.22 + i * 0.16},${0.3 + i * 0.16}`} data-mode="none" style={{ left: 310, top: 75 + i * 84 }}>{o.via}</span>
        </div>
      ))}
      <div className="abs card cplane" data-in="0,.12" data-mode="none" style={{ left: 392, top: 28, width: 220, height: 384 }}>
        <div className="hd"><LandingLockup /><em>CONTROL PLANE</em></div>
        {OUTSIDE.map((o, i) => (
          <div key={o.name} className="crow" data-in={`${0.3 + i * 0.16},${0.42 + i * 0.16}`} data-mode="up" style={{ top: 52 + i * 76 }}>
            <Cr shape={o.shape} color={o.color} size={30} />
            <div>{o.name}<small><Gi name="check" size={11} /> Connected</small></div>
          </div>
        ))}
      </div>
    </>
  )
}
