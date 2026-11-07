'use client'
import { Button } from '@overlay/ui/primitives'

// Compatibility wrapper: MCP contracts/controllers live in @overlay/app-core;
// shared React presentation lives in @overlay/modules-react.
import { useMemo, useState, type MouseEvent } from 'react'
import { Plus } from 'lucide-react'
import {
  createMcpCreateRequest,
  createMcpSummaryFromForm,
  createMcpTestRequest,
  createMcpUpdateRequest,
  filterMcpServers,
  formatMcpMutationError,
  formatMcpTestResult,
  setMcpServerEnabled,
  type McpMutationResult,
  type McpServerFormValues,
  type McpServerSummary,
  type McpTestResultState,
  type TestMcpServerResponse,
} from '@overlay/app-core'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { ExtensionPageHeader, McpServerDialog, McpServersPanel } from '@overlay/modules-react/extensions'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useLiveMcpServers } from '@/hooks/use-connections'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'

interface DialogState {
  mode: 'create' | 'edit'
  server?: McpServerSummary
}

export default function McpServersView({ userId: _userId }: { userId: string }) {
  void _userId
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const scope = usePanelScope()
  const listView = usePanelListView()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))

  // Live: configuration and connection state, including OAuth finished in another tab, arrive without reloading.
  const live = useLiveMcpServers(listView)
  // A quick toggle shows at once and gives way to the live value when the server answers.
  const [toggles, setToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const servers = useMemo<McpServerSummary[]>(() => (live ?? []).map((server) => (
    toggles.has(server._id) ? setMcpServerEnabled(server, toggles.get(server._id)!) : server
  )), [live, toggles])
  const loading = live === undefined

  const filteredServers = useMemo(
    () => filterMcpServers(servers, searchQuery),
    [servers, searchQuery],
  )

  async function failure(response: Response, fallback: string): Promise<McpMutationResult> {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null
    return { ok: false, error: formatMcpMutationError(payload, fallback) }
  }

  async function handleSaveServer(values: McpServerFormValues): Promise<McpMutationResult> {
    if (dialog?.mode === 'edit' && dialog.server) {
      const res = await overlayAppClient.mcpServers.updateResponse(createMcpUpdateRequest(dialog.server._id, values))
      if (!res.ok) return failure(res, 'Could not save this MCP server.')
      return { ok: true }
    }

    const res = await overlayAppClient.mcpServers.createResponse({ ...createMcpCreateRequest(values), scope: newItemScope(scope) })
    if (!res.ok) return failure(res, 'Could not add this MCP server.')
    return { ok: true }
  }

  /**
   * OAuth needs a persisted server to attach tokens to, so Connect saves first when the dialog is
   * in create mode. The blank tab is opened before any await so Safari/Chrome treat the navigation
   * as user-initiated rather than a blocked popup — same approach as the connectors view.
   */
  async function handleConnectOAuth(values: McpServerFormValues): Promise<McpMutationResult> {
    const oauthTab = window.open('about:blank', '_blank')
    try {
      let mcpServerId = dialog?.mode === 'edit' ? dialog.server?._id : undefined

      if (!mcpServerId) {
        const created = await overlayAppClient.mcpServers.createResponse({ ...createMcpCreateRequest(values), scope: newItemScope(scope) })
        if (!created.ok) {
          oauthTab?.close()
          return failure(created, 'Could not save this MCP server.')
        }
        const { id } = (await created.json()) as { id: string }
        mcpServerId = id
        setDialog({ mode: 'edit', server: createMcpSummaryFromForm(id, values) })
      } else {
        const updated = await overlayAppClient.mcpServers.updateResponse(
          createMcpUpdateRequest(mcpServerId, values),
        )
        if (!updated.ok) {
          oauthTab?.close()
          return failure(updated, 'Could not save this MCP server.')
        }
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
  }

  async function handleDisconnectOAuth(server: McpServerSummary): Promise<McpMutationResult> {
    const res = await overlayAppClient.mcpServers.disconnectOAuthResponse({ mcpServerId: server._id })
    if (!res.ok) return failure(res, 'Could not disconnect this server.')
    return { ok: true }
  }

  async function handleDeleteServer(server: McpServerSummary): Promise<McpMutationResult> {
    const res = await overlayAppClient.mcpServers.deleteResponse({ mcpServerId: server._id })
    if (!res.ok) return failure(res, 'Could not delete this MCP server.')
    return { ok: true }
  }

  async function handleTestServer(values: McpServerFormValues): Promise<McpTestResultState> {
    try {
      const mcpServerId = dialog?.mode === 'edit' ? dialog.server?._id : undefined
      const res = await overlayAppClient.mcpServers.testResponse(
        createMcpTestRequest(values, mcpServerId ? { mcpServerId } : undefined),
      )
      const data = await res.json().catch(() => ({ error: 'Invalid response' })) as TestMcpServerResponse
      return formatMcpTestResult(data, res.ok)
    } catch {
      return { ok: false, message: 'Connection failed' }
    }
  }

  async function handleQuickToggle(server: McpServerSummary, event: MouseEvent) {
    event.stopPropagation()
    const newEnabled = !server.enabled
    setToggles((current) => new Map(current).set(server._id, newEnabled))
    try {
      await overlayAppClient.mcpServers.updateResponse({ mcpServerId: server._id, enabled: newEnabled })
    } catch {
      // The live value shows again below.
    } finally {
      setToggles((current) => {
        const next = new Map(current)
        next.delete(server._id)
        return next
      })
    }
  }

  return (
    <AppScreenShell
      header={
        <ExtensionPageHeader
          title="MCP Servers"
          tabs={<PageSubviewTabs />}
          searchQuery={searchQuery}
          searchPlaceholder="Search servers…"
          searchTitle="Search servers"
          action={canAdd ? (
            <Button variant="primary" size="sm"
              onClick={() => setDialog({ mode: 'create' })}
            >
              <Plus size={12} />
              Add Server
            </Button>
          ) : undefined}
          onSearchQueryChange={setSearchQuery}
        />
      }
    >
      <McpServersPanel
        loading={loading}
        servers={servers}
        filteredServers={filteredServers}
        onCreate={canAdd ? () => setDialog({ mode: 'create' }) : undefined}
        onEdit={(server) => setDialog({ mode: 'edit', server })}
        onToggle={(server, event) => void handleQuickToggle(server, event)}
      />

      {dialog ? (
        <McpServerDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSave={handleSaveServer}
          onDelete={handleDeleteServer}
          onTest={handleTestServer}
          onConnectOAuth={handleConnectOAuth}
          onDisconnectOAuth={handleDisconnectOAuth}
          scopeActions={dialog.mode === 'edit' && dialog.server ? (
            <ScopeItemActions
              kind="extension"
              resource="mcp-servers"
              item={dialog.server}
              variant="buttons"
              onChanged={() => setDialog(null)}
            />
          ) : undefined}
        />
      ) : null}
    </AppScreenShell>
  )
}
