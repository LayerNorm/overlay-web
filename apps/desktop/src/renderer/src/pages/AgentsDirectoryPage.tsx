import { useMemo } from 'react'
import { Bot, Loader2, Plus, Trash2 } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { useEnvironments } from '../contexts/EnvironmentContext'
import {
  deriveDisplayStatus,
  harnessLabel,
  workspaceAgentUsesByo,
  type DesktopAgentDirectoryItem
} from '../services/environment-service'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'

interface AgentsDirectoryPageProps {
  theme: Theme
  selectedAgentId: string | null
  onSelectAgent: (agentId: string) => void
  onNewAgent: () => void
  onArchiveAgent?: (agent: DesktopAgentDirectoryItem) => void
}

function agentSublabel(
  agent: DesktopAgentDirectoryItem,
  binding: { adapterId: string; environmentName: string; environmentStatus: string } | null
): string {
  if (binding) return `${harnessLabel(binding.adapterId)} · ${binding.environmentName} · ${binding.environmentStatus}`
  if (workspaceAgentUsesByo(agent)) return 'Bring your own agent · unbound'
  return agent.modelId || 'Overlay agent'
}

export function AgentsDirectoryPage({
  theme,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
  onArchiveAgent
}: AgentsDirectoryPageProps): React.ReactElement<any> {
  const { status, agents, environments, bindingByAgentId } = useEnvironments()

  const environmentsById = useMemo(
    () => new Map(environments.map((environment) => [environment.id, environment])),
    [environments]
  )

  const sorted = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents]
  )

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 8px 6px', flexShrink: 0 }}>
        <button
          onClick={onNewAgent}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '8px 12px',
            background: theme.text,
            color: theme.background,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.8'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          <Plus size={14} />
          New agent
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 8px' }}>
        {status === 'loading' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '24px 0',
              color: theme.textSecondary,
              fontSize: '12px'
            }}
          >
            <Loader2 size={14} className="animate-spin" /> Loading agents…
          </div>
        ) : sorted.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary
            }}
          >
            <Bot size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>No agents yet</span>
          </div>
        ) : (
          sorted.map((agent) => {
            const binding = bindingByAgentId.get(agent.id)
            const environment = binding ? environmentsById.get(binding.environmentId) : undefined
            const adapterId =
              typeof binding?.adapterConfig.adapterId === 'string'
                ? binding.adapterConfig.adapterId
                : 'codex'
            const sublabel = agentSublabel(
              agent,
              binding && environment
                ? {
                    adapterId,
                    environmentName: environment.name,
                    environmentStatus: deriveDisplayStatus(environment)
                  }
                : null
            )
            return (
              <SidebarListItem
                key={agent.id}
                icon={Bot}
                label={agent.name}
                sublabel={sublabel}
                isActive={selectedAgentId === agent.id}
                isSelectMode={false}
                isBatchSelected={false}
                onBatchToggle={() => undefined}
                onClick={() => onSelectAgent(agent.id)}
                theme={theme}
                actions={
                  onArchiveAgent ? (
                    <SidebarItemAction
                      onClick={() => onArchiveAgent(agent)}
                      title={`Archive ${agent.name}`}
                      icon={Trash2}
                      color={theme.textSecondary}
                    />
                  ) : undefined
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}
