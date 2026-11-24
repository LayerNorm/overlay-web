'use client'

import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConvexAuth, useQuery } from 'convex/react'
import { ChevronRight, MessageSquareMore, Plug } from 'lucide-react'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { SettingsGroup } from '@overlay/modules-react/settings'
import { GitHubMark, SlackMark } from '@/components/brand/AppMarks'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useLiveMcpConnections } from '@/hooks/use-connections'
import { ConnectedAppsSettings } from '../ConnectedAppsSettings'
import { GitHubSettings } from './GitHubSettings'
import { SlackSettings } from './SlackSettings'
import { api } from '../../../../../convex/_generated/api'

export const CONNECTED_APPS_HREF = '/app/settings?section=connected-apps'

const APPS = [
  { id: 'github', label: 'GitHub' },
  { id: 'slack', label: 'Slack' },
  { id: 'mcp', label: 'MCP' },
] as const

/** Header trail for Settings › Connected apps › <app>; null on the list itself. */
export function connectedAppHeader(section: string, app: string | null | undefined) {
  if (section !== 'connected-apps') return null
  const match = APPS.find((entry) => entry.id === app)
  return match ? { label: match.label, parents: [{ label: 'Connected apps', href: CONNECTED_APPS_HREF }] } : null
}

/** Settings › Connected apps: the list of apps, or one app's page when ?app= is set. */
export function ConnectedAppsHub() {
  const app = useSearchParams()?.get('app')
  if (app === 'github') return <GitHubSettings />
  if (app === 'slack') return <SlackSettings />
  if (app === 'mcp') return <ConnectedAppsSettings />
  return <ConnectedAppsList />
}

const plural = (count: number, one: string, many: string) => count + ' ' + (count === 1 ? one : many)

function ConnectedAppsList() {
  const router = useRouter()
  const { activeWorkspaceId } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const args = activeWorkspaceId && isAuthenticated && !isLoading ? { workspaceId: activeWorkspaceId } : 'skip'
  const github = useQuery(api.integrations.githubInstallations.list, args)
  const slack = useQuery(api.integrations.slack.status, args)
  const mcp = useLiveMcpConnections()
  const rows: Array<{ id: string; label: string; description: string; status: string; icon: ReactNode }> = [
    {
      id: 'github', label: 'GitHub', description: 'Repositories your agents can work on', icon: <GitHubMark size={14} />,
      status: github === undefined ? '' : github.length ? plural(github.length, 'account', 'accounts') : 'Not connected',
    },
    {
      id: 'slack', label: 'Slack', description: 'Ask Overlay in your Slack workspace', icon: <SlackMark size={14} />,
      status: slack === undefined ? '' : slack?.installation ? 'Connected' : 'Not connected',
    },
    {
      id: 'mcp', label: 'MCP', description: 'Use Overlay from ChatGPT, Claude and Cursor', icon: <Plug size={15} />,
      status: mcp === undefined ? '' : mcp?.length ? plural(mcp.length, 'app', 'apps') : 'Not connected',
    },
  ]
  return (
    <SettingsGroup>
      {rows.map((app) => (
        <Button
          key={app.id}
          variant="ghost"
          type="button"
          onClick={() => router.push(CONNECTED_APPS_HREF + '&app=' + app.id)}
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
