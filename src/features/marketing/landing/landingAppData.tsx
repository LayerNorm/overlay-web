import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { LandingAgent, type LandingAgentId, type LandingPersonId } from './LandingAgent'

/** Fixture content for the clickable app preview on the home page. */

export type Scope = 'workspace' | 'personal'
export type ThreadState = 'run' | 'done' | 'idle'

export type PreviewAgent = {
  role: string
  desc: string
  status?: string
  threads: Array<[string, ThreadState]>
  tools: string
  /** What the Computer tab shows: a terminal, or a browser at this page. */
  computer: { kind: 'term' } | { kind: 'browser'; url: string; page: string }
}

export const PREVIEW_AGENTS: Record<LandingAgentId, PreviewAgent> = {
  overlay: { role: 'Workspace chief of staff', desc: 'Plans the work, delegates to your team and keeps everything moving.', status: '1 working · 1 ready', threads: [['Atlas launch', 'run'], ['November close', 'done'], ['Weekly metrics digest', 'idle']], tools: '14 on', computer: { kind: 'browser', url: 'app.overlay.works/work', page: 'Atlas launch' } },
  engineering: { role: 'Ships fixes and releases', desc: 'Owns the codebase, CI and releases. Reports to Sam Reyes.', status: '1 working', threads: [['Fix flaky checkout test', 'run'], ['Release 2.4', 'done']], tools: '9 on', computer: { kind: 'term' } },
  growth: { role: 'Launches and campaigns', desc: 'Writes launch posts, emails and ads. Reports to Lena Park.', status: '1 working', threads: [['Atlas launch post', 'run'], ['Competitor launches digest', 'done']], tools: '7 on', computer: { kind: 'browser', url: 'overlay.works/blog/atlas', page: 'Introducing Atlas' } },
  support: { role: 'Answers every ticket', desc: 'Triages the inbox and answers customers. Reports to Lena Park.', status: '2 ready', threads: [['Launch-day replies', 'done'], ['Weekly ticket review', 'done']], tools: '6 on', computer: { kind: 'browser', url: 'help.acme.com/atlas', page: 'Atlas FAQ' } },
  docs: { role: 'Keeps guides current', desc: 'Writes the changelog and keeps guides accurate. Reports to Sam Reyes.', threads: [['Changelog for 2.4', 'done']], tools: '5 on', computer: { kind: 'browser', url: 'docs.acme.com/changelog', page: 'Changelog 2.4' } },
  finance: { role: 'Books and payouts', desc: 'Reconciles payouts and closes the books each month.', threads: [['November close', 'done']], tools: '6 on', computer: { kind: 'browser', url: 'dashboard.stripe.com/payouts', page: 'Payouts' } },
  operations: { role: 'Vendors, travel, offsites', desc: 'Books travel, venues and vendors, with approval for spend.', threads: [['Lisbon offsite', 'run']], tools: '8 on', computer: { kind: 'browser', url: 'casadorio.pt/events', page: 'Plan a group event' } },
  personalOverlay: { role: 'Your personal chief of staff', desc: 'Private to you. Knows your calendar, inbox and notes.', status: '1 ready', threads: [['1:1 prep with Sam', 'done'], ['Board meeting draft', 'idle']], tools: '11 on', computer: { kind: 'browser', url: 'calendar.google.com', page: 'This week' } },
  inbox: { role: 'Your email assistant', desc: 'Drafts replies and keeps your inbox at zero. Only you can see it.', status: '1 ready', threads: [['Brightline intro', 'done']], tools: '3 on', computer: { kind: 'browser', url: 'mail.google.com', page: 'Re: Intro to Brightline' } },
  research: { role: 'Digs into anything', desc: 'Researches markets, people and companies for you.', status: '1 working', threads: [['Competitor pricing scan', 'run']], tools: '4 on', computer: { kind: 'browser', url: 'linear.app/pricing', page: 'Pricing' } },
}

export const SCOPE_AGENTS: Record<Scope, LandingAgentId[]> = {
  workspace: ['overlay', 'engineering', 'growth', 'support', 'docs', 'finance', 'operations'],
  personal: ['personalOverlay', 'inbox', 'research'],
}

const FileChip = ({ children }: { children: ReactNode }) => <span className="a-file"><FileText className="i xs" />{children}</span>

/** One step of an agent thread: your message, or the agent's reply with an optional running step. */
export type ThreadMessage =
  | { me: ReactNode }
  | { time: string; tools?: string; body?: ReactNode; running?: string }

const THREADS: Partial<Record<string, ThreadMessage[]>> = {
  'overlay:0': [
    { me: 'Atlas ships Thursday. Get everything ready and tell me what needs me.' },
    { time: '9:02 AM', tools: 'Worked, asked 4 agents', body: <><p>I split the launch across the team and set the dependencies in Work.</p><ol><li><b>Engineering</b> cuts release 2.4 and fixes the blockers.</li><li><b>Docs</b> writes the changelog.</li><li><b>Growth</b> drafts the launch post and email.</li><li><b>Support</b> preps launch-day replies.</li></ol><p>One thing needs you: Growth wants a <b>$1,200 ad budget</b> for launch week.</p></> },
    { me: 'Approved. Can Engineering also check the mobile checkout before Thursday?' },
    { time: '9:06 AM', tools: 'Worked, called 2 tools', running: 'Asking Engineering: test mobile checkout' },
  ],
  'overlay:1': [
    { me: 'Close the books for November and flag anything odd.' },
    { time: 'Nov 3', tools: 'Worked, asked 3 agents', body: <><p>November is closed. <b>Finance</b> reconciled 214 payouts and <b>Support</b> explained two refunds.</p><p>Three vendor bills are over $2,000 and wait for your approval in Work.</p></> },
  ],
  'overlay:2': [{ time: 'Mon 8:00 AM', tools: 'Worked, called 6 tools', body: <p>Weekly metrics: signups are up 14%, activation is steady at 41% and two Business accounts look at risk. Support is already in touch with both.</p> }],
  'engineering:0': [
    { me: 'Fix the flaky checkout test before Thursday.' },
    { time: '9:40 AM', tools: 'Worked, called 9 tools', body: <p>Found it: the test waited on a real clock. I switched it to the fake clock, ran the suite 20 times and opened <b>PR #482</b>. All 214 tests pass.</p> },
    { time: '9:58 AM', tools: 'Worked, called 3 tools', running: 'Running mobile checkout on iOS and Android' },
  ],
  'growth:0': [
    { me: 'Draft the Atlas launch post. Keep it under 300 words.' },
    { time: '10:21 AM', tools: 'Worked, called 5 tools', body: <><p>The draft is in <FileChip>Launch post v2</FileChip>. It leads with the time saved per team and ends with the pricing change.</p><p>I also want to run ads in launch week. That needs a $1,200 budget, so I asked Overlay to get approval.</p></> },
    { time: '10:30 AM', tools: 'Worked, called 2 tools', running: 'Writing the launch email' },
  ],
  'support:0': [{ me: 'Prepare replies for launch-day questions.' }, { time: 'Yesterday', tools: 'Worked, called 7 tools', body: <p>I wrote 12 saved replies from last launch’s top questions and published an <b>Atlas FAQ</b> in the help center. Anything I can’t answer goes to Lena.</p> }],
  'docs:0': [{ me: 'Write the changelog for 2.4.' }, { time: 'Yesterday', tools: 'Worked, called 4 tools', body: <p>The changelog is live with 9 changes, grouped as New, Improved and Fixed. I linked each entry to its pull request.</p> }],
  'finance:0': [{ me: 'Close November.' }, { time: 'Dec 1', tools: 'Worked, called 11 tools', body: <p>Reconciled 214 Stripe payouts against the bank. Everything matches except one $48 refund, which I flagged for Maya.</p> }],
  'operations:0': [
    { me: 'Find a venue in Lisbon for our offsite, May 14 to 16, 12 people, under €4,000.' },
    { time: '11:02 AM', tools: 'Worked, called 9 tools', body: <p>Three venues fit. <b>Casa do Rio</b> is €3,450 with a river view. I’m asking them about a vegetarian lunch now.</p> },
    { time: '11:05 AM', running: 'Filling in the Casa do Rio events form' },
  ],
  'personalOverlay:0': [{ me: 'Prep notes for my 1:1 with Sam.' }, { time: '8:30 AM', tools: 'Worked, called 4 tools', body: <><p>Three things for Sam today:</p><ol><li>Thank him for unblocking the Atlas release.</li><li>Hiring: two engineering candidates are waiting on him.</li><li>His promo doc is due Friday.</li></ol><p>These notes are private. Sam can’t see them.</p></> }],
  'inbox:0': [{ me: 'Reply to the Brightline intro.' }, { time: '9:40 AM', tools: 'Worked, called 3 tools', body: <p>Drafted a reply that thanks Priya for the intro and offers Tuesday or Wednesday afternoon. It’s in your Gmail drafts. Want me to send it?</p> }],
  'research:0': [{ me: 'How do competitors price per seat?' }, { time: '10:10 AM', running: 'Reading 6 pricing pages' }],
}

export function previewThread(agent: LandingAgentId, index: number): ThreadMessage[] {
  const known = THREADS[`${agent}:${index}`]
  if (known) return known
  const [title, state] = PREVIEW_AGENTS[agent].threads[index]
  return [
    { me: `Where are we on ${title.toLowerCase()}?` },
    { time: 'Today', tools: 'Worked, called 3 tools', body: <p>{title} is {state === 'done' ? 'done. Everything is in the Library.' : 'on track. I’ll post here when it’s ready.'}</p> },
  ]
}

export type Who = LandingAgentId | LandingPersonId
export type ChatMessage = { me: ReactNode } | { who: Who; time: string; body: ReactNode }
export type PreviewChat = { kind: 'channel' | 'dm' | 'ai'; title: string; with?: Who; members?: Who[]; messages: ChatMessage[] }

export const PREVIEW_CHATS: Record<string, PreviewChat> = {
  'atlas-launch': { kind: 'channel', title: 'atlas-launch', members: ['maya', 'sam', 'lena', 'engineering', 'growth', 'overlay'], messages: [
    { who: 'sam', time: '10:12 AM', body: 'Checkout tests are red on mobile. Can we still ship Thursday?' },
    { who: 'engineering', time: '10:14 AM', body: 'It’s one flaky test, not a real bug. The fix is in PR #482 and staging is green again.' },
    { who: 'lena', time: '10:20 AM', body: 'Great. Growth, is the launch post ready for review?' },
    { who: 'growth', time: '10:21 AM', body: <>Yes, it’s in <FileChip>Launch post v2</FileChip>. I kept it under 300 words and added the pricing change.</> },
    { me: <><span className="a-mention"><LandingAgent id="overlay" size={14} />Overlay</span> can you pull together everything still open for Thursday?</> },
    { who: 'overlay', time: '10:24 AM', body: <><p>Three things are left before Thursday:</p><ol><li><b>Lena</b> reviews the launch post.</li><li><b>Engineering</b> merges PR #482 once Sam approves.</li><li><b>Support</b> publishes the launch FAQ, due Wednesday.</li></ol><p>Everything else is done. I’ll post a summary here every morning until launch.</p></> },
  ] },
  general: { kind: 'channel', title: 'general', members: ['maya', 'sam', 'lena', 'overlay'], messages: [
    { who: 'maya', time: 'Mon 9:00 AM', body: 'Welcome Finance and Operations to the team! They report to Overlay. Ask them for anything money or travel related.' },
    { who: 'lena', time: 'Mon 9:12 AM', body: 'Already asked Operations to book flights for the offsite. Took two minutes.' },
    { who: 'overlay', time: 'Mon 9:14 AM', body: 'Flights for 12 are on hold until Friday. Maya, the total is €2,860 and waits for your approval.' },
  ] },
  engineering: { kind: 'channel', title: 'engineering', members: ['sam', 'engineering', 'docs'], messages: [
    { who: 'engineering', time: '8:02 AM', body: 'Nightly build passed. 214 tests, 0 failures. Release 2.4 is ready to tag.' },
    { who: 'sam', time: '8:15 AM', body: 'Tag it. Docs, can you have the changelog ready by noon?' },
    { who: 'docs', time: '8:16 AM', body: 'On it. The changelog will be live by 11:30.' },
  ] },
  sam: { kind: 'dm', title: 'Sam Reyes', with: 'sam', messages: [{ who: 'sam', time: '9:30 AM', body: 'Do we still have time for the 1:1 at 2?' }, { me: 'Yes, see you then.' }] },
  lena: { kind: 'dm', title: 'Lena Park', with: 'lena', messages: [{ who: 'lena', time: 'Yesterday', body: 'The launch post is great. Growth nailed the tone.' }] },
  growth: { kind: 'dm', title: 'Growth', with: 'growth', messages: [{ me: 'Can you shorten the email subject line?' }, { who: 'growth', time: '10:40 AM', body: 'Three options: “Atlas is here”, “Meet Atlas” and “Your team, on autopilot”. I’d go with the first.' }] },
  okrs: { kind: 'ai', title: 'Draft Q1 OKRs', messages: [{ me: 'Draft Q1 OKRs for the company based on the board deck.' }, { who: 'personalOverlay', time: '8:10 AM', body: 'Three objectives, each with two key results: grow revenue to $1.2M ARR, reach 45% activation and ship Atlas to all Business customers.' }] },
  board: { kind: 'ai', title: 'Board deck outline', messages: [{ me: 'Outline the December board deck.' }, { who: 'personalOverlay', time: 'Mon', body: 'Ten slides: highlights, metrics, Atlas launch, hiring, cash and runway, and three asks for the board.' }] },
  offsite: { kind: 'ai', title: 'Offsite agenda ideas', messages: [{ me: 'Ideas for the offsite agenda?' }, { who: 'personalOverlay', time: 'Sun', body: 'Day one on strategy, day two on Atlas retros and planning, and a dinner by the river on the last night.' }] },
}

export const CHAT_GROUPS: Record<Scope, Array<[string, string[]]>> = {
  workspace: [['Direct messages', ['sam', 'lena', 'growth']], ['Channels', ['atlas-launch', 'general', 'engineering']]],
  personal: [['Recents', ['okrs', 'board', 'offsite']]],
}

export type WorkStatus = 'progress' | 'todo' | 'done'
export type WorkItem = { status: WorkStatus; title: string; who: Who; due: string; needsYou?: boolean }

export const PREVIEW_WORK: Record<Scope, WorkItem[]> = {
  workspace: [
    { status: 'progress', title: 'Cut release 2.4 and fix blockers', who: 'engineering', due: 'Thu' },
    { status: 'progress', title: 'Launch post and email', who: 'growth', due: 'Wed' },
    { status: 'progress', title: 'Book the Lisbon offsite venue', who: 'operations', due: 'Fri' },
    { status: 'todo', title: 'Approve the $1,200 ad budget', who: 'maya', due: 'Today', needsYou: true },
    { status: 'todo', title: 'Review the launch post', who: 'lena', due: 'Wed' },
    { status: 'todo', title: 'Approve PR #482', who: 'sam', due: 'Today' },
    { status: 'done', title: 'Changelog for 2.4', who: 'docs', due: 'Mon' },
    { status: 'done', title: 'Launch-day support replies', who: 'support', due: 'Mon' },
    { status: 'done', title: 'November close', who: 'finance', due: 'Dec 1' },
  ],
  personal: [
    { status: 'progress', title: 'Board deck outline', who: 'maya', due: 'Fri' },
    { status: 'progress', title: 'Competitor pricing scan', who: 'research', due: 'Thu' },
    { status: 'todo', title: 'Send the Brightline reply', who: 'inbox', due: 'Today', needsYou: true },
    { status: 'done', title: '1:1 prep with Sam', who: 'personalOverlay', due: 'Today' },
  ],
}

export type FileKind = 'doc' | 'code' | 'sheet' | 'image'
export type PreviewFile = { kind: FileKind; name: string; by: Who; updated: string; folder: string }

export const PREVIEW_FILES: Record<Scope, PreviewFile[]> = {
  workspace: [
    { kind: 'doc', name: 'Launch post v2', by: 'growth', updated: '10 min ago', folder: 'Launch' },
    { kind: 'code', name: 'release-2.4-notes.md', by: 'engineering', updated: '1 h ago', folder: 'Launch' },
    { kind: 'doc', name: 'Atlas FAQ', by: 'support', updated: 'Yesterday', folder: 'Launch' },
    { kind: 'sheet', name: 'November close.xlsx', by: 'finance', updated: 'Dec 1', folder: 'Finance' },
    { kind: 'doc', name: 'Pricing benchmark', by: 'growth', updated: 'Nov 20', folder: 'Research' },
    { kind: 'image', name: 'Atlas hero.png', by: 'growth', updated: 'Nov 19', folder: 'Launch' },
    { kind: 'doc', name: 'Offsite venues', by: 'operations', updated: 'Today', folder: 'Research' },
    { kind: 'doc', name: 'Changelog 2.4', by: 'docs', updated: 'Mon', folder: 'Launch' },
  ],
  personal: [
    { kind: 'doc', name: 'Board meeting draft', by: 'maya', updated: 'Mon', folder: 'Notes' },
    { kind: 'doc', name: '1:1 notes: Sam', by: 'personalOverlay', updated: 'Today', folder: 'Notes' },
    { kind: 'sheet', name: 'Q4 revenue model.xlsx', by: 'maya', updated: 'Nov 12', folder: 'Finance' },
    { kind: 'doc', name: 'Competitor pricing', by: 'research', updated: 'Today', folder: 'Notes' },
  ],
}
