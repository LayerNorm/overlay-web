import { useState, type ReactElement } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { Theme } from '../../utils/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import type { DesktopWorkspaceSummary } from '../../services/workspace-service'

interface WorkspaceSettingsProps {
  theme: Theme
}

function kindLabel(workspace: DesktopWorkspaceSummary): string {
  if (workspace.kind === 'personal') return 'Personal'
  return workspace.role
    ? `Organization · ${workspace.role}`
    : 'Organization'
}

export function WorkspaceSettings({ theme }: WorkspaceSettingsProps): ReactElement<any> {
  const { status, workspaces, activeWorkspaceId, error, switchingWorkspaceId, refresh, switchWorkspace } =
    useWorkspace()
  const [switchError, setSwitchError] = useState<string | null>(null)

  const handleSwitch = async (workspaceId: string): Promise<void> => {
    setSwitchError(null)
    try {
      await switchWorkspace(workspaceId)
    } catch (switchFailure) {
      setSwitchError(
        switchFailure instanceof Error ? switchFailure.message : String(switchFailure)
      )
    }
  }

  return (
    <div>
      <h1
        style={{
          margin: 0,
          color: theme.text,
          fontSize: '24px',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }}
      >
        Workspace
      </h1>
      <p style={{ margin: '6px 0 0', color: theme.textSecondary, fontSize: '13px', lineHeight: '20px' }}>
        Agents, environments, projects, and files are scoped to the active workspace.
        Member management stays on the web for now.
      </p>

      {(error || switchError) && (
        <div
          role="alert"
          style={{
            marginTop: '16px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <span>{switchError ?? error}</span>
          <button
            type="button"
            onClick={() => {
              setSwitchError(null)
              void refresh()
            }}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '12px',
              padding: '4px 10px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {status === 'loading' &&
          [0, 1].map((row) => (
            <div
              key={row}
              style={{ height: 56, borderRadius: 10, background: theme.surface, opacity: 0.55 }}
            />
          ))}

        {status !== 'loading' &&
          workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId
            const isSwitching = switchingWorkspaceId === workspace.id
            return (
              <div
                key={workspace.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: theme.surface,
                  border: `1px solid ${isActive ? theme.text : theme.border}`
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: theme.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {workspace.name}
                  </div>
                  <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
                    {kindLabel(workspace)}
                    {typeof workspace.memberCount === 'number' &&
                      ` · ${workspace.memberCount} member${workspace.memberCount === 1 ? '' : 's'}`}
                  </div>
                </div>
                {isActive ? (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      color: theme.textSecondary
                    }}
                  >
                    <Check size={13} /> Active
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={switchingWorkspaceId !== null}
                    onClick={() => void handleSwitch(workspace.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: `1px solid ${theme.border}`,
                      background: 'transparent',
                      color: theme.text,
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: switchingWorkspaceId !== null ? 'default' : 'pointer',
                      opacity: switchingWorkspaceId !== null ? 0.5 : 1
                    }}
                  >
                    {isSwitching && <Loader2 size={12} className="animate-spin" />}
                    {isSwitching ? 'Switching…' : 'Switch'}
                  </button>
                )}
              </div>
            )
          })}

        {status === 'ready' && workspaces.length === 0 && !error && (
          <div style={{ fontSize: '12px', color: theme.textSecondary }}>
            No workspaces found. Your Personal workspace is created on sign-in.
          </div>
        )}
      </div>
    </div>
  )
}
