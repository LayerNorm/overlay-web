import { useMemo } from 'react'
import { Bot } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { useEnvironments } from '../contexts/EnvironmentContext'
import {
  deriveDisplayStatus,
  harnessLabel,
  workspaceAgentUsesByo
} from '../services/environment-service'

interface AgentDetailPageProps {
  theme: Theme
  agentId: string
  headerLeftSlot?: React.ReactNode
  onEditAgent?: () => void
}

export function AgentDetailPage({
  theme,
  agentId,
  headerLeftSlot,
  onEditAgent
}: AgentDetailPageProps): React.ReactElement<any> {
  const { agents, environments, bindingByAgentId } = useEnvironments()

  const agent = useMemo(
    () => agents.find((candidate) => candidate.id === agentId) ?? null,
    [agents, agentId]
  )
  const binding = agent ? (bindingByAgentId.get(agent.id) ?? null) : null
  const environment = binding
    ? (environments.find((candidate) => candidate.id === binding.environmentId) ?? null)
    : null
  const adapterId =
    binding && typeof binding.adapterConfig.adapterId === 'string'
      ? binding.adapterConfig.adapterId
      : 'codex'
  const workingDirectory =
    binding && typeof binding.adapterConfig.workingDirectory === 'string'
      ? binding.adapterConfig.workingDirectory
      : ''

  if (!agent) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.textSecondary,
          fontSize: '13px'
        }}
      >
        Agent not found in this workspace.
      </div>
    )
  }

  const isByo = workspaceAgentUsesByo(agent)
  const rows: Array<[string, string]> = isByo
    ? [
        ['Harness', harnessLabel(adapterId)],
        ['Environment', environment ? `${environment.name} · ${deriveDisplayStatus(environment)}` : 'Unbound'],
        ...(workingDirectory ? [['Working directory', workingDirectory] as [string, string]] : []),
        ['Rooms', String(agent.roomCount)]
      ]
    : [
        ['Model', agent.modelId || 'Default'],
        ['Visibility', agent.visibility === 'workspace' ? 'Workspace' : 'Creator only'],
        ['Rooms', String(agent.roomCount)]
      ]

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '40px 60px 80px 40px',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ maxWidth: '640px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {headerLeftSlot}
          <span
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Bot size={20} strokeWidth={1.5} color={theme.text} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                margin: 0,
                color: theme.text,
                fontSize: '22px',
                fontWeight: 600,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {agent.name}
            </h1>
            <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
              {isByo ? 'Bring your own agent' : 'Overlay agent'}
              {agent.createdByDisplayName ? ` · by ${agent.createdByDisplayName}` : ''}
            </div>
          </div>
          {onEditAgent && (
            <button
              type="button"
              onClick={onEditAgent}
              style={{
                flexShrink: 0,
                padding: '7px 14px',
                borderRadius: '8px',
                border: `1px solid ${theme.border}`,
                background: 'transparent',
                color: theme.text,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Edit
            </button>
          )}
        </div>

        {agent.description && (
          <p style={{ margin: '16px 0 0', color: theme.textSecondary, fontSize: '13px', lineHeight: '20px' }}>
            {agent.description}
          </p>
        )}

        <div
          style={{
            marginTop: '20px',
            borderRadius: '10px',
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            overflow: 'hidden'
          }}
        >
          {rows.map(([label, value], index) => (
            <div
              key={label}
              style={{
                display: 'flex',
                gap: '16px',
                padding: '10px 16px',
                borderTop: index === 0 ? 'none' : `1px solid ${theme.border}`,
                fontSize: '12px'
              }}
            >
              <span style={{ width: '130px', flexShrink: 0, color: theme.textSecondary }}>
                {label}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: theme.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={value}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {agent.instructions && (
          <div style={{ marginTop: '20px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: theme.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px'
              }}
            >
              Instructions
            </div>
            <pre
              style={{
                margin: 0,
                padding: '14px 16px',
                borderRadius: '10px',
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                color: theme.text,
                fontSize: '12px',
                lineHeight: '18px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, monospace'
              }}
            >
              {agent.instructions}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
