'use client'

import { useState } from 'react'
import { Pin } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { AgentCreature } from '@/components/orb/Creature'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { agentsForCreatorScope } from '@/shared/agents/last-agent-by-workspace'
import { chiefRoleLabel, isPinnedChief, pinChiefs } from '@/shared/agents/chief-identity'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import { OrganizationAgentDetails } from './OrganizationAgentDetails'

type Agent = WorkspaceAgentDirectoryItem

/** One agent: a flat, fill-only card (no resting border). Selection tints the fill and adds a quiet ring. */
function AgentNode({ agent, owner, pinned, selected, detail, onSelect, className = '' }: {
  agent: Agent; owner: string; pinned: boolean; selected: boolean; detail?: string; onSelect(): void; className?: string
}) {
  const role = chiefRoleLabel(agent)
  return (
    <Button variant="ghost" type="button" onClick={onSelect} aria-pressed={selected}
      aria-label={`${agent.name}, ${owner}, ${role}`}
      className={unstyledButton(`flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-(--surface-muted) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border) ${selected ? 'bg-(--surface-muted) ring-1 ring-(--foreground)/15' : ''} ${className}`)}>
      <AgentCreature agent={agent} isDefault={agent.isDefault} size={30} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-medium text-(--foreground)">{agent.name}</span>{pinned ? <Pin size={11} className="shrink-0 text-(--muted-light)" aria-label="Pinned" /> : null}</span>
        <span className="mt-0.5 block truncate text-xs text-(--muted)">{detail ?? owner}</span>
      </span>
    </Button>
  )
}

export function OrganizationPage() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope()
  const href = useWorkspaceHref()
  const { capabilities, isLoading } = useOverlayCapabilities()
  const key = `${activeWorkspaceId}:${scope}`
  const directory = useAgentDirectory({ enabled: capabilities.work })
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null)
  const data = directory.workspaceId === activeWorkspaceId && directory.agents
    ? { agents: directory.agents, viewerPrincipalId: directory.viewerPrincipalId ?? undefined }
    : undefined
  const agents = pinChiefs(agentsForCreatorScope((data?.agents ?? []).filter(a => !a.archivedAt), data?.viewerPrincipalId, scope), data?.viewerPrincipalId)
  const root = agents.find(a => scope === 'workspace' ? a.agentRole === 'workspace_chief' : a.agentRole === 'personal_chief')
  const children = agents.filter(a => a.id !== root?.id)
  const selected = selection?.key === key ? agents.find(a => a.id === selection.id) : undefined
  const owner = (agent: Agent) => agent.agentRole === 'workspace_chief' ? activeWorkspace?.name || 'Workspace'
    : `${agent.createdByDisplayName || 'Member'}${agent.createdByPrincipalId === data?.viewerPrincipalId ? ' · You' : ''}`
  const node = (agent: Agent, detail?: string) => <AgentNode agent={agent} owner={owner(agent)} detail={detail} pinned={isPinnedChief(agent, data?.viewerPrincipalId)} selected={selected?.id === agent.id} onSelect={() => setSelection({ key, id: agent.id })} />
  return (
    <AppScreenShell
      header={<AppScreenHeader title="Organization" breadcrumbs={[{ label: 'Work', href: href(activeWorkspaceId, '/app/work', scope) }]} />}
      rightPanel={selected ? <OrganizationAgentDetails key={`${key}:${selected.id}`} agent={selected} owner={owner(selected)} onClose={() => setSelection(null)} /> : null}
      rightPanelOpen={Boolean(selected)} onRightPanelClose={() => setSelection(null)} rightPanelWidth={320} rightPanelOverlayLabel="Close agent details">
      <AppScreenBody padding="none" maxWidth="none" className="min-w-0 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center px-5 py-10 md:px-8">
          <h1 className="text-lg font-medium">{scope === 'workspace' ? activeWorkspace?.name || 'Workspace' : 'Your organization'}</h1>
          <p className="mt-2 text-center text-sm text-(--muted)">{scope === 'workspace' ? 'Workspace agents and member chiefs of staff.' : 'Your chief of staff and personal agents.'}</p>
          {!isLoading && !capabilities.work ? <p className="mt-12 text-sm text-(--muted)">Work is unavailable for this deployment.</p>
            : isLoading || directory.status === 'loading' ? <p role="status" className="mt-12 text-sm text-(--muted)">Loading organization...</p>
              : !data ? <div role="alert" className="mt-12 space-y-3 text-center"><p className="text-sm">Could not load organization.</p></div>
                : !root ? <p className="mt-12 text-sm text-(--muted)">No chief of staff is available in this scope.</p> : (
                  <section aria-label="Agent organization" className="mt-10 flex w-full flex-col items-center">
                    <div className="w-full max-w-xs rounded-2xl bg-(--surface-subtle) p-1.5">
                      {node(root, chiefRoleLabel(root))}
                    </div>
                    {children.length ? <>
                      <div aria-hidden className="h-6 w-px bg-(--border)" />
                      <ul aria-label={`Coordinated by ${root.name}`} className="grid w-full list-none grid-cols-1 gap-1 rounded-2xl bg-(--surface-subtle) p-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {children.map(agent => <li key={agent.id} className="min-w-0">{node(agent, agent.agentRole === 'personal_chief' ? `${chiefRoleLabel(agent)} · ${owner(agent)}` : undefined)}</li>)}
                      </ul>
                    </> : null}
                    <p className="mt-6 text-center text-xs text-(--muted-light)">
                      {scope === 'workspace' ? 'Shows coordination, not access. Personal agents and private threads stay private.' : 'Shows coordination, not access permissions.'}
                    </p>
                  </section>
                )}
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
