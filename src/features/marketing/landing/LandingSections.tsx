import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Braces, ChevronRight, CircleCheck, Database, FileText, Gauge, Globe, History, Laptop,
  Lock, LogIn, Monitor, Plug, ShieldCheck, Smartphone, Terminal, Users, Zap,
} from 'lucide-react'
import { MARKETING_DOCS_URL, MARKETING_SALES_URL } from '@/shared/marketing/marketing'
import { LANDING_AGENTS, LandingAgent, type LandingAgentId } from './LandingAgent'
import { LandingLogo, type LogoName } from './LandingLogo'

const API_DOCS = `${MARKETING_DOCS_URL}/api-reference/overview`

/** Internal routes use `Link`; docs and other sites open in a new tab. */
function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith('/')) return <Link className={className} href={href}>{children}</Link>
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}

const TOOLS: Array<{ name: string; logo?: LogoName }> = [
  { name: 'GitHub', logo: 'github' },
  { name: 'Slack', logo: 'slack' },
  { name: 'Linear', logo: 'linear' },
  { name: 'Gmail', logo: 'gmail' },
  { name: 'Calendar', logo: 'calendar' },
  { name: 'Notion', logo: 'notion' },
  { name: 'Browser' },
]

export function SuperpowersSection() {
  return (
    <section className="sec" id="ai-employees">
      <div className="head center">
        <h2 className="h2">AI agents with superpowers</h2>
        <p className="lead">Every agent gets memory, tools and a computer of its own.</p>
      </div>
      <div className="cards3">
        <article className="card">
          <div className="art">
            <div className="mini">
              <div className="mini-h"><Database className="i sm" />Memory<span className="meta">Engineering</span></div>
              <div className="mini-r"><span className="k">Tests use a fake clock</span><span className="meta">today</span></div>
              <div className="mini-r"><span className="k">Sam reviews billing/ and auth/</span><span className="meta">Tue</span></div>
              <div className="mini-r"><span className="k">Skip wrappers, no external consumers</span><span className="meta">Mon</span></div>
            </div>
          </div>
          <h3 className="h3">Memory that remembers everything</h3>
          <p className="body">Decisions, preferences and context carry over between conversations, so you never explain twice.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="tools">
              {TOOLS.map((tool) => (
                <span className="tool" key={tool.name}>
                  {tool.logo ? <LandingLogo name={tool.logo} className="logo" /> : <Globe className="i sm" />}
                  {tool.name}
                </span>
              ))}
            </div>
          </div>
          <h3 className="h3">Tools that work where you work</h3>
          <p className="body">Create issues, draft email, update the calendar and drive a real browser, with your approval where it matters.</p>
        </article>
        <article className="card">
          <div className="art">
            <div className="mini">
              <div className="mini-h"><Monitor className="i sm" />Its own machine<span className="meta">always on</span></div>
              <div className="mini-r"><Terminal className="i sm" /><span className="k">npm test</span><span className="meta" style={{ color: 'var(--sl-ok)' }}>214 passed</span></div>
              <div className="mini-r"><Globe className="i sm" /><span className="k">Browser session</span><span className="meta">2 tabs</span></div>
              <div className="mini-r"><FileText className="i sm" /><span className="k">launch-plan.md</span><span className="meta">saved</span></div>
            </div>
          </div>
          <h3 className="h3">A computer that can do anything</h3>
          <p className="body">Agents run code, use a browser and keep files on a machine that stays on while your laptop is closed.</p>
        </article>
      </div>
      <p className="tagline">Agents with superpowers are <b>AI employees.</b></p>
    </section>
  )
}

const ROSTER: Array<{ id: LandingAgentId; status: string; color?: string }> = [
  { id: 'engineering', status: 'Working', color: 'var(--sl-ok)' },
  { id: 'support', status: 'Needs approval', color: 'var(--sl-warn)' },
  { id: 'fundraising', status: 'Idle' },
  { id: 'docs', status: 'Idle' },
  { id: 'codex', status: 'Working', color: 'var(--sl-ok)' },
]

const CONNECTED: Array<{ name: string; logo: LogoName; host: string }> = [
  { name: 'Claude Code', logo: 'claude', host: 'maya-mbp' },
  { name: 'Codex', logo: 'openai', host: 'build-server' },
  { name: 'Cursor', logo: 'cursor', host: 'sam-desktop' },
]

function Step({ num, title, body, more, href, id, children }: {
  num: string; title: string; body: string; more: string; href: string; id?: string; children: ReactNode
}) {
  return (
    <div className="step" id={id}>
      <div className="step-art">{children}</div>
      <div>
        <div className="num">{num}</div>
        <h3>{title}</h3>
        <p className="body">{body}</p>
        <SmartLink className="more" href={href}>{more} <ChevronRight className="i sm" /></SmartLink>
      </div>
    </div>
  )
}

export function OnePlaceSection({ appHref }: { appHref: string }) {
  return (
    <section className="sec" id="control-plane">
      <div className="head">
        <h2 className="h2"><span className="dim">One place</span><br />to get things done</h2>
      </div>
      <div className="life">
        <Step num="01" title="Create" more="Create an agent" href={appHref}
          body="Describe the job in plain language. Pick the tools, the model and the knowledge it can use, and your agent is ready in seconds.">
          <div className="mini">
            <div className="mini-h"><LandingAgent id="support" size={20} />New agent</div>
            <div className="field"><div className="l">Name</div><div className="v">Customer support</div></div>
            <div className="field"><div className="l">Instructions</div><div className="v">Triage new support tickets every morning and flag anything urgent.</div></div>
            <div className="field"><div className="l">Tools</div><div className="pill-row"><span>Gmail</span><span>Slack</span><span>Linear</span><span>Files</span></div></div>
            <div className="mini-foot"><span className="btn primary">Create agent</span></div>
          </div>
        </Step>
        <Step num="02" title="Manage" more="See the roster" href={`${MARKETING_DOCS_URL}/help/agents`}
          body="See what every agent is doing, approve what needs a human and read the full run history, all from one roster.">
          <div className="mini">
            <div className="mini-h"><Users className="i sm" />Roster<span className="meta">5 agents</span></div>
            {ROSTER.map(({ id, status, color }) => (
              <div className="mini-r" key={id}>
                <LandingAgent id={id} size={16} />
                <span className="k">{LANDING_AGENTS[id].name}</span>
                <span className="meta"><span className="status" style={color ? ({ '--c': color } as CSSProperties) : undefined}>{status}</span></span>
              </div>
            ))}
          </div>
        </Step>
        <Step num="03" id="deploy" title="Deploy" more="Explore automations" href={`${MARKETING_DOCS_URL}/help/automations`}
          body="Put agents on schedules and triggers, or reach them in Slack, Telegram, iMessage and the web. They report back to the same place.">
          <div className="mini">
            <div className="mini-h"><Zap className="i sm" />Daily Competitor Launch Monitor</div>
            <div className="field"><div className="l">Trigger</div><div className="v">Every weekday · 8:00 AM</div></div>
            <div className="field"><div className="l">Agent</div><div className="v"><LandingAgent id="fundraising" size={16} />Fundraising</div></div>
            <div className="field"><div className="l">Posts to</div><div className="v">#product-intel</div></div>
            <div className="mini-foot"><span className="status" style={{ '--c': 'var(--sl-ok)' } as CSSProperties}>Enabled · next run tomorrow 8:00 AM</span></div>
          </div>
        </Step>
        <Step num="04" title="Bring your own agents" more="Connect an agent" href={`${MARKETING_DOCS_URL}/help/other-agents`}
          body="Connect agents running on machines you control. They join the same roster with shared context, workspace tools and supervision.">
          <div className="mini">
            <div className="mini-h"><Plug className="i sm" />Connected agents</div>
            {CONNECTED.map((agent) => (
              <div className="mini-r" key={agent.name}>
                <LandingLogo name={agent.logo} className="logo" />
                <span className="k">{agent.name}</span><span className="meta">{agent.host}</span>
              </div>
            ))}
            <div className="mini-r"><Braces className="i sm" /><span className="k">Any agent via the API</span><span className="meta">MCP</span></div>
          </div>
        </Step>
      </div>
    </section>
  )
}

export function TeamsSection() {
  return (
    <section className="sec">
      <div className="head">
        <h2 className="h2">Built for how teams<br /><span className="dim">actually work</span></h2>
      </div>
      <div className="grid3">
        <div className="cell" id="cloud">
          <div className="art">
            <div className="plats">
              <span className="tool"><Globe className="i sm" />Web</span>
              <span className="tool"><LandingLogo name="apple" className="logo" />macOS</span>
              <span className="tool"><LandingLogo name="windows" className="logo" />Windows</span>
              <span className="tool"><LandingLogo name="apple" className="logo" />iOS</span>
              <span className="tool"><LandingLogo name="android" className="logo" />Android</span>
              <span className="tool"><LandingLogo name="slack" className="logo" />Slack</span>
            </div>
          </div>
          <h3 className="h3">Accessible from anywhere, literally</h3>
          <p className="body">Web, desktop, mobile and the chat apps you already use. Agents keep working while your laptop is closed.</p>
        </div>
        <div className="cell" id="multiplayer">
          <div className="art">
            <div className="mini" style={{ maxWidth: 250 }}>
              <div className="mini-h">Share Engineering</div>
              <div className="share-row"><span className="avatar">MC</span>Maya Chen<span className="role">Owner</span></div>
              <div className="share-row"><span className="avatar">SR</span>Sam Reyes<span className="role">Can edit</span></div>
              <div className="share-row"><span className="avatar">LP</span>Lena Park<span className="role">Can view</span></div>
            </div>
          </div>
          <h3 className="h3">Better, together</h3>
          <p className="body">Share agents with your whole team and assign them work in any thread. Everyone sees every run and result.</p>
        </div>
        <div className="cell" id="open-source">
          <div className="art">
            <div className="code-card">
              <span className="p">$</span> git clone overlay<br />
              <span className="p">$</span> docker compose up<br />
              <span className="p">#</span> AGPL-3.0 · self-hosted
            </div>
          </div>
          <h3 className="h3">We care about your sovereignty</h3>
          <p className="body">Open source under AGPL-3.0. Read the source before you trust it, or self-host on your own servers.</p>
        </div>
      </div>
    </section>
  )
}

const CONTROLS = [
  { Icon: Lock, text: 'Permissions per agent and per tool' },
  { Icon: CircleCheck, text: 'Approvals before sensitive actions' },
  { Icon: Gauge, text: 'Spend limits for every run' },
  { Icon: History, text: 'Complete run history' },
  { Icon: ShieldCheck, text: 'Audit trails, including your own agents' },
  { Icon: Globe, text: 'Hosted or self-hosted' },
]

export function ControlSection() {
  return (
    <section className="sec tight">
      <div className="split">
        <h2 className="h2">Stay in control<br /><span className="dim">of every agent on the roster</span></h2>
        <div className="ctrl">
          {CONTROLS.map(({ Icon, text }) => <div key={text}><Icon className="i" />{text}</div>)}
        </div>
      </div>
    </section>
  )
}

export function GetOverlaySection({ appHref }: { appHref: string }) {
  const columns: Array<{ title: string; rows: Array<{ name: string; href: string; icon: ReactNode }> }> = [
    { title: 'Web', rows: [
      { name: 'Get started', href: appHref, icon: <Globe className="i" /> },
      { name: 'Sign in', href: '/auth/sign-in', icon: <LogIn className="i" /> },
    ] },
    { title: 'Desktop', rows: [
      { name: 'macOS', href: '/download', icon: <Laptop className="i" /> },
      { name: 'Windows', href: '/download', icon: <Laptop className="i" /> },
    ] },
    { title: 'Mobile', rows: [
      { name: 'iOS', href: '/download', icon: <Smartphone className="i" /> },
      { name: 'Android', href: '/download', icon: <Smartphone className="i" /> },
    ] },
    { title: 'Developer', rows: [
      { name: 'MCP', href: API_DOCS, icon: <Plug className="i" /> },
      { name: 'API', href: API_DOCS, icon: <Braces className="i" /> },
    ] },
  ]
  return (
    <section className="sec" id="get-overlay">
      <div className="cta-card">
        <div>
          <h2 className="h2">Hire your first AI employee</h2>
          <p className="body">The free tier needs no card. Start on the web, then take Overlay everywhere you work.</p>
          <div className="actions">
            <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
            <a className="btn ghost" href={MARKETING_SALES_URL} target="_blank" rel="noopener noreferrer">Book a call</a>
          </div>
        </div>
        <div className="platforms">
          {columns.map((col) => (
            <div className="pcol" key={col.title}>
              <h3>{col.title}</h3>
              {col.rows.map((row) => (
                <SmartLink className="prow" href={row.href} key={row.name}>
                  {row.icon}{row.name}<ArrowRight className="i sm go" />
                </SmartLink>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
