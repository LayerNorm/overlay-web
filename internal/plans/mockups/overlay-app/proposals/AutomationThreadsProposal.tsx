import { useState, type ReactNode } from 'react'
import { CalendarClock, Check, CircleAlert, ExternalLink, Loader2, Mail, MessageSquare, Plug, Sparkles } from 'lucide-react'
import { Badge, Button, SegmentedControl } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'

type View = 'connector' | 'automation'
type ConnectStep = 'idle' | 'waiting' | 'provider' | 'connected'

const CONNECT_STEPS: { value: ConnectStep; label: string }[] = [
  { value: 'idle', label: '1. Click Connect' },
  { value: 'waiting', label: '2. Sign in' },
  { value: 'provider', label: '3. Provider returns' },
  { value: 'connected', label: '4. Back in place' },
]

const AGENT = { name: 'Inbox', avatarColor: '#7c8db5', avatarShape: 'blob' }

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-(--muted)">{label}</p>
      <div className="min-h-[300px] rounded-xl border border-(--border) bg-(--background) p-4">{children}</div>
    </div>
  )
}

function ConnectorRow({ step }: { step: ConnectStep }) {
  const waiting = step === 'waiting' || step === 'provider'
  return (
    <div className="flex items-center gap-3 rounded-lg border border-(--border) px-3 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-(--surface-subtle)"><Mail size={16} strokeWidth={1.5} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-(--foreground)">Gmail</p>
        <p className="text-xs text-(--muted)">
          {step === 'connected' ? 'Connected just now' : waiting ? 'Finish signing in in the other tab' : 'Read, search and draft email'}
        </p>
      </div>
      {step === 'connected' ? (
        <Badge variant="success"><Check size={12} strokeWidth={2} /> Connected</Badge>
      ) : waiting ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs"><ExternalLink size={12} strokeWidth={1.5} /> Reopen</Button>
          <Button variant="outline" size="sm" disabled><Loader2 size={12} className="animate-spin" /> Waiting</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm">Connect</Button>
      )}
    </div>
  )
}

function ConnectorStory() {
  const [step, setStep] = useState<ConnectStep>('waiting')
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl value={step} options={CONNECT_STEPS} onChange={setStep} ariaLabel="Connector step" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <Frame label="Original tab · Connectors or onboarding">
          <div className="flex flex-col gap-2">
            <ConnectorRow step={step} />
            <div className="flex items-center gap-3 rounded-lg border border-(--border) px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-(--surface-subtle)"><Plug size={16} strokeWidth={1.5} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-(--foreground)">Slack</p>
                <p className="text-xs text-(--muted)">Read and post in channels</p>
              </div>
              <Button variant="outline" size="sm">Connect</Button>
            </div>
            {step === 'connected' ? (
              <div className="mt-3 flex items-center gap-2 self-end rounded-lg border border-(--border) bg-(--surface-subtle) px-3 py-2 text-xs text-(--foreground)">
                <Check size={14} strokeWidth={2} /> Gmail connected
              </div>
            ) : null}
          </div>
        </Frame>
        <Frame label="Second tab · opened by Connect">
          {step === 'idle' ? (
            <p className="text-xs text-(--muted)">Not open yet.</p>
          ) : step === 'waiting' ? (
            <div className="flex flex-col gap-2 text-xs text-(--muted)">
              <p className="text-sm text-(--foreground)">accounts.google.com</p>
              <p>Choose an account to continue to Overlay.</p>
            </div>
          ) : step === 'provider' ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Check size={20} strokeWidth={1.75} />
              <p className="text-sm text-(--foreground)">Gmail connected</p>
              <p className="max-w-[240px] text-xs text-(--muted)">Returning you to Overlay. This tab closes on its own.</p>
              <p className="mt-3 max-w-[240px] text-[11px] text-(--muted)">Lightweight static page outside the app shell, so it can never hang on loading.</p>
            </div>
          ) : (
            <p className="text-xs text-(--muted)">Closed. The original tab updated in place.</p>
          )}
        </Frame>
      </div>
    </div>
  )
}

function ProgressRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-(--muted)">
      <Check size={13} strokeWidth={1.75} />
      <span>{text}</span>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-(--muted)">{label}</p>
      <p className="text-[13px] text-(--foreground)">{value}</p>
    </div>
  )
}

function AutomationStory() {
  const [origin, setOrigin] = useState<'agent' | 'chat'>('agent')
  const agent = origin === 'agent'
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl
        value={origin}
        options={[
          { value: 'agent', label: 'Made in an agent', icon: Sparkles },
          { value: 'chat', label: 'Made in chat or Automations', icon: MessageSquare },
        ]}
        onChange={setOrigin}
        ariaLabel="Automation origin"
      />
      <div className="flex flex-col gap-4 lg:flex-row">
        <Frame label={agent ? 'Agents › Inbox › Morning triage' : 'Chats › Morning triage'}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              {agent ? <AgentCreature agent={AGENT} size={22} /> : <MessageSquare size={16} strokeWidth={1.5} />}
              <p className="flex-1 text-sm font-medium text-(--foreground)">Morning triage</p>
              <Badge variant="warning"><CircleAlert size={12} strokeWidth={2} /> Needs you</Badge>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1 text-[11px] text-(--muted)"><CalendarClock size={12} strokeWidth={1.5} /> Scheduled · Today 9:00 AM</span>
              <div className="max-w-[85%] rounded-xl bg-(--surface-subtle) px-3 py-2 text-[13px] text-(--foreground)">
                Triage my inbox. Archive newsletters, draft replies to customers, and flag anything that needs me.
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <ProgressRow text="Read 23 new emails" />
              <ProgressRow text="Archived 14 newsletters" />
              <ProgressRow text="Drafted 3 customer replies" />
            </div>
            <p className="text-[13px] leading-relaxed text-(--foreground)">
              Two drafts promise a delivery date, so I held them. Approve to send, or tell me what to change.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm">Approve and send</Button>
              <Button variant="outline" size="sm">Review drafts</Button>
            </div>
          </div>
        </Frame>
        <Frame label="What the run is">
          <div className="flex flex-col gap-3">
            <Fact label="Thread" value={agent ? 'An agent thread owned by Inbox' : 'An ordinary chat thread'} />
            <Fact label="System prompt" value={agent ? "Inbox's persona, instructions, tools and memory" : 'The standard chat system prompt'} />
            <Fact label="At each scheduled time" value="Post the saved instructions as a user message, then run the same turn the composer runs." />
            <Fact label="Status" value="Working, then Ready to review, or Needs you when it asks a question. Shown on the thread row." />
            <div className="mt-1 flex flex-col gap-1 border-t border-(--border) pt-3 text-xs text-(--muted)">
              <span>Daily at 9:00 AM · next run tomorrow</span>
              <span>Earlier runs live higher up in this same thread</span>
            </div>
          </div>
        </Frame>
      </div>
    </div>
  )
}

export default function AutomationThreadsProposal() {
  const [view, setView] = useState<View>('connector')
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium text-(--foreground)">Connector return and automation threads</h1>
        <p className="text-sm text-(--muted)">Proposal mockup. Interactions are simulated.</p>
      </div>
      <SegmentedControl
        value={view}
        options={[
          { value: 'connector', label: 'Connector return', icon: Plug },
          { value: 'automation', label: 'Automation as a thread', icon: CalendarClock },
        ]}
        onChange={setView}
        ariaLabel="Proposal"
      />
      {view === 'connector' ? <ConnectorStory /> : <AutomationStory />}
    </div>
  )
}
