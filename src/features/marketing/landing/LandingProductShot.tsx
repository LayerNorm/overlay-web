import { ArrowUp, Bot, ChevronDown, ChevronRight, Ellipsis, Lock, ListChecks, MessageSquare, PanelLeft, Plus, RotateCw, Search, Workflow } from 'lucide-react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { OverlayMark } from '@/components/orb/Orb'
import { LandingAgent, type LandingAgentId } from './LandingAgent'

const NAV = [
  { label: 'Work', Icon: ListChecks, on: true },
  { label: 'Agents', Icon: Bot },
  { label: 'Chats', Icon: MessageSquare },
  { label: 'Automations', Icon: Workflow },
]

const SIDEBAR_GROUPS: Array<{ label: string; items: Array<{ title: string; agent?: LandingAgentId }> }> = [
  { label: 'Needs you', items: [{ title: 'Approve venue deposit', agent: 'operations' }] },
  { label: 'Assigned to me', items: [{ title: 'Review offsite budget' }] },
  {
    label: 'Everything',
    items: [
      { title: 'Plan the Lisbon offsite', agent: 'operations' },
      { title: 'Reply to renewal emails', agent: 'support' },
      { title: 'Draft investor update', agent: 'fundraising' },
    ],
  },
]

/** The cursor on the agent's streamed screen. */
function Pointer() {
  return (
    <svg className="pointer" viewBox="0 0 16 20" aria-hidden="true">
      <path d="M1 1v15.5l4.2-3.9 2.7 6.2 2.6-1.1-2.7-6.1H14L1 1Z" />
    </svg>
  )
}

/**
 * A still of the app, laid out like the real workspace: the sidebar, a team
 * chat with the Operations agent, and its computer streaming a browser.
 */
export function LandingProductShot() {
  return (
    <div className="shot" role="img" aria-label="Overlay app preview: an agent books a team offsite venue in its browser">
      <aside className="sb">
        <div className="sb-top">
          <BrandLockup />
          <Search className="i sm" />
          <PanelLeft className="i sm" />
        </div>
        <div className="sb-seg"><span>Personal</span><span className="on">Workspace</span></div>
        {NAV.map(({ label, Icon, on }) => (
          <div className={on ? 'sb-item on' : 'sb-item'} key={label}><Icon className="i sm" />{label}</div>
        ))}
        <div className="sb-item"><Ellipsis className="i sm" />More<ChevronRight className="i sm end" /></div>
        {SIDEBAR_GROUPS.map((group) => (
          <div className="sb-group" key={group.label}>
            <div className="sb-label">{group.label}<ChevronDown className="i xs" /></div>
            {group.items.map((item) => (
              <div className="sb-task" key={item.title}>
                {item.agent ? <LandingAgent id={item.agent} size={16} /> : <span className="ring" />}
                {item.title}
              </div>
            ))}
          </div>
        ))}
        <div className="sb-user">
          <span className="ws">AC</span>
          <div><div>Acme</div><div className="sub">Maya Chen</div></div>
          <ChevronDown className="i sm end" />
        </div>
      </aside>

      <div className="chat">
        <div className="chat-head">
          <LandingAgent id="operations" size={20} />
          Operations <span className="sub">Team offsite</span>
          <div className="people"><span className="avatar">MC</span><span className="avatar">SR</span></div>
        </div>
        <div className="msgs">
          <div className="m-user"><span className="who">Maya</span>Find a venue in Lisbon for our team offsite, May 14–16, 12 people, under €4,000.</div>
          <div className="m-agent">
            <LandingAgent id="operations" size={20} />
            <div>
              <div className="steps"><OverlayMark size={7} label="" />Worked for 2m 14s, called 9 tools<ChevronRight className="i sm" /></div>
              <div>Three venues fit the dates and budget. I added them to the planning doc:</div>
              <ol>
                <li><b>Casa do Rio</b>, €3,450, river view</li>
                <li><b>Quinta Verde</b>, €3,800, garden</li>
                <li><b>LX Loft</b>, €2,900, near dinner spots</li>
              </ol>
            </div>
          </div>
          <div className="m-user"><span className="who">Sam</span>Casa do Rio looks great. Ask if they can do a vegetarian lunch.</div>
          <div className="m-agent">
            <LandingAgent id="operations" size={20} />
            <div>On it. I’m filling in their events form now.</div>
          </div>
        </div>
        <div className="composer">
          <div className="ph">Ask Operations anything…</div>
          <div className="row">
            <Plus className="i sm" />
            <span className="model">Claude Opus <ChevronDown className="i sm" /></span>
            <span className="send"><ArrowUp className="i sm" /></span>
          </div>
        </div>
      </div>

      <aside className="side">
        <div className="side-head">Computer<span className="tag">Live</span></div>
        <div className="desk">
          <div className="win">
            <div className="win-bar">
              <span className="lights"><i /><i /><i /></span>
              <span className="tab">Casa do Rio · Events</span>
            </div>
            <div className="url"><RotateCw className="i xs" /><span><Lock className="i xs" />casadorio.pt/events</span></div>
            <div className="page">
              <div className="hero-img" />
              <div className="pg-title">Plan a group event</div>
              <div className="pg-sub">Tell us about your group and we’ll reply within a day.</div>
              <div className="ff"><label>Group</label><span>Acme team · 12 guests</span></div>
              <div className="ff"><label>Dates</label><span>May 14 – 16</span></div>
              <div className="ff focus">
                <label>Message</label>
                <span>Could you serve a vegetarian lunch for 12 on the 15th?<i className="caret" /></span>
              </div>
              <div className="pg-btn">Send inquiry<Pointer /></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
