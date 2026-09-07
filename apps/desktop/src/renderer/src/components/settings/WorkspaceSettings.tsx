import { useEffect, useState, type ReactElement } from 'react'
import { Check, Copy, Loader2, Monitor, Pencil, Trash2 } from 'lucide-react'
import type { Theme } from '../../utils/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useEnvironments } from '../../contexts/EnvironmentContext'
import {
  approveEnvironment,
  BUILT_IN_HARNESSES,
  createEnrollment,
  deriveDisplayStatus,
  lastSeenLabel,
  revokeEnvironment,
  updateEnvironmentRoots,
  validateRoots,
  type BuiltInHarnessId,
  type DesktopAgentEnvironment,
  type DisplayEnvironmentStatus
} from '../../services/environment-service'
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

      <EnvironmentsSection theme={theme} />
    </div>
  )
}

const STATUS_DOT: Record<DisplayEnvironmentStatus, string> = {
  online: '#22c55e',
  offline: '#6b7280',
  pending: '#f59e0b',
  revoked: '#ef4444'
}

function environmentKindLabel(environment: DesktopAgentEnvironment): string {
  if (environment.kind === 'local') return 'This Mac or another computer'
  if (environment.kind === 'vps') return 'VPS or server'
  if (environment.kind === 'overlay_cloud') return 'Overlay Cloud'
  return 'External sandbox'
}

interface EnvironmentRowProps {
  theme: Theme
  environment: DesktopAgentEnvironment
  bindingCount: number
  roots: string
  onRootsChange(value: string): void
  editingRoots: boolean
  onEditRoots(editing: boolean): void
  busy: boolean
  isSetupEnvironment: boolean
  onApprove(): void
  onSaveRoots(): void
  onRevoke(): void
}

function EnvironmentRow({
  theme,
  environment,
  bindingCount,
  roots,
  onRootsChange,
  editingRoots,
  onEditRoots,
  busy,
  isSetupEnvironment,
  onApprove,
  onSaveRoots,
  onRevoke
}: EnvironmentRowProps): ReactElement<any> {
  const displayStatus = deriveDisplayStatus(environment)
  const seen = lastSeenLabel(environment.lastSeenAt)
  const grant = environment.filesystemGrant
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '10px',
        background: theme.surface,
        border: `1px solid ${isSetupEnvironment ? theme.text : theme.border}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Monitor size={16} color={theme.textSecondary} style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: 600,
              color: theme.text
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '9999px',
                background: STATUS_DOT[displayStatus],
                flexShrink: 0
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {environment.name}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
            {displayStatus}
            {` · ${environmentKindLabel(environment)}`}
            {environment.platform ? ` · ${environment.platform}` : ''}
            {environment.hostVersion ? ` · host ${environment.hostVersion}` : ''}
            {seen ? ` · ${seen}` : ''}
            {bindingCount > 0 ? ` · ${bindingCount} agent${bindingCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        {environment.status !== 'revoked' && (
          <button
            type="button"
            title={`Revoke ${environment.name}`}
            disabled={busy}
            onClick={onRevoke}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: busy ? 'default' : 'pointer',
              color: theme.textSecondary,
              padding: '6px',
              opacity: busy ? 0.5 : 1
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {displayStatus === 'offline' && (
        <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '8px' }}>
          Offline — asleep or its connector was closed. Overlay can&apos;t wake it remotely.
        </div>
      )}

      {environment.status === 'pending' && (
        <div
          style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border}` }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: theme.text }}>
            <Check size={13} color={theme.textSecondary} />
            Verify phrase: <strong>{environment.verificationPhrase ?? 'waiting…'}</strong>
          </div>
          <label
            style={{ display: 'block', marginTop: '10px', fontSize: '11px', color: theme.textSecondary }}
          >
            Approved project roots, one per line
            <textarea
              value={roots}
              onChange={(event) => onRootsChange(event.target.value)}
              placeholder="/Users/you/Projects"
              style={{
                marginTop: '6px',
                minHeight: '64px',
                width: '100%',
                resize: 'vertical',
                borderRadius: '8px',
                border: `1px solid ${theme.border}`,
                background: theme.background,
                color: theme.text,
                padding: '8px 10px',
                fontSize: '12px',
                fontFamily: 'ui-monospace, monospace',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </label>
          <p style={{ margin: '6px 0 0', fontSize: '11px', color: theme.textSecondary }}>
            Overlay can dispatch work only inside these explicit roots. Never approve a phrase
            you don&apos;t recognize.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            style={{
              marginTop: '10px',
              padding: '7px 14px',
              borderRadius: '8px',
              border: 'none',
              background: theme.text,
              color: theme.background,
              fontSize: '12px',
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1
            }}
          >
            Approve and continue
          </button>
        </div>
      )}

      {environment.status !== 'pending' && environment.status !== 'revoked' && grant && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border}` }}>
          {editingRoots ? (
            <div>
              <label
                style={{ display: 'block', fontSize: '11px', color: theme.textSecondary }}
              >
                Approved project roots, one per line
                <textarea
                  value={roots}
                  onChange={(event) => onRootsChange(event.target.value)}
                  style={{
                    marginTop: '6px',
                    minHeight: '64px',
                    width: '100%',
                    resize: 'vertical',
                    borderRadius: '8px',
                    border: `1px solid ${theme.border}`,
                    background: theme.background,
                    color: theme.text,
                    padding: '8px 10px',
                    fontSize: '12px',
                    fontFamily: 'ui-monospace, monospace',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </label>
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSaveRoots}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: theme.text,
                    color: theme.background,
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.6 : 1
                  }}
                >
                  Save roots
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEditRoots(false)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'transparent',
                    color: theme.textSecondary,
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ minWidth: 0, fontSize: '11px', color: theme.textSecondary }}>
                <div style={{ fontWeight: 600, color: theme.text, fontSize: '12px' }}>
                  Filesystem access
                </div>
                <div
                  style={{
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {grant.mode === 'all_user_files' ? 'All user files' : grant.roots.join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEditRoots(true)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'transparent',
                  border: 'none',
                  color: theme.textSecondary,
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <Pencil size={11} /> Change
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EnvironmentsSection({ theme }: { theme: Theme }): ReactElement<any> {
  const { status, environments, bindingsByEnvironmentId, error, refresh } = useEnvironments()
  const [harness, setHarness] = useState<BuiltInHarnessId>('codex')
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)
  const [baselineIds, setBaselineIds] = useState<string[]>([])
  const [setupEnvironmentId, setSetupEnvironmentId] = useState<string | null>(null)
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [editingRootsId, setEditingRootsId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Detect the newly enrolled pending environment once the host phones home.
  useEffect(() => {
    if (!command || setupEnvironmentId) return
    const baseline = new Set(baselineIds)
    const pending = [...environments]
      .filter((environment) => environment.status === 'pending' && !baseline.has(environment.id))
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    if (pending) setSetupEnvironmentId(pending.id)
  }, [command, environments, baselineIds, setupEnvironmentId])

  // The setup run is done once its environment leaves pending.
  useEffect(() => {
    if (!setupEnvironmentId) return
    const setup = environments.find((environment) => environment.id === setupEnvironmentId)
    if (setup && setup.status !== 'pending') {
      setCommand('')
      setSetupEnvironmentId(null)
    }
  }, [environments, setupEnvironmentId])

  const setupEnvironment = environments.find(
    (environment) => environment.id === setupEnvironmentId
  )

  const beginConnection = async (): Promise<void> => {
    setBusy('connect')
    setActionError(null)
    setCommand('')
    setSetupEnvironmentId(null)
    setBaselineIds(environments.map((environment) => environment.id))
    try {
      const session = await createEnrollment(harness)
      setCommand(session.command)
    } catch (value) {
      setActionError(value instanceof Error ? value.message : 'Could not create the connection.')
    } finally {
      setBusy(null)
    }
  }

  const copyCommand = async (): Promise<void> => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setActionError('Could not copy the command. Select it and copy it manually.')
    }
  }

  const approve = async (environmentId: string): Promise<void> => {
    const { roots: selected, error: rootsError } = validateRoots(roots[environmentId] ?? '')
    if (rootsError) {
      setActionError(rootsError)
      return
    }
    setBusy(environmentId)
    setActionError(null)
    try {
      await approveEnvironment(environmentId, selected)
      await refresh()
    } catch (value) {
      setActionError(value instanceof Error ? value.message : 'Approval failed.')
    } finally {
      setBusy(null)
    }
  }

  const saveRoots = async (environmentId: string): Promise<void> => {
    const { roots: selected, error: rootsError } = validateRoots(roots[environmentId] ?? '')
    if (rootsError) {
      setActionError(rootsError)
      return
    }
    setBusy(environmentId)
    setActionError(null)
    try {
      await updateEnvironmentRoots(environmentId, selected)
      setEditingRootsId(null)
      await refresh()
    } catch (value) {
      setActionError(value instanceof Error ? value.message : 'Project root update failed.')
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (environmentId: string): Promise<void> => {
    setBusy(environmentId)
    setActionError(null)
    try {
      await revokeEnvironment(environmentId)
      await refresh()
    } catch (value) {
      setActionError(value instanceof Error ? value.message : 'Revocation failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ marginTop: '32px' }}>
      <h2
        style={{
          margin: 0,
          color: theme.text,
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }}
      >
        Connected environments
      </h2>
      <p style={{ margin: '6px 0 0', color: theme.textSecondary, fontSize: '13px', lineHeight: '20px' }}>
        Machines and sandboxes that can run agent work in this workspace. Connections are
        outbound-only — no inbound port is opened.
      </p>

      <div
        style={{
          marginTop: '16px',
          padding: '14px 16px',
          borderRadius: '10px',
          background: theme.surface,
          border: `1px solid ${theme.border}`
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
          Connect this Mac
        </div>
        <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {BUILT_IN_HARNESSES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setHarness(option.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '9999px',
                border: `1px solid ${harness === option.id ? theme.text : theme.border}`,
                background: harness === option.id ? theme.text : 'transparent',
                color: harness === option.id ? theme.background : theme.text,
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!command ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void beginConnection()}
            style={{
              marginTop: '12px',
              padding: '7px 14px',
              borderRadius: '8px',
              border: 'none',
              background: theme.text,
              color: theme.background,
              fontSize: '12px',
              fontWeight: 600,
              cursor: busy !== null ? 'default' : 'pointer',
              opacity: busy !== null ? 0.6 : 1
            }}
          >
            {busy === 'connect' ? 'Creating…' : 'Create connection'}
          </button>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: theme.textSecondary, lineHeight: '18px' }}>
              Run this on your Mac. It connects outbound and keeps the connector alive
              with <code>—run</code>. Waiting for the new environment to phone home…
            </p>
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: theme.background,
                border: `1px solid ${theme.border}`
              }}
            >
              <pre
                style={{
                  margin: 0,
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  lineHeight: '16px',
                  color: theme.text
                }}
              >
                {command}
              </pre>
              <button
                type="button"
                onClick={() => void copyCommand()}
                title="Copy connection command"
                style={{
                  flexShrink: 0,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: theme.textSecondary,
                  padding: '2px'
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {(error || actionError) && (
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
          <span>{actionError ?? error}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null)
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

      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {status === 'loading' &&
          [0, 1].map((row) => (
            <div
              key={row}
              style={{ height: 56, borderRadius: 10, background: theme.surface, opacity: 0.55 }}
            />
          ))}

        {status !== 'loading' &&
          environments.map((environment) => (
            <EnvironmentRow
              key={environment.id}
              theme={theme}
              environment={environment}
              bindingCount={bindingsByEnvironmentId.get(environment.id)?.length ?? 0}
              roots={roots[environment.id] ?? ''}
              onRootsChange={(value) =>
                setRoots((current) => ({ ...current, [environment.id]: value }))
              }
              editingRoots={editingRootsId === environment.id}
              onEditRoots={(editing) => {
                if (editing) {
                  const grant = environment.filesystemGrant
                  setRoots((current) => ({
                    ...current,
                    [environment.id]:
                      grant?.mode === 'selected_roots' ? grant.roots.join('\n') : ''
                  }))
                }
                setEditingRootsId(editing ? environment.id : null)
              }}
              busy={busy !== null}
              isSetupEnvironment={environment.id === setupEnvironmentId}
              onApprove={() => void approve(environment.id)}
              onSaveRoots={() => void saveRoots(environment.id)}
              onRevoke={() => void revoke(environment.id)}
            />
          ))}

        {status === 'ready' && environments.length === 0 && !error && (
          <div style={{ fontSize: '12px', color: theme.textSecondary }}>
            No environments connected yet.
          </div>
        )}

        {setupEnvironment && setupEnvironment.status === 'pending' && (
          <div style={{ fontSize: '12px', color: theme.textSecondary }}>
            New environment detected — verify the phrase below, approve its roots, and it
            joins this workspace.
          </div>
        )}
      </div>
    </div>
  )
}
