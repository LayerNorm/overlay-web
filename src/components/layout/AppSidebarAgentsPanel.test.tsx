import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ directory: vi.fn(), mutate: vi.fn() }))
vi.mock('@/hooks/use-agent-directory', () => ({ useAgentDirectory: mocks.directory }))
vi.mock('@/hooks/use-solo-workspace', () => ({ useIsSoloWorkspace: () => true }))
vi.mock('@/hooks/use-workspace-href', () => ({ useWorkspaceHref: () => (_id: string | null, path: string) => path }))
vi.mock('@/contexts/WorkspaceContext', () => ({ useOptionalWorkspace: () => null }))
vi.mock('@/components/orb/Creature', () => ({ AgentCreature: () => null }))
vi.mock('@/shared/app/archive-toast', () => ({ announceArchived: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/agents',
  useSearchParams: () => null,
}))
vi.mock('@overlay/ui/primitives', () => ({
  SidebarMenu: 'ul', SidebarMenuItem: 'li', SidebarMenuSkeleton: 'span',
  SidebarMenuButton: 'button', SidebarMenuAction: 'button', Button: 'button', toast: { error: vi.fn() },
}))
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => mocks.mutate,
  useQueries(queries: Record<string, unknown>) {
    // Convex useSubscription schedules a render-phase update when its query object changes.
    const [previous, setPrevious] = React.useState(queries)
    if (previous !== queries) setPrevious(queries)
    return {}
  },
}))

import { AgentsInlinePanel } from './AppSidebarAgentsPanel'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
  }
}

afterEach(() => vi.unstubAllGlobals())

test('loading, unavailable directories and workspace switches settle without a render loop in either activity mode', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', new EventTarget())
  mocks.directory.mockImplementation(() => ({ agents: null, status: 'loading', viewerPrincipalId: null }))
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<AgentsInlinePanel workspaceId={null} />) })
    await act(() => renderer.update(<AgentsInlinePanel workspaceId="workspace_1" />))
    await act(() => renderer.update(<AgentsInlinePanel workspaceId="workspace_1" />))
    await act(() => renderer.update(<AgentsInlinePanel workspaceId="workspace_1" activityOnly />))
    mocks.directory.mockImplementation(() => ({ agents: [], status: 'unavailable', viewerPrincipalId: null }))
    await act(() => renderer.update(<AgentsInlinePanel workspaceId="workspace_1" activityOnly />))
    expect(JSON.stringify(renderer.toJSON())).toContain('No activity yet')
    await act(() => renderer.update(<AgentsInlinePanel workspaceId="workspace_2" />))
    expect(JSON.stringify(renderer.toJSON())).toContain('No agents yet')
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})
