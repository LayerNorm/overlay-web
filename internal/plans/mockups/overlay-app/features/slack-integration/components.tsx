'use client'

import { useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, ChevronRight, MessageSquareMore, Plug, ShieldCheck, UserRound, UserRoundPlus, UserRoundX, UsersRound } from 'lucide-react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, ListboxSelect } from '@overlay/ui/primitives'
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

const CONNECTED_APPS = [
  { id: 'github', label: 'GitHub', description: 'Repositories your agents can work on', status: '2 accounts', icon: <GitHubMark size={14} /> },
  { id: 'slack', label: 'Slack', description: 'Ask Overlay in your Slack workspace', status: 'Connected', icon: <SlackMark size={14} /> },
  { id: 'mcp', label: 'MCP', description: 'Use Overlay from ChatGPT, Claude and Cursor', status: '2 apps', icon: <Plug size={15} /> },
] as const

const LIST_HREF = '/app/settings?section=connected-apps'

/** Header trail for Settings → Connected apps → <app>; null on the list itself. */
export function connectedAppHeader(section: string, app: string | null | undefined) {
  if (section !== 'connected-apps') return null
  const match = CONNECTED_APPS.find((entry) => entry.id === app)
  return match ? { label: match.label, parents: [{ label: 'Connected apps', href: LIST_HREF }] } : null
}

/** Settings → Connected apps: the list, or one app's page when ?app= is set. */
export function ConnectedAppsHub() {
  const app = useSearchParams()?.get('app')
  if (app === 'github') return <GitHubSettings />
  if (app === 'slack') return <SlackSettings />
  if (app === 'mcp') return <ConnectedAppsSettings />
  return <ConnectedAppsList />
}

function ConnectedAppsList() {
  const router = useRouter()
  return (
    <SettingsGroup>
      {CONNECTED_APPS.map((app) => (
        <Button
          key={app.id}
          variant="ghost"
          type="button"
          onClick={() => router.push(`${LIST_HREF}&app=${app.id}`)}
          className={unstyledButton('flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-(--surface-muted)')}
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex w-4 shrink-0 justify-center text-(--muted)">{app.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-(--foreground)">{app.label}</span>
              <span className="mt-1 block text-sm text-(--muted)">{app.description}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-sm text-(--muted)">
            {app.status}
            <ChevronRight size={14} />
          </span>
        </Button>
      ))}
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <span className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex w-4 shrink-0 justify-center text-(--muted)"><MessageSquareMore size={15} /></span>
          <span className="text-sm text-(--muted)">Microsoft Teams, Discord and more</span>
        </span>
        <span className="shrink-0 text-sm text-(--muted)">Coming soon</span>
      </div>
    </SettingsGroup>
  )
}

function Row({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-(--surface-muted)">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex w-4 shrink-0 justify-center text-(--muted)">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-(--foreground)">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-(--muted)">{description}</p>
        </div>
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

function ToggleRow({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  const [on, setOn] = useState(false)
  return <Row icon={icon} title={title} description={description}><SettingsToggle checked={on} onChange={() => setOn(!on)} aria-label={title} /></Row>
}

function SlackSettings() {
  const [who, setWho] = useState<'linked' | 'everyone' | 'specific'>('linked')
  const [unlinked, setUnlinked] = useState<'link' | 'channel'>('link')
  const [actions, setActions] = useState<'ask' | 'allow' | 'never'>('ask')
  return (
    <>
      <SettingsGroup>
        <Row icon={<SlackMark size={14} />} title="Northwind" description="Connected by Mercedes Alvarez">
          <Button variant="secondary" size="sm">Disconnect</Button>
        </Row>
        <Row icon={<UserRound size={15} />} title="Your account" description="Linked as @mercedes">
          <Button variant="ghost" size="sm">Unlink</Button>
        </Row>
      </SettingsGroup>
      <SettingsGroup>
        <Row icon={<UsersRound size={15} />} title="Who can ask Overlay" description="People who can mention or message Overlay in Slack.">
          <ListboxSelect aria-label="Who can ask Overlay" className="w-44" value={who} onChange={setWho} options={[
            { value: 'linked', label: 'Linked members' },
            { value: 'everyone', label: 'Everyone' },
            { value: 'specific', label: 'Specific people' },
          ]} />
        </Row>
        {who === 'linked' ? null : (
          <Row icon={<UserRoundX size={15} />} title="People without an account" description="What Overlay does when they ask.">
            <ListboxSelect aria-label="People without an account" className="w-44" value={unlinked} onChange={setUnlinked} options={[
              { value: 'link', label: 'Ask them to link' },
              { value: 'channel', label: 'Channel only' },
            ]} />
          </Row>
        )}
        <ToggleRow icon={<UserRoundPlus size={15} />} title="Guests" description="Let Slack guests ask Overlay." />
        <ToggleRow icon={<Building2 size={15} />} title="Slack Connect" description="Answer people from other companies in shared channels." />
        <Row icon={<ShieldCheck size={15} />} title="Actions in channels" description="Sending, editing or deleting for someone.">
          <ListboxSelect aria-label="Actions in channels" className="w-44" value={actions} onChange={setActions} options={[
            { value: 'ask', label: 'Ask first' },
            { value: 'allow', label: 'Allow' },
            { value: 'never', label: 'Never' },
          ]} />
        </Row>
      </SettingsGroup>
    </>
  )
}

function GitHubSettings() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-(--muted)">Repositories your agents can clone and open pull requests on.</p>
        <Button variant="secondary" size="sm">Install on GitHub</Button>
      </div>
      <SettingsGroup>
        <Row icon={<GitHubMark size={14} />} title="northwind" description="Organization · 12 repositories">
          <Button variant="secondary" size="sm">Configure</Button>
        </Row>
        <Row icon={<GitHubMark size={14} />} title="mercedes-alvarez" description="Personal · 3 repositories">
          <Button variant="secondary" size="sm">Configure</Button>
        </Row>
      </SettingsGroup>
    </>
  )
}
