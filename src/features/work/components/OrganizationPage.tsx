'use client'

import { useEffect, useState } from 'react'
import { LockKeyhole, Pin } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem, WorkspaceAgentListResponse } from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { agentsForCreatorScope } from '@/shared/agents/last-agent-by-workspace'
import { chiefRoleLabel, isPinnedChief, pinChiefs } from '@/shared/agents/chief-identity'
import { AGENT_DIRECTORY_CHANGED_EVENT } from '@/shared/workspace/sidebar-events'
import { OrganizationAgentDetails } from './OrganizationAgentDetails'
import { AgentDirectoryProvider, useAgentDirectory } from '@/features/agents/components/AgentDirectoryProvider'

type Agent = WorkspaceAgentDirectoryItem & { revision?: string }

function AgentNode({ agent, owner, pinned, selected, onSelect }: {
  agent: Agent; owner: string; pinned: boolean; selected: boolean; onSelect(): void
}) {
  return (
    <Button variant="outline" onClick={onSelect} aria-pressed={selected}
      aria-label={`${agent.name}, ${owner}, ${chiefRoleLabel(agent)}`}
      className={`h-auto min-h-24 w-60 max-w-full justify-start gap-3 whitespace-normal rounded-xl p-4 text-left shadow-none ${selected ? 'border-(--foreground)' : 'border-(--border)'} bg-(--background)`}>
      <AgentCreature agent={agent} isDefault={agent.isDefault} size={34} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{agent.name}</span>{pinned ? <Pin size={12} className="shrink-0 text-(--muted)" aria-label="Pinned" /> : null}</span>
        <span className="block truncate text-xs font-normal text-(--muted)">{owner}</span>
        <span className="block text-[11px] font-normal text-(--muted)">{chiefRoleLabel(agent)}</span>
      </span>
    </Button>
  )
}

export function OrganizationPage() {
  return (
    <AgentDirectoryProvider>
      <OrganizationPageScope />
    </AgentDirectoryProvider>
  )
}

function OrganizationPageScope() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const native = useAgentDirectory()
  const scope = usePanelScope()
  const href = useWorkspaceHref()
  const { capabilities, isLoading } = useOverlayCapabilities()
  const key = `${activeWorkspaceId}:${scope}`
  const [state, setState] = useState<{ key: string; data?: WorkspaceAgentListResponse; error?: boolean }>({ key: '' })
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null)
  useEffect(() => {
    if (native.mode !== 'legacy') return
    if (!activeWorkspaceId || !capabilities.work) return
    let live = true
    void overlayAppClient.agents.list(activeWorkspaceId).then(
      data => { if (live) setState({ key, data }) },
      () => { if (live) setState({ key, error: true }) },
    )
    return () => { live = false }
  }, [activeWorkspaceId, capabilities.work, key, native.mode, revision])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refresh)
  }, [])
  const legacyData = state.key === key ? state.data : undefined
  const data = native.mode === 'native'
    ? { agents: native.directory ?? [], viewerPrincipalId: native.viewerPrincipalId }
    : native.mode === 'legacy' ? legacyData : undefined
  const loadError = native.mode === 'unavailable'
    ? !native.loading
    : native.mode === 'legacy' && state.key === key && state.error
  const directoryLoading = native.mode === 'native' || native.mode === 'unavailable'
    ? native.loading
    : !legacyData && !loadError
  const agents = pinChiefs(agentsForCreatorScope((data?.agents ?? []).filter(a => !a.archivedAt), data?.viewerPrincipalId, scope), data?.viewerPrincipalId)
  const root = agents.find(a => scope === 'workspace' ? a.agentRole === 'workspace_chief' : a.agentRole === 'personal_chief')
  const children = agents.filter(a => a.id !== root?.id)
  const selected = selection?.key === key ? agents.find(a => a.id === selection.id) : undefined
  const owner = (agent: Agent) => agent.agentRole === 'workspace_chief' ? activeWorkspace?.name || 'Workspace'
    : `${agent.createdByDisplayName || 'Member'}${agent.createdByPrincipalId === data?.viewerPrincipalId ? ' · You' : ''}`
  const node = (agent: Agent) => <AgentNode agent={agent} owner={owner(agent)} pinned={isPinnedChief(agent, data?.viewerPrincipalId)} selected={selected?.id === agent.id} onSelect={() => setSelection({ key, id: agent.id })} />
  return (
    <AppScreenShell
      header={<AppScreenHeader title="Organization" breadcrumbs={[{ label: 'Work', href: href(activeWorkspaceId, '/app/work', scope) }]} />}
      rightPanel={selected ? <OrganizationAgentDetails key={`${key}:${selected.id}`} agent={selected} owner={owner(selected)} onClose={() => setSelection(null)} /> : null}
      rightPanelOpen={Boolean(selected)} onRightPanelClose={() => setSelection(null)} rightPanelWidth={320} rightPanelOverlayLabel="Close agent details">
      <AppScreenBody padding="none" maxWidth="none" className="min-w-0 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center px-5 py-10 md:px-8">
          <h1 className="text-lg font-medium">{scope === 'workspace' ? activeWorkspace?.name || 'Workspace' : 'Your organization'}</h1>
          <p className="mt-2 text-center text-sm text-(--muted)">{scope === 'workspace' ? 'Workspace agents and member chiefs of staff.' : 'Your chief of staff and personal agents.'}</p>
          {!isLoading && !capabilities.work ? <p className="mt-12 text-sm text-(--muted)">Work is unavailable for this deployment.</p>
            : isLoading || directoryLoading ? <p role="status" className="mt-12 text-sm text-(--muted)">Loading organization...</p>
              : loadError ? <div role="alert" className="mt-12 space-y-3 text-center"><p className="text-sm">Could not load organization.</p><Button variant="secondary" onClick={() => native.mode === 'legacy' ? setRevision(n => n + 1) : native.retry()}>Try again</Button></div>
                : !root ? <p className="mt-12 text-sm text-(--muted)">No chief of staff is available in this scope.</p> : (
                  <section aria-label="Agent organization" className="mt-10 flex w-full flex-col items-center">
                    {node(root)}
                    {children.length ? <><div aria-hidden className="h-9 border-l border-(--border)" /><ul className="grid w-full list-none grid-cols-1 justify-items-center gap-x-6 gap-y-5 border-t border-(--border) sm:grid-cols-2 lg:grid-cols-3">
                      {children.map(agent => <li key={agent.id} className="flex w-full min-w-0 flex-col items-center"><div aria-hidden className="h-7 border-l border-(--border)" />{node(agent)}{scope === 'workspace' && agent.agentRole === 'personal_chief' ? <span className="mt-3 flex items-center gap-1.5 text-[11px] text-(--muted)"><LockKeyhole size={12} />Personal agents are private</span> : null}</li>)}
                    </ul></> : null}
                    <p className="mt-10 text-center text-xs text-(--muted)">Lines show coordination, not access permissions.</p>
                    {scope === 'workspace' ? <p className="mt-2 text-center text-xs text-(--muted)">Private agent profiles and threads are not exposed here.</p> : null}
                  </section>
                )}
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
