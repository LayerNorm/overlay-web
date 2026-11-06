'use client'

import { AppScreenBody } from '@overlay/modules-react/shell'
import { Badge, Toggle } from '@overlay/ui'
import { Button } from '@overlay/ui/primitives'
import { Loader2, Plus, Server, Wrench } from 'lucide-react'
import type { NativeMcpSummary } from '../hooks/use-native-mcp-servers'

export function NativeMcpServerList({
  native,
  servers,
  filteredServers,
  dialogLoading,
  dialogMissing,
  dialogProblem,
  canAdd,
  userId,
  role,
  onAdd,
  onCloseProblem,
  onManage,
  onToggle,
}: {
  native: { loading: boolean; hasMore: boolean; loadingMore: boolean; loadMore: () => void }
  servers: NativeMcpSummary[]
  filteredServers: NativeMcpSummary[]
  dialogLoading: boolean
  dialogMissing: boolean
  dialogProblem: string | null
  canAdd: boolean
  userId?: string
  role?: string
  onAdd: () => void
  onCloseProblem: () => void
  onManage: (server: NativeMcpSummary) => void
  onToggle: (server: NativeMcpSummary) => Promise<void>
}) {
  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      {dialogLoading ? (
        <div role="status" className="m-6 rounded-lg border border-(--border) bg-(--surface-elevated) px-4 py-3 text-sm text-(--muted)">
          Loading this MCP server settings…
        </div>
      ) : null}
      {dialogMissing ? (
        <div role="alert" className="m-6 flex items-center justify-between gap-4 rounded-lg border border-(--border) bg-(--surface-elevated) px-4 py-3 text-sm text-(--muted)">
          <span>{dialogProblem}</span>
          <Button variant="secondary" size="sm" onClick={onCloseProblem}>Close</Button>
        </div>
      ) : null}
      {native.loading ? (
        <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-(--muted)" /></div>
      ) : servers.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <Server size={40} strokeWidth={1} className="text-(--muted-light)" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-(--foreground)">No MCP servers configured</p>
            <p className="text-xs text-(--muted-light)">Add remote MCP servers to extend the AI agent with custom tools.</p>
          </div>
          {canAdd ? <Button variant="secondary" size="md" type="button" onClick={onAdd}><Plus size={14} />Add Server</Button> : null}
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="p-6 text-sm text-(--muted)">No MCP servers match this search.</div>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-6 py-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredServers.map((server) => (
            <NativeMcpServerCard
              key={server._id}
              server={server}
              canEdit={server.userId === userId || role === 'owner' || role === 'admin'}
              onManage={onManage}
              onToggle={onToggle}
            />
          ))}
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
  )
}

function NativeMcpServerCard({
  server,
  canEdit,
  onManage,
  onToggle,
}: {
  server: NativeMcpSummary
  canEdit: boolean
  onManage: (server: NativeMcpSummary) => void
  onToggle: (server: NativeMcpSummary) => Promise<void>
}) {
  const connected = server.authType === 'oauth' && server.oauthStatus === 'connected'
  const error = Boolean(server.oauthError || server.toolCatalogError) || server.oauthStatus === 'needs_reauth'
  const status = server.archivedAt !== undefined ? 'Archived' : !server.enabled ? 'Inactive' : error ? 'Connection error' : connected ? 'Connected' : server.authType === 'oauth' ? 'Not connected' : 'Active'
  const statusVariant = error ? 'danger' : connected ? 'success' : 'muted'
  let host = server.url
  try { host = new URL(server.url).hostname } catch { /* The redacted endpoint is safe to display. */ }
  return (
    <article className="flex flex-col gap-4 overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
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
          onCheckedChange={() => void onToggle(server)}
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
        <Button variant="ghost" size="sm" className="text-(--foreground)" aria-label={`Manage ${server.name}`} onClick={() => onManage(server)}>
          Manage
        </Button>
      </div>
    </article>
  )
}
