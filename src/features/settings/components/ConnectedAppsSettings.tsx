'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plug, Plus, Trash2 } from 'lucide-react'
import type { McpConnectionResource } from '@overlay/api-client'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { MCP_ACCESS_LABEL } from '@/shared/mcp/access'
import { ConnectAppGuide } from './ConnectAppGuide'
import { McpTokenDialog } from './McpTokenDialog'

function formatWhen(timestamp: number | null, fallback: string): string {
  if (!timestamp) return fallback
  // Locale pinned so server and client render the same text.
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Share your Overlay workspace with other AI apps (ChatGPT, Claude, Cursor, local
 * agents) over MCP. Each connection is something you granted and can end here.
 */
export function ConnectedAppsSettings() {
  const [endpoint, setEndpoint] = useState('')
  const [connections, setConnections] = useState<McpConnectionResource[] | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tokenOpen, setTokenOpen] = useState(false)
  const [removing, setRemoving] = useState<McpConnectionResource | null>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([overlayAppClient.mcpAccess.connections(), overlayAppClient.workspaces.list().catch(() => null)]).then(
      ([result, list]) => {
        if (cancelled) return
        setEndpoint(result.endpoint)
        setConnections(result.data)
        if (list) setWorkspaces(list.workspaces)
        setError(null)
      },
      (loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load your connections.')
        setConnections((current) => current ?? [])
      },
    )
    return () => { cancelled = true }
  }, [version])
  const refresh = useCallback(() => setVersion((current) => current + 1), [])

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await overlayAppClient.mcpAccess.revoke(removing.id)
      setRemoving(null)
      refresh()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not disconnect.')
    } finally {
      setBusy(false)
    }
  }

  const workspaceName = (id: string) => workspaces.find((workspace) => workspace.id === id)?.name ?? 'Workspace'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Connected apps</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Let ChatGPT, Claude, Cursor, and other AI apps use your Overlay notes, files, memory, and knowledge. You choose the workspace and what each app can do, and you can disconnect it here at any time.
        </p>
        {endpoint ? <div className="mt-4"><ConnectAppGuide endpoint={endpoint} /></div> : null}
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Connected</h3>
        <Button variant="secondary" size="sm" onClick={() => setTokenOpen(true)} disabled={workspaces.length === 0}>
          <Plus size={13} className="mr-1" /> Create a token
        </Button>
      </div>

      <div className="space-y-2">
        {connections !== null && connections.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
            Nothing connected yet. Add Overlay to an app above, or create a token for a local agent.
          </p>
        ) : null}
        {(connections ?? []).map((connection) => (
          <div key={connection.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-subtle)] text-[var(--muted)]"><Plug size={16} /></span>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium text-[var(--foreground)]">{connection.name}</h4>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {workspaceName(connection.workspaceId)} · {MCP_ACCESS_LABEL[connection.access]} · {connection.kind === 'token' ? 'Token' : 'Signed in'} · Last used {formatWhen(connection.lastUsedAt, 'never')}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Disconnect ${connection.name}`}
              onClick={() => setRemoving(connection)}
              className="rounded-lg p-2 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {tokenOpen ? <McpTokenDialog workspaces={workspaces} onClose={() => setTokenOpen(false)} onCreated={refresh} /> : null}

      <ConfirmDialog
        isOpen={removing !== null}
        title="Disconnect this app?"
        description={removing ? `${removing.name} loses access to ${workspaceName(removing.workspaceId)} right away. You can connect it again later.` : ''}
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
