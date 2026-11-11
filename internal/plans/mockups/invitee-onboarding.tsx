import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowUp, Check, Link2, Moon, Play, RotateCcw, Sun } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Switch } from '../../../packages/overlay-ui/src/components/ui/switch'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../packages/overlay-ui/src/components/ui/dialog'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SingleChoices, MultiChoices } from '../../../src/app/_components/onboarding/OnboardingChoices'
import { OnboardingContext } from '../../../src/app/_components/onboarding/OnboardingContext'
import { ONBOARDING_ROLES, ONBOARDING_HELP_AREAS, onboardingTasksFor, type OnboardingProfile } from '../../../src/shared/onboarding/session'

type Step = 'accept' | 'name' | 'about' | 'daily' | 'connections' | 'memories' | 'task' | 'draft' | 'ready' | 'started' | 'paused'
type Message = { role: 'overlay' | 'user'; text: string }
const emptyProfile: OnboardingProfile = { name: '', about: '', daily: '', team: '' }
const initialMessages: Message[] = [{ role: 'overlay', text: 'Welcome to Acme. Priya invited you to work here with Overlay.\n\nWhat should I call you?' }]

function App() {
  const [step, setStep] = useState<Step>('accept')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [profile, setProfile] = useState<OnboardingProfile>(emptyProfile)
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [task, setTask] = useState('')
  const [paid, setPaid] = useState(true)
  const [requested, setRequested] = useState(false)
  const [preview, setPreview] = useState(false)
  const [connection, setConnection] = useState<string | null>(null)
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [dark, setDark] = useState(false)
  const [resume, setResume] = useState<Step>('name')
  const scroll = useRef<HTMLDivElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const typing = ['name', 'about', 'daily', 'task'].includes(step)
  const go = (next: Step, reply: string, answer?: string) => {
    setMessages(previous => [...previous, ...(answer ? [{ role: 'user' as const, text: answer }] : []), { role: 'overlay', text: reply }])
    setStep(next); setInput(''); setSelected(new Set())
  }
  const reset = () => {
    setMessages(initialMessages); setProfile(emptyProfile); setStep('accept'); setInput(''); setSelected(new Set()); setTask(''); setConnected(new Set()); setRequested(false); setConnection(null); setPreview(false)
  }
  useEffect(() => {
    if (scroll.current && latest.current) {
      const container = scroll.current
      const top = latest.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTo({ top: Math.min(container.scrollHeight - container.clientHeight, top - 24), behavior: 'instant' })
    }
    if (typing) composer.current?.focus({ preventScroll: true })
  }, [messages, step, typing])
  const afterContext = (answer: string) => go('task', "Last thing. What's one task we can start on?", answer)
  const answer = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (step === 'name') { setProfile({ ...profile, name: value }); go('about', `Nice to meet you, ${value}.\n\nWhat kind of work do you do?`, value) }
    if (step === 'about') { setProfile({ ...profile, about: value }); go('daily', 'What would you like help with? Pick as many as you like.', value) }
    if (step === 'daily') { setProfile({ ...profile, daily: value }); toConnections(value) }
    if (step === 'task') { setTask(value); go(paid ? 'ready' : 'draft', paid ? "Saved. Acme's budget covers this, so you can start now." : "Saved as a draft. Acme needs an active plan before tasks can run, and only owners and admins can set that up.", value) }
  }
  const submit = () => answer(step === 'daily' ? [...selected, input.trim()].filter(Boolean).join(', ') : input)
  const toConnections = (answer: string) => go('connections', 'Want to connect the tools you already use?', answer)
  const taskCard = <div className="task-preview"><span>First task</span><p>{task}</p><div><OverlayMark size={16} />Overlay<span>Acme</span></div></div>

  const editTask = <Button variant="ghost" size="sm" onClick={() => { go('task', 'What would you like to change?'); setInput(task) }}>Edit task</Button>

  function controls() {
    switch (step) {
      case 'name': return <><SingleChoices choices={['Dev']} disabled={false} onPick={answer} /><p className="hint">{paid ? "Acme is on a paid plan. Running tasks uses the workspace budget." : "Acme isn't subscribed yet. You can finish setup now."}</p></>
      case 'about': return <SingleChoices choices={ONBOARDING_ROLES} disabled={false} onPick={answer} />
      case 'daily': return <MultiChoices choices={Object.keys(ONBOARDING_HELP_AREAS)} selected={selected} disabled={false} onToggle={label => setSelected(previous => { const next = new Set(previous); if (next.has(label)) next.delete(label); else next.add(label); return next })} onContinue={submit} />
      case 'connections': return <>
        <div className="connections">{['Gmail', 'Slack', 'GitHub'].map(name => <div className="connection" key={name}><Link2 size={17} /><span>{name}</span><Button size="sm" variant="ghost" disabled={connected.has(name)} onClick={() => setConnection(name)}>{connected.has(name) ? <><Check size={13} />Connected</> : 'Connect'}</Button></div>)}</div>
        <p className="section-label">Bring your AI subscription</p>
        <div className="connection"><Link2 size={17} /><div><span>Codex</span><p>Use your ChatGPT subscription for eligible inference.</p></div><Button size="sm" variant="ghost" disabled={connected.has('Codex')} onClick={() => setConnection('Codex')}>{connected.has('Codex') ? 'Connected' : 'Connect'}</Button></div>
        <p className="hint">Optional. Overlay models work without a subscription connection. Computers and tools still use workspace credit.</p>
        <div className="actions"><Button variant="primary" size="sm" onClick={() => go('memories', 'Do you use another AI assistant? I can pick up what it already knows about your work.', connected.size ? `Continue with ${[...connected].join(', ')}.` : "I'll connect my tools later.")}>{connected.size ? 'Continue' : 'Set up later'}<ArrowRight size={14} /></Button></div>
      </>
      case 'memories': return <OnboardingContext disabled={false} onSave={() => afterContext('Save my context.')} onSkip={() => afterContext('Not now.')} />
      case 'task': return <SingleChoices choices={onboardingTasksFor(profile)} disabled={false} onPick={answer} />
      case 'draft': return <>{taskCard}
        <div className="actions"><Button variant="primary" size="sm" disabled={requested} onClick={() => setRequested(true)}>{requested ? 'Request sent' : 'Ask Priya to subscribe'}</Button>{editTask}<Button variant="secondary" size="sm" onClick={() => { setResume('draft'); go('paused', 'Your draft is saved in Work. You can return to start it once Acme is subscribed.') }}>Open Work</Button></div>
        {requested && <p className="hint" role="status">Priya has been asked. Your draft starts when you choose, once Acme is subscribed.</p>}
      </>
      case 'ready': return <>{taskCard}<div className="actions"><Button variant="primary" size="sm" onClick={() => go('started', "Your first task is now in Work. I'll keep you updated there.", 'Start my task.')}><Play size={13} />Start task</Button>{editTask}</div><p className="hint">Usage is charged to Acme's workspace budget.</p></>
      case 'started': return <div className="task-preview">{task}<p className="hint">In progress · Overlay</p><p className="preview-note">End of onboarding preview. No real task has run.</p><Button variant="ghost" size="sm" className="mt-3" onClick={reset}>Replay</Button></div>
      case 'paused': return <><p className="hint">Your setup and draft stay saved for this preview.</p><Button variant="primary" size="sm" className="mt-3" onClick={() => { setStep(resume); setMessages(previous => previous.slice(0, -1)) }}>Resume setup</Button></>
    }
  }

  return <div className="onboarding">
    <header className="top"><BrandLockup />{step !== 'accept' && <Button variant="ghost" size="sm" onClick={() => { if (step === 'paused') return; setResume(step); go('paused', 'You can finish setting up whenever you’re ready.') }} disabled={['accept', 'started'].includes(step)}>Finish later</Button>}</header>
    {step === 'accept' ? <main className="invitation"><div className="invite-wrap"><section className="invite-card" aria-labelledby="invite-title"><div className="workspace-avatar">AC</div><h1 id="invite-title">Join Acme</h1><p>Priya Shah invited you as a member.</p><p className="invited-email">dev@acme.com</p><Button variant="primary" onClick={() => setStep('name')}>Accept and continue<ArrowRight size={14} /></Button><p className="hint">New to Overlay? You'll create your account with this email.</p></section><p className="hint billing-context">{paid ? 'Acme is on a paid plan. Tasks use the workspace budget.' : "Acme hasn't activated billing yet. You can set up now and run tasks once an owner or admin subscribes."}</p></div></main> : <><div className="transcript-scroll" ref={scroll}><main className="transcript" aria-label="Onboarding conversation">
      {messages.map((message, index) => message.role === 'user'
        ? <div key={index} className="user-message"><div>{message.text}</div></div>
        : <div key={index} className="assistant-message" ref={index === messages.length - 1 ? latest : undefined}><OverlayMark size={28} /><div><div className="message-author">Overlay</div><div className="message-text">{message.text.split('\n\n').map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>{index === messages.length - 1 && <div className="reply" key={step}>{controls()}</div>}</div></div>)}
    </main></div>
    <div className="dock">{typing ? <form className="composer" onSubmit={event => { event.preventDefault(); submit() }}><Textarea ref={composer} rows={1} aria-label="Your answer" value={input} maxLength={3000} onChange={event => setInput(event.target.value)} placeholder={step === 'name' ? 'Your name' : step === 'task' ? 'Or describe a task' : 'Or tell me in your own words'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} /><Button variant="primary" size="icon-sm" type="submit" aria-label="Send answer" disabled={!input.trim() && !selected.size}><ArrowUp size={16} /></Button></form> : <div className="composer-placeholder" />}</div>
    </>}<div className="preview-bar"><label htmlFor="paid-workspace">Paid workspace</label><Switch id="paid-workspace" checked={paid} onCheckedChange={value => { setPaid(value); reset() }} /><Button variant="ghost" size="xs" onClick={() => setPreview(true)}>Preview</Button></div>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent><DialogTitle>Onboarding preview</DialogTitle><DialogDescription>This is a standalone prototype. No payments, invitations, saved memories or connections are real.</DialogDescription><div className="actions"><Button size="sm" onClick={reset}><RotateCcw size={14} />Restart</Button><Button size="sm" onClick={() => { setDark(!dark); document.documentElement.classList.toggle('dark', !dark) }}>{dark ? <Sun size={14} /> : <Moon size={14} />}{dark ? 'Light theme' : 'Dark theme'}</Button></div><Button size="sm" disabled={paid || !requested || !['draft', 'paused'].includes(step)} onClick={() => { setPaid(true); setPreview(false); go('ready', 'Acme is now subscribed. Your task is ready when you are.') }}>Simulate owner subscribes</Button></DialogContent></Dialog>
    <Dialog open={Boolean(connection)} onOpenChange={open => { if (!open) setConnection(null) }}><DialogContent><DialogTitle>Connect {connection}</DialogTitle><DialogDescription>In the app, this opens {connection === 'Codex' ? 'the supported subscription connection flow' : 'secure provider sign-in'}. No credentials are needed for this preview.</DialogDescription><Button variant="primary" onClick={() => { if (connection) setConnected(previous => new Set([...previous, connection])); setConnection(null) }}>Simulate connection</Button></DialogContent></Dialog>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
