'use client'

import { Component, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, McpServerDialog } from '@overlay/modules-react/extensions'
import { Button, toast } from '@overlay/ui/primitives'
import { Badge, Toggle } from '@overlay/ui'
import { Archive, Loader2, Plus, RotateCcw, Server, User, Users, Wrench } from 'lucide-react'
import {
  EXTENSIONS_CHANGED_EVENT,
  MCPS_CHANGED_EVENT,
  createMcpCreateRequest,
  createMcpTestRequest,
  createMcpUpdateRequest,
  filterMcpServers,
  formatMcpMutationError,
  formatMcpTestResult,
  type McpMutationResult,
  type McpServerFormValues,
  type McpServerSummary,
  type McpTestResultState,
  type TestMcpServerResponse,
} from '@overlay/app-core'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { useNativeMcpServers, type NativeMcpSummary } from '../hooks/use-native-mcp-servers'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'
import { scopeItemOptions } from '@/shared/workspaces/resource-scope'

type DialogState = { mode: 'create' | 'edit'; server?: NativeMcpSummary }

function omitMcpUrl<T extends object>(request: T): Omit<T, 'url'> {
  return Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'url')) as Omit<T, 'url'>
}

function dispatchChanged() {
  window.dispatchEvent(new CustomEvent(MCPS_CHANGED_EVENT))
  window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
}

function errorMessage(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : ''
  if (text.includes('MCP_REVISION_CONFLICT')) {
    return 'This MCP server changed while you were editing. Reopen it to review the latest settings.'
  }
  return fallback
}

async function failure(response: Response, fallback: string): Promise<McpMutationResult> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null
  return { ok: false, error: formatMcpMutationError(payload, fallback) }
}

export function NativeMcpUnavailable() {
  return (
    <AppScreenShell header={<ExtensionPageHeader title="MCP Servers" tabs={<PageSubviewTabs />} searchQuery="" searchPlaceholder="Search servers…" searchTitle="Search servers" onSearchQueryChange={() => {}} />}>
      <div role="alert" className="rounded-xl border border-(--border) bg-(--surface-elevated) p-5 text-sm text-(--muted)">
        Native MCP settings are unavailable in this session. Reload the page or contact your workspace administrator.
      </div>
    </AppScreenShell>
  )
}

export class NativeMcpErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <NativeMcpUnavailable />
    return this.props.children
  }
}

export default function NativeMcpServersView() {
  const auth = useConvexAuthConfiguration()
  const workspace = useWorkspace()
  const workspaceId = workspace.switchingWorkspaceId ? null : workspace.activeWorkspaceId
  const workspaceReady = workspace.status === 'ready' && !workspace.switchingWorkspaceId
  const scope = usePanelScope()
  const listView = usePanelListView()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))
  const { user } = useAuth()
  const native = useNativeMcpServers({
    configured: auth.nativeAuthConfigured,
    hasConvexClient: auth.hasConvexClient,
    workspaceId,
    workspaceReady,
    view: listView,
  })
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const servers = native.servers as NativeMcpSummary[]
  const filteredServers = useMemo(() => filterMcpServers(servers, searchQuery), [servers, searchQuery])
  const dialogLiveServer = dialog?.mode === 'edit'
    ? servers.find((server) => server._id === dialog.server?._id)
    : undefined

  const handleSaveServer = useCallback(async (values: McpServerFormValues): Promise<McpMutationResult> => {
    if (!workspaceId) return { ok: false, error: 'Choose an active workspace before saving.' }
    if (dialog?.mode === 'edit' && dialog.server) {
      const captured = dialog.server
      const hasFreshCredential = Boolean(values.bearerToken || values.headerName || values.headerValue)
      const connectionChanged = values.url.trim() !== captured.url
        || values.transport !== captured.transport
        || values.authType !== captured.authType
        || hasFreshCredential
      if (!connectionChanged) {
        try {
          await native.updateMetadata({
            workspaceId,
            mcpServerId: captured._id,
            expectedUpdatedAt: captured.updatedAt,
            name: values.name.trim(),
            description: values.description.trim(),
            enabled: values.enabled,
            ...(values.timeoutMs !== '' ? { timeoutMs: Number(values.timeoutMs) } : {}),
            defaultToolPolicy: values.defaultToolPolicy,
          })
        } catch (error) {
          return { ok: false, error: errorMessage(error, 'Could not save this MCP server.') }
        }
        dispatchChanged()
        return { ok: true }
      }

      const update = createMcpUpdateRequest(captured._id, values)
      const request = {
        ...(captured.endpointRedacted && values.url.trim() === captured.url ? omitMcpUrl(update) : update),
        expectedUpdatedAt: captured.updatedAt,
      }
      const response = await overlayAppClient.mcpServers.updateResponse(request)
      if (!response.ok) return failure(response, 'Could not save this MCP server.')
      dispatchChanged()
      return { ok: true }
    }

    const response = await overlayAppClient.mcpServers.createResponse({
      ...createMcpCreateRequest(values),
      scope: newItemScope(scope),
    })
    if (!response.ok) return failure(response, 'Could not add this MCP server.')
    dispatchChanged()
    return { ok: true }
  }, [dialog, native, scope, workspaceId])

  const handleDeleteServer = useCallback(async (server: McpServerSummary): Promise<McpMutationResult> => {
    const response = await overlayAppClient.mcpServers.deleteResponse({ mcpServerId: server._id })
    if (!response.ok) return failure(response, 'Could not delete this MCP server.')
    dispatchChanged()
    return { ok: true }
  }, [])

  const handleTestServer = useCallback(async (values: McpServerFormValues): Promise<McpTestResultState> => {
    try {
      const server = dialog?.mode === 'edit' ? dialog.server : undefined
      const unchangedStoredConnection = Boolean(server
        && values.url.trim() === server.url
        && values.transport === server.transport
        && values.authType === server.authType
        && !values.bearerToken && !values.headerName && !values.headerValue)
      const testRequest = unchangedStoredConnection
        ? { mcpServerId: server!._id, url: values.url.trim(), useStoredConfig: true }
        : createMcpTestRequest(values, server ? { mcpServerId: server._id } : undefined)
      const response = await overlayAppClient.mcpServers.testResponse(testRequest)
      const data = await response.json().catch(() => ({ error: 'Invalid response' })) as TestMcpServerResponse
      if (response.ok) dispatchChanged()
      return formatMcpTestResult(data, response.ok)
    } catch {
      return { ok: false, message: 'Connection failed' }
    }
  }, [dialog])

  const handleConnectOAuth = useCallback(async (values: McpServerFormValues): Promise<McpMutationResult> => {
    const oauthTab = window.open('about:blank', '_blank')
    try {
      let mcpServerId = dialog?.mode === 'edit' ? dialog.server?._id : undefined
      if (mcpServerId && dialog?.server && workspaceId) {
        const saved = createMcpUpdateRequest(mcpServerId, values)
        const update = {
          ...(dialog.server.endpointRedacted && values.url.trim() === dialog.server.url ? omitMcpUrl(saved) : saved),
          expectedUpdatedAt: dialog.server.updatedAt,
        }
        const response = await overlayAppClient.mcpServers.updateResponse(update)
        if (!response.ok) {
          oauthTab?.close()
          return failure(response, 'Could not save this MCP server.')
        }
        dispatchChanged()
      } else {
        const created = await overlayAppClient.mcpServers.createResponse({
          ...createMcpCreateRequest(values),
          scope: newItemScope(scope),
        })
        if (!created.ok) {
          oauthTab?.close()
          return failure(created, 'Could not save this MCP server.')
        }
        const result = await created.json() as { id: string }
        mcpServerId = result.id
        dispatchChanged()
      }
      if (!mcpServerId) {
        oauthTab?.close()
        return { ok: false, error: 'Could not save this MCP server.' }
      }
      const started = await overlayAppClient.mcpServers.startOAuthResponse({
        mcpServerId,
        returnTo: '/app/tools?view=mcps&mcpOAuth=connected',
      })
      const data = await started.json().catch(() => null) as
        { redirectUrl?: string; alreadyConnected?: boolean; error?: unknown } | null
      if (!started.ok) {
        oauthTab?.close()
        return { ok: false, error: formatMcpMutationError(data, 'Could not start the OAuth flow.') }
      }
      dispatchChanged()
      if (data?.alreadyConnected) {
        oauthTab?.close()
        return { ok: true }
      }
      if (!data?.redirectUrl) {
        oauthTab?.close()
        return { ok: false, error: 'The server did not return an authorization URL.' }
      }
      if (oauthTab) oauthTab.location.href = data.redirectUrl
      else window.open(data.redirectUrl, '_blank', 'noopener,noreferrer')
      return { ok: true }
    } catch {
      oauthTab?.close()
      return { ok: false, error: 'Could not start the OAuth flow.' }
    }
  }, [dialog, scope, workspaceId])

  const handleDisconnectOAuth = useCallback(async (server: McpServerSummary): Promise<McpMutationResult> => {
    const response = await overlayAppClient.mcpServers.disconnectOAuthResponse({ mcpServerId: server._id })
    if (!response.ok) return failure(response, 'Could not disconnect this server.')
    dispatchChanged()
    return { ok: true }
  }, [])

  const handleQuickToggle = useCallback(async (server: NativeMcpSummary) => {
    if (!workspaceId) return
    try {
      await native.updateMetadata({
        workspaceId,
        mcpServerId: server._id,
        expectedUpdatedAt: server.updatedAt,
        enabled: !server.enabled,
      })
      dispatchChanged()
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update this MCP server.'))
    }
  }, [native, workspaceId])

  if (native.availability === 'unavailable') return <NativeMcpUnavailable />
  if (native.availability !== 'available') {
    return (
      <AppScreenShell header={<ExtensionPageHeader title="MCP Servers" tabs={<PageSubviewTabs />} searchQuery="" searchPlaceholder="Search servers…" searchTitle="Search servers" onSearchQueryChange={() => {}} />}>
        <div className="p-6 text-sm text-(--muted)">Loading MCP servers…</div>
      </AppScreenShell>
    )
  }

  const activeDialogState: DialogState | null = dialog && dialog.mode === 'edit'
    ? { ...dialog, server: { ...dialog.server!, oauthStatus: dialogLiveServer?.oauthStatus, oauthError: dialogLiveServer?.oauthError } }
    : dialog
  const liveCommand = dialogLiveServer?.commandState
  const commandMessage = liveCommand?.status === 'pending'
    ? liveCommand.kind === 'connect' ? 'Opening authorization…' : liveCommand.kind === 'disconnect' ? 'Disconnecting…' : 'Testing connection…'
    : liveCommand?.status === 'succeeded'
      ? liveCommand.kind === 'connect' ? 'Authorization opened.' : liveCommand.kind === 'disconnect' ? 'Disconnected.' : 'Connection checked.'
      : liveCommand?.status === 'failed' ? 'The last operation did not complete.' : null

  return (
    <AppScreenShell
      header={
        <ExtensionPageHeader
          title="MCP Servers"
          tabs={<PageSubviewTabs />}
          searchQuery={searchQuery}
          searchPlaceholder="Search servers…"
          searchTitle="Search servers"
          action={canAdd ? <Button variant="primary" size="sm" onClick={() => setDialog({ mode: 'create' })}><Plus size={12} />Add Server</Button> : undefined}
          onSearchQueryChange={setSearchQuery}
        />
      }
    >
      <AppScreenBody padding="none" maxWidth="none" className="h-full">
        {native.loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-(--muted)" /></div>
        ) : servers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <Server size={40} strokeWidth={1} className="text-(--muted-light)" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-(--foreground)">No MCP servers configured</p>
              <p className="text-xs text-(--muted-light)">Add remote MCP servers to extend the AI agent with custom tools.</p>
            </div>
            {canAdd ? <Button variant="secondary" size="md" type="button" onClick={() => setDialog({ mode: 'create' })}><Plus size={14} />Add Server</Button> : null}
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="p-6 text-sm text-(--muted)">No MCP servers match this search.</div>
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-6 py-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredServers.map((item) => {
              const server = item as NativeMcpSummary
              const connected = server.authType === 'oauth' && server.oauthStatus === 'connected'
              const error = Boolean(server.oauthError || server.toolCatalogError) || server.oauthStatus === 'needs_reauth'
              const status = server.archivedAt !== undefined ? 'Archived' : !server.enabled ? 'Inactive' : error ? 'Connection error' : connected ? 'Connected' : server.authType === 'oauth' ? 'Not connected' : 'Active'
              const statusVariant = error ? 'danger' : connected ? 'success' : 'muted'
              const role = workspace.activeWorkspace?.role
              const canEdit = server.userId === user?.id || role === 'owner' || role === 'admin'
              let host = server.url
              try { host = new URL(server.url).hostname } catch { /* The redacted endpoint is safe to display. */ }
              return (
                <article key={server._id} className="flex flex-col gap-4 overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-(--surface-subtle) text-(--foreground)"><Server size={20} strokeWidth={1.6} /></span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-(--foreground)">{server.name || 'Untitled'}</h3>
                        <p className="mt-1 truncate text-xs text-(--muted)">{server.description || server.url}</p>
                      </div>
                    </div>
                    <Toggle
                      checked={server.enabled}
                      disabled={!canEdit || server.archivedAt !== undefined}
                      aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                      onCheckedChange={() => void handleQuickToggle(server)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-(--muted)">
                    <Badge variant={statusVariant}>{status}</Badge>
                    <span className="inline-flex items-center gap-1.5"><Wrench size={13} />{server.toolCatalogCount === undefined ? 'Tools not discovered' : `${server.toolCatalogCount} tools`}</span>
                    <Badge variant="muted">{server.transport === 'sse' ? 'SSE' : 'HTTP'}</Badge>
                    {server.authType !== 'none' ? <Badge variant="muted">{server.authType === 'oauth' ? 'OAuth' : 'Authenticated'}</Badge> : null}
                  </div>
                  {server.toolCatalogError ? <p className="line-clamp-2 text-xs text-red-500">Tools unavailable: {server.toolCatalogError}</p> : null}
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-(--border) pt-3">
                    <span className="truncate text-xs text-(--muted)" title={host}>{host}</span>
                    <Button variant="ghost" size="sm" className="text-(--foreground)" aria-label={`Manage ${server.name}`} onClick={() => setDialog({ mode: 'edit', server })}>
                      Manage
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        {native.hasMore ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" size="sm" disabled={native.loadingMore} onClick={native.loadMore}>
              {native.loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </AppScreenBody>
      {activeDialogState ? (
        <McpServerDialog
          state={activeDialogState}
          onClose={() => setDialog(null)}
          onSave={handleSaveServer}
          onDelete={handleDeleteServer}
          onTest={handleTestServer}
          onConnectOAuth={handleConnectOAuth}
          onDisconnectOAuth={handleDisconnectOAuth}
          scopeActions={dialog?.mode === 'edit' && dialog.server ? (
            <div className="space-y-2">
              {commandMessage ? <p role="status" className="text-xs text-(--muted)">{commandMessage}</p> : null}
              <NativeMcpScopeActions
                server={dialogLiveServer ?? dialog.server}
                workspaceId={workspaceId!}
                changeScope={native.changeScope}
                onChanged={() => {
                  setDialog(null)
                  dispatchChanged()
                }}
              />
            </div>
          ) : undefined}
        />
      ) : null}
    </AppScreenShell>
  )
}

function NativeMcpScopeActions({
  server,
  workspaceId,
  changeScope,
  onChanged,
}: {
  server: NativeMcpSummary
  workspaceId: string
  changeScope: (args: {
    workspaceId: string
    mcpServerId: string
    expectedUpdatedAt: number
    action: 'personal' | 'workspace' | 'archive' | 'restore'
  }) => Promise<unknown>
  onChanged: () => void
}) {
  const { user } = useAuth()
  const { access, viewer } = useWorkspaceCreateAccess()
  const solo = useIsSoloWorkspace()
  const scopeViewer = user?.id && viewer
    ? { userId: user.id, role: viewer.role }
    : null
  const options = scopeViewer
    ? scopeItemOptions('extension', {
      userId: server.userId ?? '',
      scope: server.scope,
      archivedAt: server.archivedAt,
      archivedFromScope: server.archivedFromScope,
    }, scopeViewer, access.scope)
    : { moveTo: null, canArchive: false, canRestore: false }
  const items = [
    ...(options.moveTo && !(solo && options.moveTo === 'workspace')
      ? [{ action: options.moveTo as 'personal' | 'workspace', label: options.moveTo === 'workspace' ? 'Move to Workspace' : 'Move to Personal', icon: options.moveTo === 'workspace' ? Users : User }]
      : []),
    ...(options.canArchive ? [{ action: 'archive' as const, label: 'Archive', icon: Archive }] : []),
    ...(options.canRestore ? [{ action: 'restore' as const, label: 'Restore', icon: RotateCcw }] : []),
  ]
  const [busy, setBusy] = useState(false)
  if (!items.length) return null

  async function run(action: 'personal' | 'workspace' | 'archive' | 'restore') {
    setBusy(true)
    try {
      await changeScope({ workspaceId, mcpServerId: server._id, expectedUpdatedAt: server.updatedAt, action })
      onChanged()
    } catch (error) {
      toast.error(errorMessage(error, 'Could not change this MCP server.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ action, label, icon: Icon }) => (
        <Button variant="ghost" key={action} type="button" disabled={busy} onClick={() => void run(action)}>
          <Icon size={13} />{label}
        </Button>
      ))}
    </div>
  )
}
