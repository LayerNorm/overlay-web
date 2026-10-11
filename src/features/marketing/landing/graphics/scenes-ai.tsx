import { LandingLogo } from '../LandingLogo'
import { LandingLockup, LandingOrb } from '../LandingOrb'
import { AMBER, Cr, Gi, sv } from './gfx-parts'

/* Section 2 — AI employees. Coordinates are on the 640x440 graphic stage. */

/** 0 — superpowers: an agent, and the three things that make it an employee. */
export function GfxSuperpowers() {
  return (
    <>
      <svg className="lines">
        <path data-line=".34,.62" pathLength="1" d="M320 190 C 250 190, 170 205, 112 240" />
        <path data-line=".5,.76" pathLength="1" d="M320 190 L320 322" />
        <path data-line=".62,.9" pathLength="1" d="M320 190 C 390 190, 470 205, 528 240" />
      </svg>
      <div className="abs halo" data-in=".72,.95" data-mode="scale" style={{ left: 190, top: 50, width: 260, height: 260 }} />
      <div className="abs" style={{ left: 245, top: 115 }}>
        <Cr shape="hexagon" color={AMBER} size={150} bob />
      </div>
      <div className="abs tok" data-in=".1,.4" data-mode="left" style={sv({ left: 67, top: 200, '--c': 'var(--c-cp)' })}>
        <div className="card tile"><Gi name="memory" size={30} /></div>
        <div className="lbl">Memory</div>
      </div>
      <div className="abs tok" data-in=".28,.58" data-mode="up" style={sv({ left: 275, top: 316, '--c': 'var(--c-cloud)' })}>
        <div className="card tile"><Gi name="tools" size={30} /></div>
        <div className="lbl">Tools</div>
      </div>
      <div className="abs tok" data-in=".46,.76" data-mode="right" style={sv({ left: 483, top: 200, '--c': 'var(--c-oss)' })}>
        <div className="card tile"><Gi name="computer" size={30} /></div>
        <div className="lbl">Computer</div>
      </div>
    </>
  )
}

const NOTES = [
  ['Prefers pull requests under 200 lines', 'Mar 12'],
  ['Sam owns billing and reviews its PRs', 'Apr 3'],
  ['Launch date moved to October 14', 'Jun 21'],
  ['Never deploy on Fridays', 'Aug 2'],
]

/** 1 — memory: notes accumulate, then one is recalled to answer a question. */
export function GfxMemory() {
  return (
    <>
      <div className="abs panelhd" style={{ left: 30, top: 26, width: 268 }}>
        Memory<small data-count>0 notes</small>
      </div>
      {NOTES.map(([text, date], i) => (
        <div
          key={text}
          className="abs card note"
          data-on={i === 1 ? '.6' : undefined}
          data-in={`${0.04 + i * 0.1},${0.2 + i * 0.1}`}
          data-mode="left"
          style={{ left: 30, top: 68 + i * 76 }}
        >
          <span className="ni"><Gi name="memory" size={16} /></span>
          <b>{text}</b>
          <small>{date}</small>
        </div>
      ))}
      <svg className="lines">
        <path data-line=".62,.74" pathLength="1" style={{ stroke: AMBER, strokeWidth: 1.6 }} d="M298 168 C 326 168, 322 236, 352 236" />
      </svg>
      <div className="abs bubble" data-in=".46,.58" data-mode="up" style={{ left: 352, top: 92, width: 258 }}>
        Who should review the billing PRs?
      </div>
      <div className="abs" data-in=".62,.72" data-mode="up" style={{ left: 352, top: 178, display: 'flex', alignItems: 'center', gap: 9 }}>
        <Cr shape="hexagon" color={AMBER} size={24} />
        <b style={{ fontSize: 12.5 }}>Claude Code</b>
      </div>
      <div className="abs toolrow" data-in=".66,.76" data-mode="up" style={{ left: 352, top: 228 }}>
        <LandingOrb />Searched memory · 1 note
      </div>
      <div className="abs answer" data-in=".74,.9" data-mode="up" style={{ left: 352, top: 258, width: 258 }}>
        Sam owns billing and reviews its PRs. I tagged him on #482.
      </div>
    </>
  )
}

const TOOL_NODES = [
  ['github', 320, 60, 'Opened PR #482'],
  ['slack', 528, 140, 'Posted update to #eng'],
  ['linear', 528, 290, 'Created SEARCH-341'],
  ['notion', 320, 372, 'Updated the launch plan'],
  ['gmail', 112, 290, 'Drafted 3 replies'],
  ['calendar', 112, 140, 'Booked design review'],
] as const

/** 2 — tools: one agent, the apps you already use. */
export function GfxTools() {
  return (
    <>
      <svg className="lines">
        {TOOL_NODES.map((n, i) => (
          <path key={n[0]} data-line={`${0.06 + i * 0.12},${0.2 + i * 0.12}`} pathLength="1" d={`M320 216 L${n[1]} ${n[2]}`} />
        ))}
      </svg>
      <div className="abs" style={{ left: 272, top: 168 }}>
        <Cr shape="hexagon" color={AMBER} size={96} bob />
      </div>
      {TOOL_NODES.map((n, i) => (
        <div key={n[0]}>
          <div className="abs card node" data-in={`${0.06 + i * 0.12},${0.2 + i * 0.12}`} data-mode="scale" style={{ left: n[1], top: n[2] }}>
            <LandingLogo name={n[0]} />
          </div>
          <div className="abs chip" data-in={`${0.16 + i * 0.12},${0.28 + i * 0.12}`} data-mode="up" style={{ left: n[1], top: n[2] + 38 }}>
            <i />{n[3]}
          </div>
        </div>
      ))}
    </>
  )
}

/** 3 — computer: its own machine; terminal, browser, files. */
export function GfxComputer() {
  return (
    <div className="abs card win" style={{ left: 60, top: 36, width: 520, height: 368 }}>
      <div className="bar">
        <i /><i /><i />
        <div className="tabs">
          <span className="tab" data-active="0,.34">Terminal</span>
          <span className="tab" data-active=".34,.7">Browser</span>
          <span className="tab" data-active=".7,1.01">Files</span>
        </div>
      </div>
      <div className="layer term" data-active="0,.34">
        <div className="ln" data-type=".02,.1" data-text="$ git pull origin main" />
        <div className="ln dim" data-in=".11,.12" data-mode="none">Already up to date.</div>
        <div className="ln" data-type=".14,.2" data-text="$ npm test" />
        <div className="ln dim" data-in=".22,.23" data-mode="none">PASS  src/checkout.test.ts</div>
        <div className="ln dim" data-in=".25,.26" data-mode="none">PASS  src/billing.test.ts</div>
        <div className="ln ok" data-in=".29,.3" data-mode="none">✓ 214 tests passed</div>
        <div className="ln" data-in=".31,.32" data-mode="none">$ <i className="caretb" /></div>
      </div>
      <div className="layer" data-active=".34,.7">
        <div className="urlbar"><Gi name="lock" size={12} />app.acme.co/checkout</div>
        <div className="abs card form">
          <h4>Checkout</h4>
          <label>Email</label>
          <div className="field" data-type=".38,.46" data-text="ada@acme.co" />
          <label>Card</label>
          <div className="field" data-type=".46,.52" data-text="4242 4242 4242 4242" />
          <div className="pay" data-on=".62">Pay $240</div>
        </div>
        <div className="abs card toast" data-in=".64,.69" data-mode="up"><i><Gi name="check" size={11} /></i>Order confirmed</div>
        <svg className="abs cursor" width="22" height="22" viewBox="0 0 24 24" data-move=".5,.6,40,250,236,258" aria-hidden="true">
          <path d="M4 3l16 7.5-6.8 2.2L10.5 20 4 3z" fill="#fff" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="layer" data-active=".7,1.01" style={{ paddingTop: 6 }}>
        <div className="frow new" data-in=".76,.86" data-mode="up"><Gi name="file" size={15} /><span>Revenue report.md</span><span className="badge">New · by Claude Code</span></div>
        <div className="frow"><Gi name="file" size={15} /><span>Board follow-ups.md</span><small>Yesterday</small></div>
        <div className="frow"><Gi name="file" size={15} /><span>Launch plan.md</span><small>Mon</small></div>
        <div className="frow"><Gi name="file" size={15} /><span>Pricing research.csv</span><small>Oct 2</small></div>
        <div className="frow"><Gi name="file" size={15} /><span>Brand guidelines.pdf</span><small>Sep 28</small></div>
      </div>
    </div>
  )
}

const CAPABILITIES = [
  ['memory', 'Memory', '4,812 notes', 'var(--c-cp)', '.22'],
  ['tools', 'Tools', '6 apps connected', 'var(--c-cloud)', '.46'],
  ['computer', 'Computer', 'Its own machine, always on', 'var(--c-oss)', '.7'],
] as const

/** 4 — all three together make an employee. */
export function GfxEmployee() {
  return (
    <div className="abs card badgecard" data-in=".02,.2" data-mode="up">
      <div className="top"><LandingLockup /><em>AI EMPLOYEE</em></div>
      <div style={{ display: 'grid', placeItems: 'center', margin: '18px 0 12px' }}>
        <Cr shape="hexagon" color={AMBER} size={104} bob />
      </div>
      <div className="nm">Claude Code</div>
      <div className="role">Software engineer</div>
      <div style={{ marginTop: 18 }}>
        {CAPABILITIES.map(([icon, name, detail, color, on]) => (
          <div key={name} className="cap" style={sv({ '--c': color })}>
            <span className="ct"><Gi name={icon} size={16} /></span>
            <div>{name}<small>{detail}</small></div>
            <span className="sw" data-on={on} />
          </div>
        ))}
      </div>
      <div className="live" data-in=".86,.98" data-mode="none" style={{ marginTop: 14 }}><i />On the team</div>
    </div>
  )
}
