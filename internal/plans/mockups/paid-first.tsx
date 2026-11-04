import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowUp, Check, CreditCard, Link2, Moon, Play, RotateCcw, Sun } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../packages/overlay-ui/src/components/ui/dialog'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SingleChoices, MultiChoices } from '../../../src/app/_components/onboarding/OnboardingChoices'
import { OnboardingEmployees } from '../../../src/app/_components/onboarding/OnboardingEmployees'
import { OnboardingContext, OnboardingInvites } from '../../../src/app/_components/onboarding/OnboardingContext'
import { ONBOARDING_INTRO, ONBOARDING_ROLES, ONBOARDING_TEAMS, ONBOARDING_HELP_AREAS, onboardingEmployeesFor, onboardingTasksFor, type OnboardingProfile } from '../../../src/shared/onboarding/session'

type Step = 'name' | 'about' | 'team' | 'daily' | 'employees' | 'connections' | 'memories' | 'teammates' | 'task' | 'review' | 'pending' | 'ready' | 'started' | 'paused'
type Message = { role: 'overlay' | 'user'; text: string }
const emptyProfile: OnboardingProfile = { name: '', about: '', daily: '', team: '' }
const initialMessages: Message[] = [{ role: 'overlay', text: `${ONBOARDING_INTRO}\n\nWhat should I call you?` }]

function App() {
  const [step, setStep] = useState<Step>('name')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [profile, setProfile] = useState<OnboardingProfile>(emptyProfile)
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [task, setTask] = useState('')
  const [checkout, setCheckout] = useState(false)
  const [canceled, setCanceled] = useState(false)
  const [preview, setPreview] = useState(false)
  const [connection, setConnection] = useState<string | null>(null)
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [dark, setDark] = useState(false)
  const [resume, setResume] = useState<Step>('name')
  const scroll = useRef<HTMLDivElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const typing = ['name', 'about', 'team', 'daily', 'task'].includes(step)
  const go = (next: Step, reply: string, answer?: string) => {
    setMessages(previous => [...previous, ...(answer ? [{ role: 'user' as const, text: answer }] : []), { role: 'overlay', text: reply }])
    setStep(next); setInput(''); setSelected(new Set())
  }
  const reset = () => {
    setMessages(initialMessages); setProfile(emptyProfile); setStep('name'); setInput(''); setSelected(new Set()); setTask(''); setConnected(new Set()); setCanceled(false); setCheckout(false); setPreview(false)
  }
  useEffect(() => {
    if (scroll.current && latest.current) {
      const container = scroll.current
      const top = latest.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTo({ top: Math.min(container.scrollHeight - container.clientHeight, top - 24), behavior: 'instant' })
    }
    if (typing) composer.current?.focus({ preventScroll: true })
  }, [messages, step, typing])
  useEffect(() => {
    if (step !== 'pending') return
    const timer = window.setTimeout(() => {
      setStep('ready')
      setMessages(previous => [...previous, { role: 'overlay', text: 'Your payment is confirmed. You have $8 in workspace credit.\n\nYour task is ready when you are.' }])
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [step])
  const afterContext = (answer: string) => profile.team === 'Just me'
    ? go('task', "Last thing. What's one task we can start on?", answer)
    : go('teammates', 'Want to bring in anyone you work with?', answer)
  const answer = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (step === 'name') { setProfile({ ...profile, name: value }); go('about', `Nice to meet you, ${value}.\n\nWhat kind of work do you do?`, value) }
    if (step === 'about') { setProfile({ ...profile, about: value }); go('team', 'Who do you work with?', value) }
    if (step === 'team') { setProfile({ ...profile, team: value }); go('daily', 'What would you like help with? Pick as many as you like.', value) }
    if (step === 'daily') { setProfile({ ...profile, daily: value }); go('employees', "Based on that, I'd start you with two AI employees. You can change them anytime.", value) }
    if (step === 'task') { setTask(value); setCanceled(false); go('review', "I've saved your first task. Subscribe to give your workspace a budget before we start.", value) }
  }
  const submit = () => answer(step === 'daily' ? [...selected, input.trim()].filter(Boolean).join(', ') : input)
  const toConnections = (answer: string) => go('connections', 'Want to connect the tools you already use?', answer)
  const taskCard = <div className="task-preview"><span>First task</span><p>{task}</p><div><OverlayMark size={16} />Overlay<span>Personal</span></div></div>

  function controls() {
    switch (step) {
      case 'name': return <><SingleChoices choices={['Divyansh']} disabled={false} onPick={answer} /><p className="hint">Set up your workspace first. Running tasks starts at $8/month.</p></>
      case 'about': return <SingleChoices choices={ONBOARDING_ROLES} disabled={false} onPick={answer} />
      case 'team': return <SingleChoices choices={ONBOARDING_TEAMS} disabled={false} onPick={answer} />
      case 'daily': return <MultiChoices choices={Object.keys(ONBOARDING_HELP_AREAS)} selected={selected} disabled={false} onToggle={label => setSelected(previous => { const next = new Set(previous); if (next.has(label)) next.delete(label); else next.add(label); return next })} onContinue={submit} />
      case 'employees': return <OnboardingEmployees suggested={onboardingEmployeesFor(profile)} disabled={false} onConfirm={employees => toConnections(`Add ${employees.map(employee => employee.name).join(' and ')}.`)} onSkip={() => toConnections('Not now.')} />
      case 'connections': return <>
        <div className="connections">{['Gmail', 'Slack', 'GitHub'].map(name => <div className="connection" key={name}><Link2 size={17} /><span>{name}</span><Button size="sm" variant="ghost" disabled={connected.has(name)} onClick={() => setConnection(name)}>{connected.has(name) ? <><Check size={13} />Connected</> : 'Connect'}</Button></div>)}</div>
        <p className="section-label">Bring your AI subscription</p>
        <div className="connection"><Link2 size={17} /><div><span>Codex</span><p>Use your ChatGPT subscription for eligible inference.</p></div><Button size="sm" variant="ghost" disabled={connected.has('Codex')} onClick={() => setConnection('Codex')}>{connected.has('Codex') ? 'Connected' : 'Connect'}</Button></div>
        <p className="hint">Optional. Overlay models work without a subscription connection. Computers and tools still use workspace credit.</p>
        <div className="actions"><Button variant="primary" size="sm" onClick={() => go('memories', 'Do you use another AI assistant? I can pick up what it already knows about your work.', connected.size ? `Continue with ${[...connected].join(', ')}.` : "I'll connect my tools later.")}>{connected.size ? 'Continue' : 'Set up later'}<ArrowRight size={14} /></Button></div>
      </>
      case 'memories': return <OnboardingContext disabled={false} onSave={() => afterContext('Save my context.')} onSkip={() => afterContext('Not now.')} />
      case 'teammates': return <OnboardingInvites disabled={false} onInvite={emails => go('task', "Last thing. What's one task we can start on?", `Invite ${emails.join(', ')}.`)} onSkip={() => go('task', "Last thing. What's one task we can start on?", 'Not now.')} />
      case 'task': return <SingleChoices choices={onboardingTasksFor(profile)} disabled={false} onPick={answer} />
      case 'review': return <>
        {taskCard}
        <div className="subscription-offer"><div className="offer-price"><b>$8</b><span>/ month</span></div><p>$8 in usage credit for models, computers and tools.</p><p className="hint">Renews monthly. Unused credit expires at renewal. Cancel in billing settings.</p></div>
        {canceled && <p className="payment-note" role="status">Checkout wasn’t completed. Your draft is saved.</p>}
        <div className="actions"><Button variant="primary" size="sm" onClick={() => setCheckout(true)}>Subscribe <ArrowRight size={14} /></Button><Button variant="ghost" size="sm" onClick={() => { go('task', 'What would you like to change?'); setInput(task) }}>Edit task</Button></div>
        <p className="hint">No trial. Payment won’t start your task automatically.</p>
      </>
      case 'pending': return <div className="payment-note" role="status"><OverlayMark size={22} motion="look" /><span>Confirming payment. Your task hasn’t started.</span></div>
      case 'ready': return <>{taskCard}<div className="actions"><Button variant="primary" size="sm" onClick={() => go('started', "Your first task is now in Work. I'll keep you updated there.", 'Start my task.')}><Play size={13} />Start task</Button></div><p className="hint">Usage is charged to your workspace budget.</p></>
      case 'started': return <div className="task-preview">{task}<p className="hint">In progress · Overlay</p><p className="preview-note">End of onboarding preview. No real task has run.</p><Button variant="ghost" size="sm" className="mt-3" onClick={reset}>Replay onboarding</Button></div>
      case 'paused': return <><p className="hint">Your setup is saved for this preview. A paid workspace is required before any task runs.</p><Button variant="primary" size="sm" className="mt-3" onClick={() => { setStep(resume); setMessages(previous => previous.slice(0, -1)) }}>Resume setup</Button></>
    }
  }

  return <div className="onboarding">
    <header className="top"><BrandLockup /><Button variant="ghost" size="sm" onClick={() => { if (step === 'paused') return; setResume(step); go('paused', 'You can finish setting up whenever you’re ready.') }} disabled={['pending', 'started'].includes(step)}>Finish later</Button></header>
    <div className="transcript-scroll" ref={scroll}><main className="transcript" aria-label="Onboarding conversation">
      {messages.map((message, index) => message.role === 'user'
        ? <div key={index} className="user-message"><div>{message.text}</div></div>
        : <div key={index} className="assistant-message" ref={index === messages.length - 1 ? latest : undefined}><OverlayMark size={28} /><div><div className="message-author">Overlay</div><div className="message-text">{message.text.split('\n\n').map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>{index === messages.length - 1 && <div className="reply" key={step}>{controls()}</div>}</div></div>)}
    </main></div>
    <div className="dock">{typing ? <form className="composer" onSubmit={event => { event.preventDefault(); submit() }}><Textarea ref={composer} rows={1} aria-label="Your answer" value={input} maxLength={3000} onChange={event => setInput(event.target.value)} placeholder={step === 'name' ? 'Your name' : step === 'task' ? 'Or describe a task' : 'Or tell me in your own words'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} /><Button variant="primary" size="icon-sm" type="submit" aria-label="Send answer" disabled={!input.trim() && !selected.size}><ArrowUp size={16} /></Button></form> : <div className="composer-placeholder" />}</div>
    <Button variant="ghost" size="xs" className="preview-toggle" onClick={() => setPreview(true)}>Preview</Button>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent><DialogTitle>Onboarding preview</DialogTitle><DialogDescription>This is a standalone prototype. No payments, invitations, saved memories or connections are real.</DialogDescription><div className="actions"><Button size="sm" onClick={reset}><RotateCcw size={14} />Restart</Button><Button size="sm" onClick={() => { setDark(!dark); document.documentElement.classList.toggle('dark', !dark) }}>{dark ? <Sun size={14} /> : <Moon size={14} />}{dark ? 'Light theme' : 'Dark theme'}</Button></div></DialogContent></Dialog>
    <Dialog open={checkout} onOpenChange={open => { setCheckout(open); if (!open) setCanceled(true) }}><DialogContent className="checkout-simulation"><CreditCard size={24} /><DialogTitle>Stripe checkout preview</DialogTitle><DialogDescription>Customers continue to secure Stripe checkout here. This prototype simulates the return without collecting card details.</DialogDescription><div className="checkout-summary"><span>Overlay workspace</span><strong>$8 / month</strong></div><Button variant="primary" onClick={() => { setCheckout(false); go('pending', 'Thanks. Let me confirm your payment.') }}>Simulate successful payment</Button><Button variant="ghost" onClick={() => { setCheckout(false); setCanceled(true) }}>Return without paying</Button></DialogContent></Dialog>
    <Dialog open={Boolean(connection)} onOpenChange={open => { if (!open) setConnection(null) }}><DialogContent><DialogTitle>Connect {connection}</DialogTitle><DialogDescription>In the app, this opens {connection === 'Codex' ? 'the supported subscription connection flow' : 'secure provider sign-in'}. No credentials are needed for this preview.</DialogDescription><Button variant="primary" onClick={() => { if (connection) setConnected(previous => new Set([...previous, connection])); setConnection(null) }}>Simulate connection</Button></DialogContent></Dialog>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
