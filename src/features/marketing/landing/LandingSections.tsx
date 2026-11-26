import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight, CircleCheck, Clock, Cloud, FileText, Gauge, Globe, History, Lock, Plus, ShieldCheck, Smartphone, Sunrise,
  Terminal, Users, Zap,
} from 'lucide-react'
import { OverlayMark } from '@/components/brand/OverlayMark'
import { MARKETING_MCP_DOCS_URL, MARKETING_SLACK_INSTALL_PATH } from '@/shared/marketing/marketing'
import { AppleMark } from './AppleMark'
import { GithubMark } from './GithubMark'
import { LandingAgent, LandingPerson, LANDING_PEOPLE, type LandingAgentId, type LandingPersonId } from './LandingAgent'
import { LandingAppPreview } from './LandingAppPreview'
import { LandingLogo, type LogoName } from './LandingLogo'

/** The Slack call to action used in the hero, the Slack section and the closing section. */
export function AddToSlack({ primary = false }: { primary?: boolean }) {
  return (
    <a className={primary ? 'btn primary' : 'btn ghost'} href={MARKETING_SLACK_INSTALL_PATH}>
      <LandingLogo name="slack" className="logo" /> Add @Overlay to Slack
    </a>
  )
}

function Head({ title, dim, lead, wide = true }: { title: ReactNode; dim?: ReactNode; lead?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'head center wide' : 'head center'}>
      <h2 className="h2">{title}{dim ? <><br /><span className="dim">{dim}</span></> : null}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  )
}

const TOOLS: Array<{ name: string; logo?: LogoName }> = [
  { name: 'GitHub', logo: 'github' }, { name: 'Slack', logo: 'slack' }, { name: 'Linear', logo: 'linear' },
  { name: 'Gmail', logo: 'gmail' }, { name: 'Calendar', logo: 'calendar' }, { name: 'Notion', logo: 'notion' },
  { name: 'Sentry', logo: 'sentry' }, { name: 'Browser' },
]

export function SuperpowersSection() {
  return (
    <section className="sec" id="ai-employees">
      <Head wide={false} title="AI agents with superpowers" lead="Every agent gets a face, a memory, your tools and a computer of its own." />
      <div className="cards3">
        <article className="card">
          <div className="art">
            <div className="mini">
              <div className="mini-h"><LandingAgent id="engineering" size={18} />Engineering remembers<span className="meta">Memory</span></div>
              <div className="mini-r"><span className="k">Tests use a fake clock</span><span className="meta">today</span></div>
              <div className="mini-r"><span className="k">Sam reviews billing/ and auth/</span><span className="meta">Tue</span></div>
              <div className="mini-r"><span className="k">Ship behind a flag first</span><span className="meta">Mon</span></div>
            </div>
          </div>
          <h3 className="h3">Memory that carries over</h3>
          <p className="body">Decisions, preferences and context stay with each agent, so you never explain twice.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="tools grid9">
              {TOOLS.map((tool) => (
                <span className="tool" key={tool.name}>{tool.logo ? <LandingLogo name={tool.logo} className="logo" /> : <Globe className="i sm" />}{tool.name}</span>
              ))}
              <span className="tool more"><Plus className="i sm" />Many more</span>
            </div>
          </div>
          <h3 className="h3">The tools your team uses</h3>
          <p className="body">Open issues, draft email, update the calendar and drive a real browser, with your approval where it matters.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="mini">
              <div className="mini-h"><LandingAgent id="engineering" size={18} working />Engineering’s computer<span className="meta" style={{ color: 'var(--sl-ok)' }}>running</span></div>
              <div className="mini-r"><Terminal className="i sm" /><span className="k">npm test</span><span className="meta" style={{ color: 'var(--sl-ok)' }}>214 passed</span></div>
              <div className="mini-r"><Globe className="i sm" /><span className="k">Browser session</span><span className="meta">2 tabs</span></div>
              <div className="mini-r"><FileText className="i sm" /><span className="k">release-notes.md</span><span className="meta">saved</span></div>
            </div>
          </div>
          <h3 className="h3">A computer of its own</h3>
          <p className="body">Agents run code, use a browser and keep files on a machine that stays on while your laptop is closed.</p>
        </article>
      </div>
      <p className="tagline">Agents with superpowers are <b>AI employees.</b></p>
    </section>
  )
}

const TREE: Array<[LandingAgentId, number]> = [['finance', 33], ['operations', 95], ['engineering', 157], ['support', 219]]

export function ChiefSection() {
  return (
    <section className="sec" id="chief">
      <Head title="One chief of staff" dim="running a team of agents" lead="Tell Overlay what you need. It breaks the work down, hands each piece to the right agent and brings the results back to you." />
      <div className="flow">
        <article className="card">
          <div className="art"><div className="mini"><div className="bubble"><span className="who">You</span>Close the books for November and flag anything odd.</div></div></div>
          <h3 className="h3">You ask once</h3>
          <p className="body">In the app, in Slack or from your phone. Overlay knows your company, so you never explain twice.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="tree" aria-label="Overlay at the top, four agents below it">
              <svg className="lines" viewBox="0 0 252 168" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="M126 58 V88 M33 88 H219 M33 88 V118 M95 88 V118 M157 88 V118 M219 88 V118" /></svg>
              <div className="n c" style={{ left: 126, top: 32 }}><LandingAgent id="overlay" size={38} working /></div>
              {TREE.map(([id, x], i) => <div className="n" key={id} style={{ left: x, top: 138 }}><LandingAgent id={id} size={28} working={i === 0} /></div>)}
            </div>
          </div>
          <h3 className="h3">Overlay assigns the team</h3>
          <p className="body">Each agent has its own tools, memory and computer. Overlay picks who does what and keeps them moving.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="mini">
              <div className="mini-h"><LandingAgent id="overlay" size={16} />November close<span className="meta">done</span></div>
              <div className="mini-r"><LandingAgent id="finance" size={16} /><span className="k">Reconciled 214 payouts</span><span className="meta" style={{ color: 'var(--sl-ok)' }}>✓</span></div>
              <div className="mini-r"><LandingAgent id="operations" size={16} /><span className="k">3 vendor bills to approve</span><span className="meta"><span className="status" style={{ '--c': 'var(--sl-warn)' } as CSSProperties}>You</span></span></div>
              <div className="mini-r"><LandingAgent id="support" size={16} /><span className="k">2 refunds explained</span><span className="meta" style={{ color: 'var(--sl-ok)' }}>✓</span></div>
            </div>
          </div>
          <h3 className="h3">Results come back to you</h3>
          <p className="body">One summary, with only the decisions that need a human. Every step is in the run history.</p>
        </article>
      </div>
    </section>
  )
}

function PersonNode({ id }: { id: LandingPersonId }) {
  const person = LANDING_PEOPLE[id]
  return <div className="node"><LandingPerson id={id} size={28} /><span>{person.name}<span className="role">{person.role}</span></span></div>
}
function AgentNode({ id, name, role }: { id: LandingAgentId; name: string; role: string }) {
  return <div className="node"><LandingAgent id={id} size={28} /><span>{name}<span className="role">{role}</span></span></div>
}

export function OrgChartSection() {
  const branches: Array<{ lead: ReactNode; reports: Array<[LandingAgentId, string, string]> }> = [
    { lead: <PersonNode id="sam" />, reports: [['engineering', 'Engineering', 'Ships fixes and releases'], ['docs', 'Docs', 'Keeps guides current']] },
    { lead: <div className="node chief-node"><LandingAgent id="overlay" size={34} /><span>Overlay<span className="role">Chief of Staff</span></span></div>, reports: [['operations', 'Operations', 'Vendors, travel, offsites'], ['finance', 'Finance', 'Books and payouts']] },
    { lead: <PersonNode id="lena" />, reports: [['growth', 'Growth', 'Launches and campaigns'], ['support', 'Support', 'Answers every ticket']] },
  ]
  return (
    <section className="sec" id="org-chart">
      <Head title="Your AI employees" dim="belong on your org chart" lead="Give every agent a role, a manager and a face. Assign them work like anyone else on the team." />
      <div className="org-wrap">
        <div className="org">
          <PersonNode id="maya" />
          <div className="vline" />
          <div className="tier">
            {branches.map((branch, i) => (
              <div className="branch" key={i}>
                <div className="vline" />
                {branch.lead}
                <div className="vline" style={{ height: 20 }} />
                <div className="reports">{branch.reports.map(([id, name, role]) => <AgentNode key={id} id={id} name={name} role={role} />)}</div>
              </div>
            ))}
          </div>
          <div className="org-legend">
            <span><LandingPerson id="lena" size={20} />People</span>
            <span><LandingAgent id="growth" size={20} />AI employees</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function MultiplayerSection() {
  return (
    <section className="sec" id="multiplayer">
      <Head title="Multiplayer by default" dim="people and agents in one channel" lead="Your team and your agents share channels. Anyone can bring Overlay in, and everyone sees the work as it happens." />
      <LandingAppPreview className="chan-app" initial={{ view: 'chats', right: false }} label="Clickable preview of a team channel in Overlay" />
    </section>
  )
}

export function ScopesSection() {
  return (
    <section className="sec" id="scopes">
      <Head title="Personal stays personal" dim="shared work stays shared" lead="Every member gets a private space next to the team’s workspace. You choose what moves between them." />
      <div className="scopes">
        <div className="scope">
          <div className="mini">
            <div className="seg-h"><div className="sb-seg"><span className="on">Personal</span><span>Workspace</span></div><span className="meta"><Lock className="i xs" />Only you</span></div>
            <div className="mini-r"><LandingAgent id="personalOverlay" size={16} /><span className="k">Prep notes for my 1:1 with Sam</span><span className="meta">today</span></div>
            <div className="mini-r"><LandingAgent id="inbox" size={16} /><span className="k">Inbox: reply to the Brightline intro</span><span className="meta">9:40</span></div>
            <div className="mini-r"><FileText className="i sm" /><span className="k">Board meeting draft</span><span className="meta">note</span></div>
          </div>
          <h3 className="h3"><Lock className="i sm" />Personal</h3>
          <p className="body">Your own Overlay, your own agents, notes and threads. Nobody else in the workspace can see them.</p>
        </div>
        <div className="scope">
          <div className="mini">
            <div className="seg-h"><div className="sb-seg"><span>Personal</span><span className="on">Workspace</span></div><span className="meta"><Users className="i xs" />Acme · 14 members</span></div>
            <div className="mini-r"><LandingAgent id="overlay" size={16} /><span className="k">Atlas launch</span><span className="meta">Maya, Sam +2</span></div>
            <div className="mini-r"><LandingAgent id="support" size={16} /><span className="k">Support: weekly ticket review</span><span className="meta">shared</span></div>
            <div className="mini-r"><LandingAgent id="finance" size={16} /><span className="k">Finance: November close</span><span className="meta">shared</span></div>
          </div>
          <h3 className="h3"><Users className="i sm" />Workspace</h3>
          <p className="body">Shared agents, threads and automations the whole team can see, use and steer, with permissions per member.</p>
        </div>
      </div>
    </section>
  )
}

export function SelfDrivingSection() {
  const feed: Array<[string, LandingAgentId, ReactNode, boolean?]> = [
    ['06:00', 'finance', 'Reconciled yesterday’s Stripe payouts'],
    ['07:15', 'support', 'Answered 38 tickets, escalated 2 to Lena'],
    ['08:00', 'growth', 'Posted competitor launches to #product-intel'],
    ['08:42', 'engineering', 'Fixing a flaky checkout test', true],
  ]
  return (
    <section className="sec" id="self-driving">
      <div className="sd">
        <div>
          <h2 className="h2">Make your company<br />self-driving</h2>
          <p className="lead">Put agents on schedules and triggers. The routine work runs on its own, and you only hear about what needs a decision.</p>
          <div className="points">
            <div><Clock className="i" /><span><b>Schedules.</b> Daily reports, weekly reviews, month-end close.</span></div>
            <div><Zap className="i" /><span><b>Triggers.</b> A new ticket, a merged PR, an email from a customer.</span></div>
            <div><CircleCheck className="i" /><span><b>Approvals.</b> Money, messages and anything sensitive wait for you.</span></div>
          </div>
        </div>
        <div className="step-art feed">
          <div className="mini">
            <div className="mini-h"><Sunrise className="i sm" />While you slept<span className="meta">This morning</span></div>
            {feed.map(([time, id, text, working]) => (
              <div className="mini-r" key={time}><span className="tm">{time}</span><LandingAgent id={id} size={18} working={working} /><span className="k">{text}</span>{working ? <span className="meta"><span className="status" style={{ '--c': 'var(--sl-ok)' } as CSSProperties}>Working</span></span> : null}</div>
            ))}
            <div className="mini-r need"><span className="tm">09:05</span><LandingAgent id="operations" size={18} />
              <div className="k">Needs you: <b>approve the €1,200 venue deposit</b> for the Lisbon offsite
                <div className="act"><span className="btn primary">Approve</span><span className="btn ghost">Review</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function CloudSection() {
  return (
    <section className="sec" id="cloud">
      <Head title="In the cloud" dim="accessible from anywhere" lead="Your agents live in the cloud, not on one laptop. Reach them from wherever you are, and they keep working when you log off." />
      <div className="grid3">
        <div className="cell">
          <div className="art">
            <div className="plats">
              <span className="tool"><Globe className="i sm" />Web</span>
              <span className="tool"><AppleMark />Mac</span>
              <span className="tool"><LandingLogo name="slack" className="logo" />Slack</span>
              <span className="tool"><Smartphone className="i sm" />Mobile</span>
              <span className="tool"><LandingLogo name="openai" className="logo" />ChatGPT</span>
              <span className="tool"><LandingLogo name="claude" className="logo" />Claude</span>
              <span className="tool"><LandingLogo name="mcp" className="logo" />Any MCP app</span>
            </div>
          </div>
          <h3 className="h3">Every surface, one team</h3>
          <p className="body">The web, your Mac, your phone, Slack and the AI apps you already use. <a href={MARKETING_MCP_DOCS_URL} target="_blank" rel="noopener noreferrer">Same agents, same memory.</a></p>
        </div>
        <div className="cell">
          <div className="art">
            <div className="mini" style={{ maxWidth: 260 }}>
              <div className="mini-h"><Cloud className="i sm" />Overnight<span className="meta">laptop closed</span></div>
              <div className="mini-r"><LandingAgent id="engineering" size={16} working /><span className="k">Running the test suite</span><span className="meta" style={{ color: 'var(--sl-ok)' }}>3h 12m</span></div>
              <div className="mini-r"><LandingAgent id="support" size={16} /><span className="k">38 tickets answered</span><span className="meta">✓</span></div>
              <div className="mini-r"><LandingAgent id="finance" size={16} /><span className="k">Payouts reconciled</span><span className="meta">✓</span></div>
            </div>
          </div>
          <h3 className="h3">Always on</h3>
          <p className="body">Each agent’s computer runs in the cloud, so long jobs finish while you sleep and results wait in the thread.</p>
        </div>
        <div className="cell" id="open-source">
          <div className="art">
            <div className="code-card"><span className="p">$</span> git clone overlay<br /><span className="p">$</span> docker compose up<br /><span className="p">#</span> AGPL-3.0 · self-hosted</div>
          </div>
          <h3 className="h3">Hosted, or on your servers</h3>
          <p className="body">Use our cloud, or self-host the open-source release on infrastructure you control.</p>
        </div>
      </div>
    </section>
  )
}

export function SlackSection() {
  return (
    <section className="sec" id="slack">
      <div className="sd">
        <div className="step-art slack-art">
          <div className="slack" aria-label="Overlay answering in a Slack thread">
            <div className="slack-h"><LandingLogo name="slack" className="logo" /># atlas-launch<span className="meta">8 members</span></div>
            <div className="smsg"><span className="sq photo"><LandingPerson id="sam" size={32} /></span><div><div className="nm">Sam Reyes<span className="t">10:12 AM</span></div><span className="mention">@Overlay</span> can we still ship Thursday? Checkout tests are red.</div></div>
            <div className="smsg"><span className="sq ov"><OverlayMark size={20} /></span>
              <div style={{ minWidth: 0, flex: 1 }}><div className="nm">Overlay<span className="tag">APP</span><span className="t">10:12 AM</span></div>
                Yes. One flaky test, not a real bug. I asked the team:
                <div className="asks">
                  <div className="ask"><LandingAgent id="engineering" size={16} working /><span className="tx"><b>Engineering</b> is fixing the test</span><span className="r">Working</span></div>
                  <div className="ask"><LandingAgent id="docs" size={16} /><span className="tx"><b>Docs</b> added it to the changelog</span><span className="r ok">Done</span></div>
                </div>
              </div>
            </div>
            <div className="thread-foot"><LandingAgent id="engineering" size={16} /><LandingAgent id="docs" size={16} />&nbsp; 3 replies</div>
          </div>
        </div>
        <div>
          <h2 className="h2">Overlay in Slack<br /><span className="dim">your team’s newest coworker</span></h2>
          <p className="lead">Mention @Overlay in any channel or DM it. It answers in the thread, brings in the right agents and posts the results where your team already talks.</p>
          <div className="actions"><AddToSlack primary /></div>
          <p className="meta-line">Works in channels, threads and DMs · Each person’s Slack links to their Overlay account</p>
        </div>
      </div>
    </section>
  )
}

const CONTROLS = [
  { Icon: Lock, text: 'Permissions per agent and per tool' },
  { Icon: CircleCheck, text: 'Approvals before sensitive actions' },
  { Icon: Gauge, text: 'Spend limits for the workspace' },
  { Icon: History, text: 'Complete run history' },
  { Icon: ShieldCheck, text: 'Audit trails for every action' },
]

export function ControlSection() {
  return (
    <section className="sec tight">
      <div className="split">
        <h2 className="h2">Stay in control<br /><span className="dim">of every agent on the team</span></h2>
        <div className="ctrl">
          {CONTROLS.map(({ Icon, text }) => <div key={text}><Icon className="i" />{text}</div>)}
          <div><GithubMark />Open source, or self-hosted</div>
        </div>
      </div>
    </section>
  )
}

export function FinalCtaSection({ appHref }: { appHref: string }) {
  return (
    <section className="sec" id="get-overlay">
      <div className="final">
        <div className="team">
          <LandingAgent id="growth" size={32} /><LandingAgent id="engineering" size={32} /><LandingAgent id="overlay" size={44} /><LandingAgent id="support" size={32} /><LandingAgent id="finance" size={32} />
        </div>
        <h2 className="h2">Hire your AI Chief of Staff</h2>
        <p className="lead">Set up your workspace in minutes, then let Overlay build the rest of the team.</p>
        <div className="actions">
          <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
          <AddToSlack />
        </div>
      </div>
    </section>
  )
}
