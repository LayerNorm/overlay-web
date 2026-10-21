import { ArrowUp, Check, ChevronDown, ChevronRight, FileText, GitPullRequest, ListChecks, MessageSquare, Monitor, Plus, Workflow } from 'lucide-react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { LANDING_AGENTS, LandingAgent, type LandingAgentId } from './LandingAgent'

const NAV = [
  { label: 'Work', Icon: ListChecks },
  { label: 'Chats', Icon: MessageSquare },
  { label: 'Files', Icon: FileText },
  { label: 'Automations', Icon: Workflow },
]

const SIDEBAR_AGENTS: LandingAgentId[] = ['engineering', 'support', 'fundraising', 'docs', 'codex']

/** A still of the app: sidebar, a team chat with the Engineering agent and its computer. */
export function LandingProductShot() {
  return (
    <div className="shot" role="img" aria-label="Overlay app preview">
      <aside className="sb">
        <BrandLockup />
        {NAV.map(({ label, Icon }) => (
          <div className="sb-item" key={label}><Icon className="i sm" />{label}</div>
        ))}
        <div className="sb-label">Agents</div>
        {SIDEBAR_AGENTS.map((id) => (
          <div className={id === 'engineering' ? 'sb-item on' : 'sb-item'} key={id}>
            <LandingAgent id={id} size={18} />
            {LANDING_AGENTS[id].name}
            {id === 'engineering' && <span className="live" />}
            {id === 'codex' && <span className="meta">BYOA</span>}
          </div>
        ))}
        <div className="sb-user"><span className="avatar">MC</span>Maya Chen</div>
      </aside>

      <div className="chat">
        <div className="chat-head">
          <LandingAgent id="engineering" size={20} />
          Engineering <span className="sub">· Checkout tests</span>
          <div className="people"><span className="avatar">MC</span><span className="avatar">SR</span></div>
        </div>
        <div className="msgs">
          <div className="m-user"><span className="who">Maya</span>Checkout tests have been failing on main since last night. Can you find out why?</div>
          <div className="m-agent">
            <LandingAgent id="engineering" size={20} />
            <div>
              <div className="steps"><Check className="i sm" />Ran 4 steps · GitHub, terminal<ChevronRight className="i sm" /></div>
              <div>I bisected the last 9 commits. The first failure is <code>a41c9f2</code>: a date fixture in <code>checkout.test.ts</code> now falls on the wrong side of the DST change.</div>
              <ol><li><code>computeTaxWindow()</code> uses local time</li><li>The fixture assumes UTC</li></ol>
            </div>
          </div>
          <div className="m-user"><span className="who">Sam</span>Fix the fixture, but use a fake clock instead of hard-coded dates.</div>
          <div className="m-agent">
            <LandingAgent id="engineering" size={20} />
            <div>Done. I added a fake clock in <code>test/utils/clock.ts</code>, updated 3 suites and ran everything: all 214 tests pass. PR #482 is open.</div>
          </div>
        </div>
        <div className="composer">
          <div className="ph">Ask Engineering anything…</div>
          <div className="row">
            <Plus className="i sm" />
            <span className="model">Claude Opus <ChevronDown className="i sm" /></span>
            <span className="send"><ArrowUp className="i sm" /></span>
          </div>
        </div>
      </div>

      <aside className="side">
        <div className="side-head"><Monitor className="i sm" />Computer<span className="tag">Running</span></div>
        <div className="term">
          <span className="p">~/checkout $</span> git bisect run npm test<br />
          <span className="y">a41c9f2</span> is the first bad commit<br />
          <span className="p">~/checkout $</span> npm test<br />
          &nbsp;✓ cart.test.ts <span className="p">(41)</span><br />
          &nbsp;✓ checkout.test.ts <span className="p">(58)</span><br />
          &nbsp;✓ tax-window.test.ts <span className="p">(23)</span><br />
          &nbsp;✓ invoices.test.ts <span className="p">(92)</span><br />
          <span className="g">Tests&nbsp; 214 passed</span><br />
          <span className="p">~/checkout $</span> gh pr create<br />
          <span className="p">→</span> #482 opened
        </div>
        <div className="pr">
          <GitPullRequest className="i" />
          <div><div className="t">#482 Fake clock for checkout tests</div><div className="s">CI green · review requested from Sam</div></div>
        </div>
      </aside>
    </div>
  )
}
