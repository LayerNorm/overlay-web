'use client'

import { Component, useEffect, useState, type ReactNode } from 'react'
import { useConvexAuth, useMutation, usePaginatedQuery } from 'convex/react'
import { EXTENSIONS_CHANGED_EVENT, MCPS_CHANGED_EVENT } from '@overlay/app-core'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { Button, toast } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Plug, Plus, Trash2 } from 'lucide-react'
import { MCP_ACCESS_LABEL } from '@/shared/mcp/access'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { ConnectAppGuide } from './ConnectAppGuide'
import { McpTokenDialog } from './McpTokenDialog'
import {
  nativeGrantListRef,
  nativeGrantRevokeRef,
  removeNativeGrantOptimistically,
} from '@/shared/mcp/native-connected-apps-optimistic'

type NativeGrant = {
  id: string
  name: string
  kind: 'oauth' | 'token'
  access: 'read' | 'write' | 'full'
  workspaceId: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
}

function dispatchChanged() {
  window.dispatchEvent(new CustomEvent(MCPS_CHANGED_EVENT))
  window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
}

function formatWhen(timestamp: number | null, fallback: string): string {
  if (!timestamp) return fallback
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NativeConnectedAppsErrorBoundary({ children }: { children: ReactNode }) {
  return <ConnectedAppsBoundary>{children}</ConnectedAppsBoundary>
}

class ConnectedAppsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <p role="alert" className="text-sm text-red-500">Connected apps are unavailable in this session. Reload the page or contact your workspace administrator.</p>
    }
    return this.props.children
  }
}

export default function NativeConnectedAppsSettings({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const workspace = useWorkspace()
  const workspaceReady = workspace.status === 'ready' && !workspace.switchingWorkspaceId
  const query = usePaginatedQuery(
    nativeGrantListRef,
    workspaceReady && !authLoading && isAuthenticated ? {} : 'skip',
    { initialNumItems: 30 },
  )
  const revoke = useMutation(nativeGrantRevokeRef).withOptimisticUpdate((store, args) => {
    removeNativeGrantOptimistically(store, args.grantId)
  })
  const [endpoint, setEndpoint] = useState('')
  const [tokenOpen, setTokenOpen] = useState(false)
  const [removing, setRemoving] = useState<NativeGrant | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/mcp`)
  }, [])

  const grants = (query.results ?? []) as NativeGrant[]
  const workspaceName = (id: string) => workspaces.find((item) => item.id === id)?.name ?? 'Workspace'
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await revoke({ grantId: removing.id })
      dispatchChanged()
      setRemoving(null)
      toast.success('App disconnected.')
    } catch {
      toast.error('Could not disconnect this app.')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <p className="text-sm text-(--muted)">Loading connected apps…</p>
  if (!isAuthenticated) {
    return <p role="alert" className="text-sm text-red-500">Connected apps are unavailable in this session. Reload the page or contact your workspace administrator.</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
        <h2 className="text-sm font-semibold text-(--foreground)">Connected apps</h2>
        <p className="mt-1 text-sm text-(--muted)">
          Let ChatGPT, Claude, Cursor, and other AI apps use your Overlay notes, files, memory, and knowledge. You choose the workspace and what each app can do, and you can disconnect it here at any time.
        </p>
        {endpoint ? <div className="mt-4"><ConnectAppGuide endpoint={endpoint} /></div> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">Connected</h3>
        <Button variant="secondary" size="sm" onClick={() => setTokenOpen(true)} disabled={workspaces.length === 0}>
          <Plus size={13} className="mr-1" /> Create a token
        </Button>
      </div>

      <div className="space-y-2">
        {query.status === 'LoadingFirstPage' ? <p className="p-6 text-sm text-(--muted)">Loading connected apps…</p> : null}
        {query.status !== 'LoadingFirstPage' && grants.length === 0 && query.status !== 'CanLoadMore' ? (
          <p className="rounded-xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted)">
            Nothing connected yet. Add Overlay to an app above, or create a token for a local agent.
          </p>
        ) : null}
        {grants.map((grant) => (
          <div key={grant.id} className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--surface-subtle) text-(--muted)"><Plug size={16} /></span>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium text-(--foreground)">{grant.name}</h4>
              <p className="mt-0.5 truncate text-xs text-(--muted)">
                {workspaceName(grant.workspaceId)} · {MCP_ACCESS_LABEL[grant.access]} · {grant.kind === 'token' ? 'Token' : 'Signed in'} · Last used {formatWhen(grant.lastUsedAt, 'never')}
              </p>
            </div>
            <Button variant="ghost"
              type="button"
              aria-label={`Disconnect ${grant.name}`}
              onClick={() => setRemoving(grant)}
              className={unstyledButton('rounded-lg p-2 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-red-400')}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>

      {query.status === 'CanLoadMore' || query.status === 'LoadingMore' ? (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" disabled={query.status === 'LoadingMore'} onClick={() => query.loadMore(30)}>
            {query.status === 'LoadingMore' ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {tokenOpen ? <McpTokenDialog workspaces={[...workspaces]} onClose={() => setTokenOpen(false)} onCreated={dispatchChanged} /> : null}

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
