'use client'

import { useState, type ReactNode } from 'react'
import { Plug } from 'lucide-react'
import { Button, ListboxSelect, SegmentedControl } from '@overlay/ui/primitives'
import { SettingsGroup, SettingsToggle } from '@overlay/modules-react/settings'
import { ConnectedAppsSettings } from '@/features/settings/components/ConnectedAppsSettings'
import { slackOrigin } from './origin'

const SLACK_PATH = 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z'
const GITHUB_PATH = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'

/** Monochrome marks, so they sit in the app's muted chrome like Lucide icons do. */
export function SlackMark({ size = 12, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}><path d={SLACK_PATH} /></svg>
}

export function GitHubMark({ size = 12, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}><path d={GITHUB_PATH} /></svg>
}

/** Header subtitle of a thread that started in Slack. */
export function SlackOriginSubtitle({ conversationId }: { conversationId: string }) {
  const origin = slackOrigin(conversationId)
  if (!origin) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <SlackMark size={11} />
      {origin.kind === 'dm' ? 'Your Slack DM' : origin.channel}
      <span aria-hidden>·</span>
      <a href={origin.permalink} target="_blank" rel="noreferrer" className="hover:text-(--foreground) hover:underline">Open in Slack</a>
    </span>
  )
}

/** End-of-transcript note: where replies go and who else can see the thread. */
export function SlackThreadNote({ conversationId }: { conversationId: string }) {
  const origin = slackOrigin(conversationId)
  if (!origin) return null
  return (
    <p className="mx-auto mt-2 mb-1 flex max-w-3xl items-center justify-center gap-1.5 px-6 text-xs text-(--muted)">
      <SlackMark size={11} />
      {origin.kind === 'dm'
        ? 'Synced with your Slack DM. Only you can see this thread.'
        : `Synced with ${origin.channel}. Replies here are posted there as you, and members of ${origin.channel} can see this thread.`}
    </p>
  )
}

type AppId = 'github' | 'slack' | 'mcp'

const APP_OPTIONS = [
  { value: 'github' as const, label: 'GitHub', icon: GitHubMark },
  { value: 'slack' as const, label: 'Slack', icon: SlackMark },
  { value: 'mcp' as const, label: 'MCP', icon: Plug },
]

/** Settings → Connected apps: one tab per first-class integration. */
export function ConnectedAppsHub() {
  const [app, setApp] = useState<AppId>('slack')
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl ariaLabel="Connected app" value={app} options={APP_OPTIONS} onChange={setApp} />
        <span className="text-xs text-(--muted)">Microsoft Teams, Discord and Linear are coming soon</span>
      </div>
      {app === 'github' ? <GitHubSection /> : app === 'slack' ? <SlackSection /> : <ConnectedAppsSettings />}
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">{title}</h3>
        {description ? <p className="mt-1 text-sm text-(--muted)">{description}</p> : null}
      </div>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}

function Row({ icon, title, description, control }: { icon?: ReactNode; title: string; description?: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--surface-subtle) text-(--foreground)">{icon}</span> : null}
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-(--foreground)">{title}</h4>
          {description ? <p className="mt-0.5 text-sm leading-relaxed text-(--muted)">{description}</p> : null}
        </div>
      </div>
      {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
    </div>
  )
}

function ToggleRow({ title, description, initial }: { title: string; description: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  return <Row title={title} description={description} control={<SettingsToggle checked={on} onChange={() => setOn(!on)} aria-label={title} />} />
}

function SlackSection() {
  const [who, setWho] = useState<'linked' | 'everyone' | 'allowlist'>('linked')
  const [unlinked, setUnlinked] = useState<'link' | 'channel'>('link')
  const [actions, setActions] = useState<'approve' | 'auto' | 'never'>('approve')
  return (
    <>
      <Section title="Workspace">
        <Row
          icon={<SlackMark size={16} />}
          title="Northwind"
          description="northwind.slack.com · Installed by Mercedes Alvarez"
          control={<Button variant="secondary" size="sm">Disconnect</Button>}
        />
        <Row
          title="Your Slack account"
          description="Linked as @mercedes. Overlay knows it's you when you ask in Slack."
          control={<Button variant="ghost" size="sm">Unlink</Button>}
        />
      </Section>

      <Section title="Who can ask Overlay" description="Only Overlay answers in Slack. It brings in your other agents when a task needs them.">
        <Row
          title="People"
          description={who === 'linked' ? 'Only people who have linked their Slack account to this workspace.' : who === 'everyone' ? 'Anyone in Northwind\u2019s Slack, except people you block.' : 'Only the people you add.'}
          control={<ListboxSelect aria-label="Who can ask Overlay" className="w-48" value={who} onChange={setWho} options={[
            { value: 'linked', label: 'Linked members only' },
            { value: 'everyone', label: 'Everyone except blocked' },
            { value: 'allowlist', label: 'Only allowed people' },
          ]} />}
        />
        {who === 'linked' ? null : (
          <Row
            title="People without an Overlay account"
            description={unlinked === 'link' ? 'Overlay asks them to link first, then finishes their request.' : 'They can use what the channel can see. No workspace files, memories or actions.'}
            control={<ListboxSelect aria-label="People without an Overlay account" className="w-48" value={unlinked} onChange={setUnlinked} options={[
              { value: 'link', label: 'Ask them to link' },
              { value: 'channel', label: 'Channel access only' },
            ]} />}
          />
        )}
        <ToggleRow title="Slack guests" description="Let single- and multi-channel guests ask Overlay." initial={false} />
        <ToggleRow title="Slack Connect channels" description="Answer people from other companies in shared channels." initial={false} />
      </Section>

      <Section title="Answers and actions">
        <Row
          title="Private results stay private"
          description="If an answer uses something not everyone in the channel can see, only the person who asked gets it."
          control={<span className="text-xs text-(--muted)">Always on</span>}
        />
        <Row
          title="Actions in channels"
          description="Sending email, editing files, changing Work and other tools that make changes."
          control={<ListboxSelect aria-label="Actions in channels" className="w-48" value={actions} onChange={setActions} options={[
            { value: 'approve', label: 'Ask before acting' },
            { value: 'auto', label: 'Act without asking' },
            { value: 'never', label: 'Never act' },
          ]} />}
        />
      </Section>

      <Section title="Channels" description="Each Slack thread Overlay works in appears in Overlay's thread list for the people who can see it in Slack.">
        <Row title="#growth" description="Public · 14 threads · Members of #growth" />
        <Row title="#launch" description="Public · 6 threads · Members of #launch" />
        <Row title="#exec" description="Private · 2 threads · Members of #exec" />
        <Row title="Direct messages" description="Each person sees only their own" />
      </Section>
    </>
  )
}

function GitHubSection() {
  return (
    <>
      <Section title="Installations" description="Agents clone these repositories on their cloud computer and open pull requests as the Overlay app.">
        <Row
          icon={<GitHubMark size={16} />}
          title="northwind"
          description="Organization · 12 repositories · Installed by Mercedes Alvarez"
          control={<Button variant="secondary" size="sm">Configure</Button>}
        />
        <Row
          icon={<GitHubMark size={16} />}
          title="mercedes-alvarez"
          description="Personal account · 3 repositories"
          control={<Button variant="secondary" size="sm">Configure</Button>}
        />
      </Section>
      <div className="flex gap-2 px-1">
        <Button variant="secondary" size="sm">Install on GitHub</Button>
        <Button variant="ghost" size="sm">Connect an existing installation</Button>
      </div>
    </>
  )
}
