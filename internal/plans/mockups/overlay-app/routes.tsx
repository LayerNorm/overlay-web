import { Suspense, type ComponentType, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { splitHref, useHref } from './shims/router'
import { MOCK_USER } from './fixtures/data'
import { readWorkspaceRouteDescriptor } from '@/shared/workspaces/routing'

const WorkPage = dynamic(() => import('@/features/work/components/WorkPage').then((m) => m.WorkPage))
const OrganizationPage = dynamic(() => import('@/features/work/components/OrganizationPage').then((m) => m.OrganizationPage))
const AgentConversationWorkspace = dynamic(() => import('@/features/agents/components/AgentConversationWorkspace').then((m) => m.AgentConversationWorkspace))
const AgentEditorPage = dynamic(() => import('@/features/agents/components/AgentEditorPage').then((m) => m.AgentEditorPage))
const ChatRouteClient = dynamic(() => import('@/app/app/_components/ClientSessionRoutes').then((m) => m.ChatRouteClient))
const ActivityRouteClient = dynamic(() => import('@/app/app/_components/ClientSessionRoutes').then((m) => m.ActivityRouteClient))
const NotesRouteClient = dynamic(() => import('@/app/app/_components/ClientSessionRoutes').then((m) => m.NotesRouteClient))
const ToolsRouteClient = dynamic(() => import('@/app/app/_components/ClientSessionRoutes').then((m) => m.ToolsRouteClient))
const KnowledgeViewHost = dynamic(() => import('@/app/app/_components/KnowledgeViewHost'))
const IntegrationsView = dynamic(() => import('@/features/integrations/components/IntegrationsView'))
const SettingsPage = dynamic(() => import('@/app/app/settings/page'))
const AccountPage = dynamic(() => import('@/app/app/account/account-content'))

function appPath(pathname: string): string {
  const route = readWorkspaceRouteDescriptor(pathname)
  return route ? '/app/' + [route.surface, ...route.suffix].join('/') : pathname
}

function render(pathname: string): ReactNode {
  if (pathname === '/app/work') return <WorkPage fallback={null} />
  if (pathname === '/app/work/organization') return <OrganizationPage />
  if (pathname === '/app/agents') return <AgentConversationWorkspace />
  if (pathname === '/app/agents/new') return <AgentEditorPage mode="new" />
  const agent = pathname.match(/^\/app\/agents\/([^/]+)$/)
  if (agent) return <AgentEditorPage mode="edit" agentId={decodeURIComponent(agent[1])} />
  if (pathname === '/app/chat') return <ChatRouteClient />
  if (pathname === '/app/automations') return <ChatRouteClient mode="automate" />
  if (pathname === '/app/activity') return <ActivityRouteClient />
  if (pathname === '/app/notes') return <NotesRouteClient />
  if (pathname === '/app/tools') return <ToolsRouteClient />
  if (pathname === '/app/files') return <KnowledgeViewHost userId={MOCK_USER.id} mode="files" />
  if (pathname === '/app/integrations') return <IntegrationsView userId={MOCK_USER.id} />
  if (pathname === '/app/settings') return <SettingsPage />
  if (pathname === '/app/account') return <AccountPage />
  return <div className="p-8 text-sm text-(--muted)">This mockup has no screen for {pathname}.</div>
}

export function RouteOutlet({ ErrorBoundary }: { ErrorBoundary: ComponentType<{ children: ReactNode; route: string }> }) {
  const href = useHref()
  const { pathname } = splitHref(href)
  return (
    <ErrorBoundary route={href}>
      <Suspense fallback={null}>{render(appPath(pathname))}</Suspense>
    </ErrorBoundary>
  )
}
