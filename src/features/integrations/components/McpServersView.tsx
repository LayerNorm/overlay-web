'use client'
import { toast } from '@overlay/ui/primitives'

// MCP contracts/controllers live in @overlay/app-core; shared React presentation lives in @overlay/modules-react.
import { useMemo, useState } from 'react'
import { Eye, Globe, Pencil, Server, Trash2 } from 'lucide-react'
import {
  createMcpCreateRequest,
  createMcpSummaryFromForm,
  createMcpTestRequest,
  createMcpUpdateRequest,
  formatMcpMutationError,
  formatMcpTestResult,
  type McpMutationResult,
  type McpServerFormValues,
  type McpServerSummary,
  type McpTestResultState,
  type TestMcpServerResponse,
} from '@overlay/app-core'
import { MCP_CATALOG, MCP_CATEGORIES, groupExtensionCatalog, normalizeMcpServerUrl, type McpCatalogEntry } from '@overlay/app-core/extensions'
import { ExtensionCatalogDeleteDialog, ExtensionCatalogPage, McpServerDialog, type ExtensionCatalogEntry } from '@overlay/modules-react/extensions'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useLiveMcpServers } from '@/hooks/use-connections'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope, scopeForNewItem } from '@/shared/workspaces/panel-scope'
import { ExtensionsScreen } from '@/components/layout/extensions/ExtensionsScreen'
import { useExtensionsIntent, useExtensionsRoute } from '@/hooks/use-extensions-route'

interface DialogState {
  mode: 'create' | 'edit'
  server?: McpServerSummary
  preset?: Partial<McpServerFormValues>
}

/** One-line state for a server that needs attention; healthy servers show none. */
function serverStatus(server: McpServerSummary): ExtensionCatalogEntry['status'] {
  if (!server.enabled) return { label: 'Off' }
  if (server.toolCatalogError || server.oauthStatus === 'needs_reauth') return { label: 'Connection error', tone: 'error' }
  if (server.authType === 'oauth' && server.oauthStatus !== 'connected') return { label: 'Not connected' }
  return undefined
}

function serverHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export default function McpServersView({ userId: _userId }: { userId: string }) {
  void _userId
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [deleting, setDeleting] = useState<McpServerSummary | null>(null)
  const route = useExtensionsRoute()
  const scope = usePanelScope()
  const listView = usePanelListView()
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('extension', scopeForNewItem(scope))

  // Live: configuration and connection state, including OAuth finished in another tab, arrive without reloading.
  const live = useLiveMcpServers(listView)
  const servers = useMemo<McpServerSummary[]>(() => live ?? [], [live])
  const loading = live === undefined
  // Servers this person may use but not change; their dialog opens view-only and the quick toggle does nothing.
  const readOnlyIds = useMemo(() => new Set((live ?? []).filter((server) => !server.canEdit).map((server) => server._id)), [live])

  // Global search and other Extensions pages link here with ?id= (open that server) or ?add=1 (new server).
  useExtensionsIntent<DialogState>(route, ({ add, id }) => {
    if (add) return canAdd ? { mode: 'create' } : null
    if (loading) return undefined
    const server = servers.find((item) => item._id === id)
    return server ? { mode: 'edit', server } : null
  }, setDialog)

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

  const serverEntry = (server: McpServerSummary, catalog?: McpCatalogEntry): ExtensionCatalogEntry => ({
    id: catalog?.id ?? server._id,
    name: server.name || catalog?.name || 'Untitled',
    description: server.description || catalog?.description || serverHost(server.url),
    logo: { kind: 'image', src: catalog?.logoUrl, darkSrc: catalog?.logoDarkUrl, invertInDark: catalog?.logoInvertInDark },
    status: serverStatus(server),
    onOpen: () => setDialog({ mode: 'edit', server }),
    menu: readOnlyIds.has(server._id)
      ? [{ label: 'View', icon: Eye, onSelect: () => setDialog({ mode: 'edit', server }) }]
      : [{ label: 'Edit', icon: Pencil, onSelect: () => setDialog({ mode: 'edit', server }) }, { label: 'Delete', icon: Trash2, onSelect: () => setDeleting(server) }],
  })

  const findServer = (catalog: McpCatalogEntry) => servers.find((server) => normalizeMcpServerUrl(server.url) === normalizeMcpServerUrl(catalog.url))

  const catalogEntry = (catalog: McpCatalogEntry): ExtensionCatalogEntry => {
    const added = findServer(catalog)
    if (added) return serverEntry(added, catalog)
    const open = () => setDialog({
      mode: 'create',
      preset: { name: catalog.name, description: catalog.description, url: catalog.url, transport: catalog.transport, authType: catalog.authType },
    })
    return {
      id: catalog.id,
      name: catalog.name,
      description: catalog.description,
      logo: { kind: 'image', src: catalog.logoUrl, darkSrc: catalog.logoDarkUrl, invertInDark: catalog.logoInvertInDark },
      onOpen: open,
      onAdd: canAdd ? open : undefined,
    }
  }

  const browse = groupExtensionCatalog(MCP_CATALOG, MCP_CATEGORIES, (catalog) => catalog.id)
    .map((section) => ({ ...section, items: section.items.map(catalogEntry) }))
  const catalogFor = (server: McpServerSummary) => MCP_CATALOG.find((catalog) => normalizeMcpServerUrl(catalog.url) === normalizeMcpServerUrl(server.url))
  const fromCatalog = servers.filter((server) => catalogFor(server))
  const custom = servers.filter((server) => !catalogFor(server))
  const yours = [
    { id: 'connected', title: 'Connected', items: fromCatalog.map((server) => serverEntry(server, catalogFor(server))) },
    { id: 'created', title: scope === 'workspace' ? 'Shared in workspace' : 'Created by you', items: custom.map((server) => serverEntry(server)) },
  ]
  const openSection = route.category ? browse.find((section) => section.id === route.category) : undefined
  const addServer = () => setDialog({ mode: 'create' })

  return (
    <ExtensionsScreen title="MCPs" sectionTitle={openSection?.title} overviewHref={route.overviewHref}>
      <ExtensionCatalogPage
        title="MCPs"
        subtitle="Connect any MCP server to give agents new tools."
        noun="MCP servers"
        icon={Server}
        yoursLabel={scope === 'workspace' ? 'Workspace' : 'Yours'}
        loading={loading}
        browse={browse}
        yours={yours}
        yoursEmpty={{ title: 'No MCP servers yet', body: 'Connected and custom MCP servers will appear here.' }}
        addOptions={canAdd ? [{ id: 'url', label: 'Remote server (URL)', icon: Globe, onSelect: addServer }] : undefined}
        category={route.category}
        onCategoryChange={route.openCategory}
        noResults={canAdd
          ? { body: 'Check the spelling, or add any server by its URL.', action: { label: 'Add a server', onSelect: addServer } }
          : { body: 'Check the spelling and try again.' }}
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
          readOnly={dialog.mode === 'edit' && Boolean(dialog.server && readOnlyIds.has(dialog.server._id))}
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
      {deleting ? (
        <ExtensionCatalogDeleteDialog
          name={deleting.name || 'this server'}
          kind="server"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const server = deleting
            setDeleting(null)
            void handleDeleteServer(server).then((result) => result.ok ? toast(`${server.name || 'Server'} deleted`) : toast.error(result.error || 'Could not delete this MCP server.'))
          }}
        />
      ) : null}
    </ExtensionsScreen>
  )
}
