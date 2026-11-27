import React, { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowLeft, Check, Link2, Moon, Play, Sun, Mail, Search, FileText, UserPlus, Brain, KeyRound, Plug, Hash, Monitor, Download, MessageSquare, ListTodo, Users, Zap, Folder } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SingleChoices, MultiChoices } from '../../../src/app/_components/onboarding/OnboardingChoices'
import { OnboardingEmployees } from '../../../src/app/_components/onboarding/OnboardingEmployees'
import { OnboardingContext, OnboardingInvites } from '../../../src/app/_components/onboarding/OnboardingContext'
import { ONBOARDING_INTRO, ONBOARDING_ROLES, ONBOARDING_TEAMS, ONBOARDING_HELP_AREAS, onboardingEmployeesFor, onboardingTasksFor, type OnboardingProfile } from '../../../src/shared/onboarding/session'

// Read-only audit. Every screen renders the production onboarding components with a fixed sample profile.
const profile: OnboardingProfile = { name: 'Divyansh', about: 'Founder or exec', team: 'A small team', daily: 'Research & summaries, Email & follow-ups' }
const employees = onboardingEmployeesFor(profile)
const tasks = onboardingTasksFor(profile)
const task = tasks[0]
const noop = () => {}

type Risk = 'low' | 'medium' | 'high'
type Step = { id: string; label: string; risk: Risk; prompt?: string; answer?: string; typing?: string; controls?: ReactNode; screen?: ReactNode; what: string; problem: string; fix: string }

const taskCard = <div className="task-preview"><span>First task</span><p>{task}</p><div><OverlayMark size={16} />Overlay<span>Personal</span></div></div>
const intro = (line: string) => <div className="audit-intro-screen"><div className="text-center"><BrandLockup className="audit-intro-lockup" motion="look" /><p className="audit-intro-line">{line}</p></div></div>

const current: Step[] = [
  { id: 'intro', label: 'Welcome', risk: 'low', screen: intro('Your AI Chief of Staff.'),
    what: 'A 2.2 second splash after sign in. The setup flow then takes over the whole app until it is finished or skipped.',
    problem: 'The tagline says "AI Chief of Staff". The pitch everywhere else is "AI employees that actually work".',
    fix: 'Use the same promise as the landing page, so the first screen confirms why they signed up.' },
  { id: 'name', label: 'Name', risk: 'low', prompt: `${ONBOARDING_INTRO}\n\nWhat should I call you?`, answer: 'Divyansh', typing: 'Your name',
    controls: <><SingleChoices choices={['Divyansh']} disabled={false} onPick={noop} /><p className="hint">Set up your workspace first. Running tasks starts at $8/month.</p></>,
    what: 'Asks for a name we already have from sign in. The hint mentions the $8 price on the first question.',
    problem: 'A question with no new information, and the first thing the user learns is that running anything costs money.',
    fix: 'Greet them by their sign-in name and skip this step.' },
  { id: 'about', label: 'Role', risk: 'medium', prompt: 'Nice to meet you, Divyansh.\n\nWhat kind of work do you do?', answer: profile.about, typing: 'Or tell me in your own words',
    controls: <SingleChoices choices={ONBOARDING_ROLES} disabled={false} onPick={noop} />,
    what: 'Six role chips. The reply that follows is a prepared line, not a model response.',
    problem: 'The answer does not change what Overlay does next in a way the user can see.',
    fix: 'Fold into one open question: "What should Overlay get done for you this week?"' },
  { id: 'team', label: 'Team', risk: 'medium', prompt: 'Who do you work with?', answer: profile.team, typing: 'Or tell me in your own words',
    controls: <SingleChoices choices={ONBOARDING_TEAMS} disabled={false} onPick={noop} />,
    what: 'Just me, a small team, or a larger company. Only used to decide whether to show the invite step.',
    problem: 'Another question before any value. Team size can be inferred later, when they invite someone.',
    fix: 'Remove. Ask about teammates after the first result.' },
  { id: 'daily', label: 'Help areas', risk: 'medium', prompt: 'What would you like help with? Pick as many as you like.', answer: profile.daily, typing: 'Or tell me in your own words',
    controls: <MultiChoices choices={Object.keys(ONBOARDING_HELP_AREAS)} selected={new Set(['Research & summaries', 'Email & follow-ups'])} disabled={false} onToggle={noop} onContinue={noop} />,
    what: 'Pick from six areas. Each area maps to one fixed employee and one fixed starter task.',
    problem: 'This is the only answer that matters, and it comes fourth.',
    fix: 'Make this the first and only question, with free text plus the same chips.' },
  { id: 'employees', label: 'AI employees', risk: 'medium', prompt: "Based on that, I'd start you with two AI employees. You can change them anytime.", answer: `Add ${employees.map(e => e.name).join(' and ')}.`,
    controls: <OnboardingEmployees suggested={employees} disabled={false} onConfirm={noop} onSkip={noop} />,
    what: `Suggests ${employees.map(e => e.name).join(' and ')}, editable cards the user confirms or skips.`,
    problem: 'Employees are shown as cards to configure, not as workers doing something. Nothing proves they work.',
    fix: 'Show the employee by having it start the first task live.' },
  { id: 'connections', label: 'Connect tools', risk: 'high', prompt: 'Want to connect the tools you already use?', answer: "I'll connect my tools later.",
    controls: <>
      <div className="connections">{['Gmail', 'Slack', 'GitHub'].map(name => <div className="connection" key={name}><Link2 size={17} /><span>{name}</span><Button size="sm" variant="ghost">Connect</Button></div>)}</div>
      <p className="section-label">Bring your AI subscription</p>
      <div className="connection"><Link2 size={17} /><div><span>Codex</span><p>Use your ChatGPT subscription for eligible inference.</p></div><Button size="sm" variant="ghost">Connect</Button></div>
      <p className="hint">Optional. Overlay models work without a subscription connection. Computers and tools still use workspace credit.</p>
      <div className="actions"><Button variant="primary" size="sm">Set up later<ArrowRight size={14} /></Button></div>
    </>,
    what: 'Asks for OAuth into Gmail, Slack, GitHub and a model subscription.',
    problem: 'The biggest trust ask comes before the user has seen a single result. Most people pick "Set up later".',
    fix: 'Ask in context: "Connect Gmail so Relay can send this draft."' },
  { id: 'memories', label: 'Import memory', risk: 'medium', prompt: 'Do you use another AI assistant? I can pick up what it already knows about your work.', answer: 'Not now.',
    controls: <OnboardingContext disabled={false} onSave={noop} onSkip={noop} />,
    what: 'Paste context from ChatGPT or Claude.',
    problem: 'Asks for effort with no visible payoff yet.',
    fix: 'Offer after the first result, as a way to make the next one better.' },
  { id: 'teammates', label: 'Invite', risk: 'medium', prompt: 'Want to bring in anyone you work with?', answer: 'Not now.',
    controls: <OnboardingInvites disabled={false} onInvite={noop} onSkip={noop} />,
    what: 'Invite by email. Skipped when the user picked "Just me".',
    problem: 'Nobody invites a teammate to a product they have not used. This is our best growth loop, spent too early.',
    fix: 'Prompt to share the first result with a teammate.' },
  { id: 'task', label: 'First task', risk: 'low', prompt: "Last thing. What's one task we can start on?", answer: task, typing: 'Or describe a task',
    controls: <SingleChoices choices={tasks} disabled={false} onPick={noop} />,
    what: 'Up to three suggested tasks from the help areas, or free text.',
    problem: 'This is the moment of intent, and it is step 10.',
    fix: 'Move to step 2 and start the task right away.' },
  { id: 'review', label: 'Paywall', risk: 'high', prompt: "I've saved your first task. Subscribe to give your workspace a budget before we start.",
    controls: <>
      {taskCard}
      <div className="subscription-offer"><div className="offer-price"><b>$8</b><span>/ month</span></div><p>$8 in usage credit for models, computers and tools.</p><p className="hint">Renews monthly. Unused credit expires at renewal. Cancel in billing settings.</p></div>
      <div className="actions"><Button variant="primary" size="sm">Subscribe <ArrowRight size={14} /></Button><Button variant="ghost" size="sm">Edit task</Button></div>
      <p className="hint">No trial. Payment won’t start your task automatically.</p>
    </>,
    what: 'Stripe checkout for $8/month. No trial, no free run.',
    problem: 'The user has answered 9 screens and seen zero output. This is where most growth is lost.',
    fix: 'Run the first task free on a small one-time credit. Ask for $8 after they see the result.' },
  { id: 'ready', label: 'After payment', risk: 'high', prompt: 'Your payment is confirmed. You have $8 in workspace credit.\n\nYour task is ready when you are.', answer: 'Start my task.',
    controls: <>{taskCard}<div className="actions"><Button variant="primary" size="sm"><Play size={13} />Start task</Button></div><p className="hint">Usage is charged to your workspace budget.</p></>,
    what: 'Back from Stripe. The task still has not started.',
    problem: 'A paying user has to click once more before anything happens.',
    fix: 'Start the task automatically after payment.' },
  { id: 'started', label: 'Done', risk: 'medium', prompt: "Your first task is now in Work. I'll keep you updated there.",
    controls: <div className="task-preview">{task}<p className="hint">In progress · Overlay</p></div>,
    what: 'Onboarding ends and sends the user to Work.',
    problem: 'The user leaves before seeing the employee do anything. The first result arrives later, somewhere else.',
    fix: 'Keep them in place and stream the work live until the first result.' },
]

const working = (lines: { icon: ReactNode; text: string; done?: boolean }[]) => <div className="audit-run">
  <div className="audit-run-head"><OverlayMark size={18} motion="look" /><span>Overlay is working</span><span className="audit-run-time">0:42</span></div>
  {lines.map((line, i) => <div className="audit-run-line" key={i} data-done={line.done}>{line.done ? <Check size={13} /> : line.icon}<span>{line.text}</span></div>)}
</div>

const HEARD = ['X', 'LinkedIn', 'A friend or colleague', 'Search', 'YouTube', 'Somewhere else']
const TEAM_CHOICES = ['Just me', 'With a team']

type Msg = { from: 'user' | 'overlay'; text: string; extra?: ReactNode }
const CHECKLIST = [
  { icon: <Play size={14} />, label: 'Start your first task', done: true },
  { icon: <UserPlus size={14} />, label: 'Invite a teammate' },
  { icon: <Brain size={14} />, label: 'Import memories from ChatGPT or Claude' },
  { icon: <KeyRound size={14} />, label: 'Connect your AI subscription' },
  { icon: <Plug size={14} />, label: 'Connect tools like Gmail and Calendar' },
  { icon: <Hash size={14} />, label: 'Connect Slack' },
  { icon: <Monitor size={14} />, label: 'Get the desktop app' },
]
const doneCount = CHECKLIST.filter(c => c.done).length

function ChecklistPanel() {
  return <div className="side-checklist" role="menu" aria-label="Get started">
    <div className="side-checklist-head"><b>Get started with Overlay</b><span>{doneCount} of {CHECKLIST.length}</span></div>
    <div className="side-progress"><i style={{ width: `${(doneCount / CHECKLIST.length) * 100}%` }} /></div>
    {CHECKLIST.map(c => <button key={c.label} className="side-checklist-row" data-done={c.done} role="menuitem">
      <span className="side-check-icon">{c.done ? <Check size={12} /> : c.icon}</span><span>{c.label}</span>{!c.done && <ArrowRight size={13} />}
    </button>)}
  </div>
}

function Paywall() {
  return <div className="paywall-scrim"><div className="paywall">
    <OverlayMark size={32} />
    <h3>Your first task is done.</h3>
    <p className="paywall-sub">That one was on us. Pick how you want to keep working with Overlay.</p>
    <div className="paywall-tiers">
      <div className="tier">
        <span className="tier-name">Free</span>
        <div className="offer-price"><b>$0</b><span>forever</span></div>
        <p className="tier-line">Overlay for desktop</p>
        <ul><li><Check size={13} />Your personal chief of staff on your Mac</li><li><Check size={13} />Runs on your own AI subscription</li><li><Check size={13} />Chats, notes and memory</li></ul>
        <Button variant="ghost" size="sm" className="tier-btn"><Download size={14} />Download for Mac</Button>
      </div>
      <div className="tier" data-featured>
        <span className="tier-name">Usage</span>
        <div className="offer-price"><b>$8</b><span>/ month</span></div>
        <p className="tier-line">Includes $8 of usage credit</p>
        <ul><li><Check size={13} />Overlay and AI employees on cloud computers</li><li><Check size={13} />Team threads and teammates</li><li><Check size={13} />Connectors, Slack and automations</li></ul>
        <Button variant="primary" size="sm" className="tier-btn">Subscribe<ArrowRight size={14} /></Button>
      </div>
    </div>
    <p className="hint">Cancel anytime in billing settings.</p>
  </div></div>
}

function AppScreen({ team, messages, checklist, tooltip, paywall }: { team: boolean; messages: Msg[]; checklist?: boolean; tooltip?: boolean; paywall?: boolean }) {
  const thread = team ? 'Overlay' : 'Personal chief'
  const nav: [string, ReactNode][] = [['Chat', <MessageSquare size={15} />], ['Work', <ListTodo size={15} />], ['Agents', <Users size={15} />], ['Automations', <Zap size={15} />], ['Files', <Folder size={15} />]]
  return <div className="app-shell">
    <aside className="app-side">
      <div className="side-ws"><OverlayMark size={18} /><span>{team ? 'Acme' : 'Personal'}</span></div>
      <nav className="side-nav">{nav.map(([l, i]) => <div key={l} className="side-row" data-active={l === 'Chat'}>{i}<span>{l}</span></div>)}</nav>
      <p className="side-label">Chats</p>
      <div className="side-row side-thread" data-active><OverlayMark size={14} /><span>{thread}</span></div>
      <div className="side-spacer" />
      <div className="side-check-wrap">
        {checklist && <ChecklistPanel />}
        {tooltip && <div className="side-tooltip"><b>Finish setting up Overlay</b><span>Six quick steps, whenever you are ready.</span></div>}
        <button className="side-check" data-open={checklist}><span className="side-ring" style={{ ['--p' as string]: `${(doneCount / CHECKLIST.length) * 360}deg` }} /><span>Get started</span><em>{doneCount}/{CHECKLIST.length}</em></button>
      </div>
      <div className="side-user"><div className="side-avatar">D</div><span>Divyansh</span></div>
    </aside>
    <main className="app-main">
      <header className="thread-head"><OverlayMark size={18} /><b>{thread}</b><span>{team ? 'Team thread · your teammates can follow along' : 'Personal chief of staff · private to you'}</span></header>
      <div className="transcript-scroll" ref={el => { if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }) }}><main className="transcript">
        {messages.map((m, i) => m.from === 'user'
          ? <div className="user-message" key={i}><div>{m.text}</div></div>
          : <div className="assistant-message" key={i}><OverlayMark size={28} /><div><div className="message-author">Overlay</div><div className="message-text">{m.text.split('\n\n').map((p, j) => <p key={j}>{p}</p>)}</div>{m.extra && <div className="reply">{m.extra}</div>}</div></div>)}
      </main></div>
      <div className="dock"><form className="composer" onSubmit={e => e.preventDefault()}><Textarea rows={1} aria-label="Message" placeholder={`Message ${thread}`} /><Button variant="primary" size="icon-sm" disabled aria-label="Send"><ArrowRight size={16} /></Button></form></div>
      {paywall && <Paywall />}
    </main>
  </div>
}

const proposed = (team: boolean): Step[] => {
  const where = team ? 'the Overlay team thread' : 'your Personal chief thread'
  const kickoff: Msg[] = [
    { from: 'user', text: task },
    { from: 'overlay', text: `On it. I started this in ${where}, so you can follow along here.`, extra: working([
      { icon: <Search size={13} />, text: 'Finding your top competitors', done: true },
      { icon: <Search size={13} />, text: 'Reading pricing pages and recent launches' },
      { icon: <FileText size={13} />, text: 'Writing the brief' },
    ]) },
  ]
  const askTool: Msg = { from: 'overlay', text: 'Quick question. If you connect Gmail, I can also pull what customers have said about these competitors. Want to?', extra: <>
    <div className="connection"><Mail size={17} /><div><span>Gmail</span><p>Read-only, for this task. You can disconnect anytime.</p></div><Button size="sm" variant="ghost">Connect</Button></div>
    <div className="actions"><Button size="sm" variant="ghost">Skip, use the web only</Button></div>
  </> }
  const done: Msg[] = [...kickoff.slice(0, 1), { from: 'overlay', text: `On it. I started this in ${where}.`, extra: working([
      { icon: <Search size={13} />, text: 'Finding your top competitors', done: true },
      { icon: <Search size={13} />, text: 'Reading pricing pages and recent launches', done: true },
      { icon: <FileText size={13} />, text: 'Writing the brief', done: true },
    ]) }, { from: 'user', text: 'Skip, use the web only.' },
    { from: 'overlay', text: "Done. Here's your brief.", extra: <div className="task-preview"><span>Result</span><p>Competitor brief: 3 companies, pricing, positioning, gaps</p><div><FileText size={14} />1 page · 9 sources</div></div> }]
  return [
    { id: 'p-intro', label: 'Welcome', risk: 'low', screen: intro('Your AI Chief of Staff.'),
      what: 'Overlay introduces itself as the chief of staff. Overlay is the one the user talks to for the whole flow, not a set of employees.', problem: '', fix: 'Overlay is the star. Employees show up later, when Overlay hands work to them.' },
    { id: 'p-heard', label: 'Q1 · Heard about', risk: 'low', prompt: "Hi, I'm Overlay, your AI chief of staff. Five quick questions and I'll get to work.\n\nHow did you hear about Overlay?", answer: 'X', typing: 'Or tell me',
      controls: <SingleChoices choices={HEARD} disabled={false} onPick={noop} />,
      what: 'Question 1 of 5. One tap, saved for attribution.', problem: '', fix: 'Tells us which channels actually bring users. It costs one tap.' },
    { id: 'p-name', label: 'Q2 · Name', risk: 'low', prompt: 'Thanks. What should I call you?', answer: 'Divyansh', typing: 'Your name',
      controls: <SingleChoices choices={['Divyansh']} disabled={false} onPick={noop} />,
      what: 'Question 2 of 5. The sign-in name is filled in as one tap.', problem: '', fix: 'No price mention here anymore. Money comes up only after the first result.' },
    { id: 'p-role', label: 'Q3 · Role', risk: 'low', prompt: 'Nice to meet you, Divyansh. What kind of work do you do?', answer: profile.about, typing: 'Or tell me in your own words',
      controls: <SingleChoices choices={ONBOARDING_ROLES} disabled={false} onPick={noop} />,
      what: 'Question 3 of 5. Shapes the suggested tasks on the next screen.', problem: '', fix: 'The answer shows up right away in the task suggestions.' },
    { id: 'p-team', label: 'Q4 · Team', risk: 'low', prompt: 'Do you work with a team?', answer: team ? 'With a team' : 'Just me', typing: 'Or tell me',
      controls: <SingleChoices choices={TEAM_CHOICES} disabled={false} onPick={noop} />,
      what: 'Question 4 of 5. Yes or no. Decides where the first task runs.', problem: '', fix: 'Just me starts in the Personal chief thread. A team starts in the shared Overlay thread. Use the switch below to see both.' },
    { id: 'p-task', label: 'Q5 · Task', risk: 'low', prompt: "Last one. What's one thing I can take off your plate today?", answer: task, typing: 'Or describe a task',
      controls: <><SingleChoices choices={tasks} disabled={false} onPick={noop} /><p className="hint">Your first task is on us.</p></>,
      what: 'Question 5 of 5. Suggested tasks based on the role, or free text.', problem: '', fix: 'The free first task removes the paywall before value.' },
    { id: 'p-sub', label: 'Connect subscription', risk: 'low', prompt: 'Already pay for ChatGPT? Connect it and I can use it for eligible work. Totally optional.', answer: 'Skip for now.',
      controls: <>
        <div className="connection"><KeyRound size={17} /><div><span>Codex</span><p>Use your ChatGPT subscription for eligible inference.</p></div><Button size="sm" variant="ghost">Connect</Button></div>
        <div className="actions"><Button variant="primary" size="sm">Start my task<ArrowRight size={14} /></Button><Button variant="ghost" size="sm">Skip for now</Button></div>
      </>,
      what: 'One optional screen, with a big skip. Either button starts the task.', problem: '', fix: 'This is the only connection in onboarding. Gmail, Slack and the rest move into the thread or the checklist.' },
    { id: 'p-start', label: team ? 'Starts in Overlay' : 'Starts in Personal chief', risk: 'low', screen: <AppScreen team={team} messages={kickoff} />,
      what: `Onboarding closes and the user lands in the app, inside ${where}, with the task already running. No extra Start click.`, problem: '', fix: 'The first thing they see in the product is Overlay doing work for them.' },
    { id: 'p-tool', label: 'Asks for tools in thread', risk: 'low', screen: <AppScreen team={team} messages={[...kickoff, askTool]} />,
      what: 'If the task would benefit from a connector, Overlay asks right in the thread, tied to this task.', problem: '', fix: 'Trust asks come with a clear reason, and skipping still finishes the task.' },
    { id: 'p-pay', label: 'Free or paid', risk: 'low', screen: <AppScreen team={team} messages={done} paywall />,
      what: 'When the first task finishes, a screen offers two plans. Free points to the desktop app. Usage is $8/month. Anything paid is blocked until they choose.', problem: '', fix: 'They decide after seeing a result, and there is always a free path, so nobody hits a dead end.' },
    { id: 'p-tip', label: 'Checklist tooltip', risk: 'low', screen: <AppScreen team={team} messages={done} tooltip />,
      what: 'Back in the app, a tooltip points to "Get started" at the bottom left of the primary sidebar.', problem: '', fix: 'Shows the next steps without blocking anything. Shown once.' },
    { id: 'p-list', label: 'Checklist', risk: 'low', screen: <AppScreen team={team} messages={done} checklist />,
      what: 'The checklist menu: invite a teammate, import memories, connect a subscription, connect tools, connect Slack, get the desktop app. The ring fills as items are done.', problem: '', fix: 'Everything we cut from onboarding lives here, for whenever the user wants it.' },
  ]
}

function Transcript({ steps, index }: { steps: Step[]; index: number }) {
  const step = steps[index]
  if (step.screen) return <div className="onboarding">{step.screen}</div>
  const shown = steps.slice(0, index + 1).filter(s => s.prompt)
  return <div className="onboarding">
    <header className="top"><BrandLockup /><Button variant="ghost" size="sm">Finish later</Button></header>
    <div className="transcript-scroll" ref={el => { if (el) requestAnimationFrame(() => requestAnimationFrame(() => { const last = el.querySelector(".assistant-message:last-of-type") as HTMLElement | null; el.scrollTop = last ? last.offsetTop - 24 : el.scrollHeight })) }}><main className="transcript" style={{ position: "relative" }} aria-label="Onboarding conversation">
      {shown.map((s, i) => <React.Fragment key={s.id}>
        <div className="assistant-message"><OverlayMark size={28} /><div><div className="message-author">Overlay</div><div className="message-text">{s.prompt!.split('\n\n').map((p, j) => <p key={j}>{p}</p>)}</div>{i === shown.length - 1 && s.controls && <div className="reply">{s.controls}</div>}</div></div>
        {i < shown.length - 1 && s.answer && <div className="user-message"><div>{s.answer}</div></div>}
      </React.Fragment>)}
    </main></div>
    <div className="dock">{step.typing ? <form className="composer" onSubmit={e => e.preventDefault()}><Textarea rows={1} aria-label="Your answer" placeholder={step.typing} /><Button variant="primary" size="icon-sm" disabled aria-label="Send"><ArrowRight size={16} /></Button></form> : <div className="composer-placeholder" />}</div>
  </div>
}

function App() {
  const params = new URLSearchParams(location.search)
  const [mode, setMode] = useState<'current' | 'proposed'>(params.get('flow') === 'proposed' ? 'proposed' : 'current')
  const [index, setIndex] = useState(Number(params.get('step') ?? 0))
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  const [team, setTeam] = useState(params.get('team') === '1')
  const proposedSteps = proposed(team)
  const steps = mode === 'current' ? current : proposedSteps
  const step = steps[Math.min(index, steps.length - 1)]
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, steps.length - 1)); if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0)) }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [steps.length])
  const at = Math.min(index, steps.length - 1)
  return <div className="audit-root">
    <header className="audit-toolbar">
      <div className="audit-toolbar-title"><strong>Onboarding audit</strong><span>Production components from origin/main · sample profile: founder</span></div>
      <div className="audit-segment">{(['current', 'proposed'] as const).map(m => <Button key={m} size="sm" variant="ghost" aria-pressed={mode === m} onClick={() => { setMode(m); setIndex(0) }}>{m === 'current' ? `Current · ${current.length} screens` : `Proposed · ${proposedSteps.length} screens`}</Button>)}</div>
      {mode === 'proposed' && <div className="audit-segment">{[false, true].map(t => <Button key={String(t)} size="sm" variant="ghost" aria-pressed={team === t} onClick={() => setTeam(t)}>{t ? 'With a team' : 'Just me'}</Button>)}</div>}
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={15} /> : <Moon size={15} />}</Button>
    </header>
    <nav className="audit-fixtures" aria-label="Steps"><span>Steps</span>
      {steps.map((s, i) => <Button key={s.id} size="sm" variant="ghost" aria-pressed={i === at} onClick={() => setIndex(i)}><i className="audit-dot" data-risk={s.risk} />{i + 1}. {s.label}</Button>)}
    </nav>
    <div className="audit-body">
      <div className="audit-stage"><div className="audit-frame" key={mode + at}><Transcript steps={steps} index={at} /></div></div>
      <aside className="audit-notes">
        <p className="audit-kicker">Step {at + 1} of {steps.length}{mode === 'current' ? <> · <i className="audit-dot" data-risk={step.risk} />{step.risk} drop-off risk</> : ' · proposed'}</p>
        <h2>{step.label}</h2>
        <p className="audit-label">What happens</p><p>{step.what}</p>
        {step.problem && <><p className="audit-label">Problem</p><p>{step.problem}</p></>}
        <p className="audit-label">{mode === 'current' ? 'Fix' : 'Why'}</p><p>{step.fix}</p>
        <div className="audit-nav"><Button size="sm" variant="ghost" disabled={at === 0} onClick={() => setIndex(at - 1)}><ArrowLeft size={14} />Back</Button><Button size="sm" variant="primary" disabled={at === steps.length - 1} onClick={() => setIndex(at + 1)}>Next<ArrowRight size={14} /></Button></div>
        <p className="audit-caption">Risk ratings are judgment from the flow, not analytics. Per-step events are not tracked yet.</p>
      </aside>
    </div>
    <footer className="audit-footer">{mode === 'current'
      ? <span>13 screens before anything runs · 9 of them setup · $8 paid before the first output · 0 model replies during setup</span>
      : <span>5 questions + 1 optional subscription · task starts in {team ? 'the Overlay team thread' : 'Personal chief'} · free first result · free or $8 after · checklist for the rest</span>}<span>← → to step</span></footer>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
