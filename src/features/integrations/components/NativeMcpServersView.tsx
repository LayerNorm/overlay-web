'use client'

import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, McpServerDialog } from '@overlay/modules-react/extensions'
import { Button, toast } from '@overlay/ui/primitives'
import { Archive, Plus, RotateCcw, User, Users } from 'lucide-react'
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
import { useNativeMcpServer, useNativeMcpServers, type NativeMcpSummary } from '../hooks/use-native-mcp-servers'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'
import { scopeItemOptions } from '@/shared/workspaces/resource-scope'
import {
  captureNativeMcpSnapshot,
  nativeMcpDialogProblem,
  nativeMcpDialogServerId,
  retainCreatedNativeMcpServer,
  type NativeMcpDialogState,
} from './native-mcp-dialog-state'
import { NativeMcpServerList } from './NativeMcpServerList'

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
  const [dialog, setDialog] = useState<NativeMcpDialogState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const servers = native.servers as NativeMcpSummary[]
  const filteredServers = useMemo(() => filterMcpServers(servers, searchQuery), [servers, searchQuery])
  const dialogId = nativeMcpDialogServerId(dialog)
  const dialogLiveServer = useNativeMcpServer(workspaceId, dialogId, native.availability === 'available')
  const dialogProblem = nativeMcpDialogProblem(dialog, dialogLiveServer)
  const dialogSnapshot = dialog?.snapshot

  useEffect(() => {
    if (!dialogId || dialogLiveServer === undefined) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capture the first direct-query revision for guarded writes.
    setDialog((current) => {
      if (!current || nativeMcpDialogServerId(current) !== dialogId) return current
      if (current.snapshot && dialogLiveServer) return current
      return captureNativeMcpSnapshot(current, dialogLiveServer)
    })
  }, [dialogId, dialogLiveServer])

  const handleSaveServer = useCallback(async (values: McpServerFormValues): Promise<McpMutationResult> => {
    if (dialogProblem) return { ok: false, error: dialogProblem }
    if (!workspaceId) return { ok: false, error: 'Choose an active workspace before saving.' }
    if (dialog?.mode === 'edit' && dialog.persistedId && dialog.snapshot) {
      const captured = dialog.snapshot
      const hasFreshCredential = Boolean(values.bearerToken || values.headerName || values.headerValue)
      const connectionChanged = values.url.trim() !== (dialog.createEndpoint ?? captured.url)
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
        ...(captured.endpointRedacted && values.url.trim() === (dialog.createEndpoint ?? captured.url) ? omitMcpUrl(update) : update),
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
  }, [dialog, dialogProblem, native, scope, workspaceId])

  const handleDeleteServer = useCallback(async (server: McpServerSummary): Promise<McpMutationResult> => {
    if (dialogProblem) return { ok: false, error: dialogProblem }
    const response = await overlayAppClient.mcpServers.deleteResponse({ mcpServerId: server._id })
    if (!response.ok) return failure(response, 'Could not delete this MCP server.')
    dispatchChanged()
    return { ok: true }
  }, [dialogProblem])

  const handleTestServer = useCallback(async (values: McpServerFormValues): Promise<McpTestResultState> => {
    if (dialogProblem) return { ok: false, message: dialogProblem }
    try {
      const server = dialog?.mode === 'edit' ? dialog.snapshot : undefined
      const hasFreshCredential = Boolean(values.bearerToken || values.headerName || values.headerValue)
      const endpointUnchanged = Boolean(server && values.url.trim() === (dialog?.createEndpoint ?? server.url))
      const transportUnchanged = Boolean(server && values.transport === server.transport)
      const authUnchanged = Boolean(server && values.authType === server.authType)
      const timeoutUnchanged = Boolean(server && values.timeoutMs === (server.timeoutMs ?? ''))
      const unchangedStoredConfig = endpointUnchanged && transportUnchanged && authUnchanged
        && timeoutUnchanged && !hasFreshCredential
      const testRequest = {
        ...createMcpTestRequest(values, server ? { mcpServerId: server._id } : undefined),
        ...(endpointUnchanged
          ? unchangedStoredConfig ? { useStoredConfig: true } : { useStoredEndpoint: true }
          : {}),
      }
      const response = await overlayAppClient.mcpServers.testResponse(testRequest)
      const data = await response.json().catch(() => ({ error: 'Invalid response' })) as TestMcpServerResponse
      if (response.ok) dispatchChanged()
      return formatMcpTestResult(data, response.ok)
    } catch {
      return { ok: false, message: 'Connection failed' }
    }
  }, [dialog, dialogProblem])

  const handleConnectOAuth = useCallback(async (values: McpServerFormValues): Promise<McpMutationResult> => {
    if (dialogProblem) return { ok: false, error: dialogProblem }
    const oauthTab = window.open('about:blank', '_blank')
    try {
      let mcpServerId = dialog?.mode === 'edit' ? dialog.persistedId : undefined
      if (mcpServerId && dialog?.snapshot && workspaceId) {
        const saved = createMcpUpdateRequest(mcpServerId, values)
        const update = {
          ...(dialog.snapshot.endpointRedacted && values.url.trim() === (dialog.createEndpoint ?? dialog.snapshot.url) ? omitMcpUrl(saved) : saved),
          expectedUpdatedAt: dialog.snapshot.updatedAt,
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
        setDialog((current) => retainCreatedNativeMcpServer(current, result.id, values.url.trim()))
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
  }, [dialog, dialogProblem, scope, workspaceId])

  const handleDisconnectOAuth = useCallback(async (server: McpServerSummary): Promise<McpMutationResult> => {
    if (dialogProblem) return { ok: false, error: dialogProblem }
    const response = await overlayAppClient.mcpServers.disconnectOAuthResponse({ mcpServerId: server._id })
    if (!response.ok) return failure(response, 'Could not disconnect this server.')
    dispatchChanged()
    return { ok: true }
  }, [dialogProblem])

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

  const dialogDisplayServer = dialogSnapshot && dialogLiveServer
    ? {
      ...dialogSnapshot,
      oauthStatus: dialogLiveServer.oauthStatus,
      oauthError: dialogLiveServer.oauthError,
      commandState: dialogLiveServer.commandState,
    }
    : dialogSnapshot
  const activeDialogState = dialog?.mode === 'create'
    ? { mode: 'create' as const }
    : dialog?.mode === 'edit' && dialogDisplayServer && dialogLiveServer !== null
      ? { mode: 'edit' as const, server: dialogDisplayServer }
      : null
  const dialogMissing = Boolean(dialogId && (dialog?.missing || dialogLiveServer === null))
  const dialogLoading = Boolean(dialog?.mode === 'edit' && !dialogSnapshot && !dialogMissing)
  const liveCommand = dialogLiveServer?.commandState
  const commandMessage = nativeMcpCommandMessage(liveCommand)

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
      <NativeMcpServerList
        native={native}
        servers={servers}
        filteredServers={filteredServers as NativeMcpSummary[]}
        dialogLoading={dialogLoading}
        dialogMissing={dialogMissing}
        dialogProblem={dialogProblem}
        canAdd={canAdd}
        userId={user?.id}
        role={workspace.activeWorkspace?.role}
        onAdd={() => setDialog({ mode: 'create' })}
        onCloseProblem={() => setDialog(null)}
        onManage={(server) => setDialog({ mode: 'edit', persistedId: server._id })}
        onToggle={handleQuickToggle}
      />
      {activeDialogState ? (
        <McpServerDialog
          state={activeDialogState}
          onClose={() => setDialog(null)}
          onSave={handleSaveServer}
          onDelete={handleDeleteServer}
          onTest={handleTestServer}
          onConnectOAuth={handleConnectOAuth}
          onDisconnectOAuth={handleDisconnectOAuth}
          statusMessage={dialogProblem ?? undefined}
          scopeActions={dialog?.mode === 'edit' && dialogSnapshot ? (
            <div className="space-y-2">
              {commandMessage ? <p role="status" className="text-xs text-(--muted)">{commandMessage}</p> : null}
              <NativeMcpScopeActions
                server={dialogSnapshot}
                workspaceId={workspaceId!}
                changeScope={native.changeScope}
                disabled={Boolean(dialogProblem)}
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

function nativeMcpCommandMessage(command: NativeMcpSummary['commandState']) {
  if (!command) return null
  if (command.status === 'failed') return 'The last operation did not complete.'
  if (command.status === 'pending') {
    if (command.kind === 'connect') return 'Opening authorization…'
    if (command.kind === 'disconnect') return 'Disconnecting…'
    return 'Testing connection…'
  }
  if (command.status === 'succeeded') {
    if (command.kind === 'connect') return 'Authorization opened.'
    if (command.kind === 'disconnect') return 'Disconnected.'
    return 'Connection checked.'
  }
  return null
}

function NativeMcpScopeActions({
  server,
  workspaceId,
  changeScope,
  disabled,
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
  disabled: boolean
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
        <Button variant="ghost" key={action} type="button" disabled={busy || disabled} onClick={() => void run(action)}>
          <Icon size={13} />{label}
        </Button>
      ))}
    </div>
  )
}
