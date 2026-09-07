import { useEffect, useState, type ReactElement } from 'react'
import { Check, Loader2, LogOut, Settings } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { loadAuthSessionSecure, type AuthSession } from '../services/auth-service'
import type { DesktopWorkspaceSummary } from '../services/workspace-service'

interface AccountDialogProps {
  theme: Theme
  onOpenSettings: () => void
  onSignOut: () => void
  onClose: () => void
}

function workspaceInitial(workspace: DesktopWorkspaceSummary | null): string {
  return workspace?.name?.trim()?.[0]?.toUpperCase() ?? '?'
}

function workspaceSublabel(workspace: DesktopWorkspaceSummary): string {
  if (workspace.kind === 'personal') return 'Personal'
  return workspace.role ? `Organization · ${workspace.role}` : 'Organization'
}

function displayName(session: AuthSession | null): string {
  if (!session) return 'Account'
  const full = [session.user.firstName, session.user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  return full || session.user.email || 'Account'
}

export function AccountDialog({
  theme,
  onOpenSettings,
  onSignOut,
  onClose
}: AccountDialogProps): ReactElement<any> {
  const {
    status,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    error,
    switchingWorkspaceId,
    refresh,
    switchWorkspace
  } = useWorkspace()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  useEffect(() => {
    void loadAuthSessionSecure().then(setSession).catch(() => setSession(null))
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSelect = async (workspaceId: string): Promise<void> => {
    if (workspaceId === activeWorkspaceId || switchingWorkspaceId !== null) return
    setSwitchError(null)
    try {
      await switchWorkspace(workspaceId)
      onClose()
    } catch (switchFailure) {
      setSwitchError(
        switchFailure instanceof Error ? switchFailure.message : String(switchFailure)
      )
    }
  }

  const rowActionStyle: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }

  return (
    <div
      role="menu"
      aria-label="Account and workspaces"
      style={{
        width: '264px',
        maxHeight: '380px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        padding: '8px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 10px 10px'
        }}
      >
        <span
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            background: theme.background,
            border: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0
          }}
        >
          {session?.user.profilePictureUrl ? (
            <img
              src={session.user.profilePictureUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: '14px', fontWeight: 600, color: theme.text }}>
              {(displayName(session)[0] ?? '?').toUpperCase()}
            </span>
          )}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: theme.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {displayName(session)}
          </span>
          {session && (
            <span
              style={{
                display: 'block',
                fontSize: '11px',
                color: theme.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {session.user.email}
            </span>
          )}
        </span>
      </div>

      <div
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: theme.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          padding: '4px 10px 6px'
        }}
      >
        Workspaces
      </div>

      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {status === 'loading' &&
          [0, 1].map((row) => (
            <div
              key={row}
              style={{ height: 44, borderRadius: 8, background: theme.background, opacity: 0.55 }}
            />
          ))}

        {status !== 'loading' &&
          workspaces.map((workspace) => {
            const selected = workspace.id === activeWorkspaceId
            const switching = switchingWorkspaceId === workspace.id
            return (
              <button
                key={workspace.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={switchingWorkspaceId !== null}
                onClick={() => void handleSelect(workspace.id)}
                style={{
                  ...rowActionStyle,
                  background: selected ? theme.background : 'transparent',
                  opacity: switchingWorkspaceId !== null && !switching ? 0.5 : 1,
                  cursor: switchingWorkspaceId !== null ? 'default' : 'pointer'
                }}
              >
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: theme.background,
                    border: `1px solid ${theme.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: '12px',
                    fontWeight: 600,
                    color: theme.text
                  }}
                >
                  {workspaceInitial(workspace)}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: theme.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {workspace.name}
                  </span>
                  <span style={{ display: 'block', fontSize: '10px', color: theme.textSecondary }}>
                    {workspaceSublabel(workspace)}
                  </span>
                </span>
                {switching ? (
                  <Loader2 size={13} className="animate-spin" color={theme.textSecondary} />
                ) : selected ? (
                  <Check size={13} color={theme.text} />
                ) : null}
              </button>
            )
          })}

        {status === 'ready' && workspaces.length === 0 && (
          <div style={{ fontSize: '12px', color: theme.textSecondary, padding: '4px 10px' }}>
            No workspaces found.
          </div>
        )}
      </div>

      {(error || switchError) && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginTop: '6px',
            padding: '8px 10px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.08)',
            color: '#ef4444',
            fontSize: '11px'
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
              fontSize: '11px',
              padding: '3px 8px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ height: '1px', background: theme.border, margin: '8px 4px' }} />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          onOpenSettings()
        }}
        style={rowActionStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.background
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Settings size={14} color={theme.textSecondary} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>Settings</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onSignOut}
        style={rowActionStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.background
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <LogOut size={14} color={theme.textSecondary} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>Sign out</span>
      </button>

      {activeWorkspace && (
        <div
          style={{
            fontSize: '10px',
            color: theme.textSecondary,
            padding: '6px 10px 2px',
            opacity: 0.7
          }}
        >
          Viewing {activeWorkspace.name}
        </div>
      )}
    </div>
  )
}
