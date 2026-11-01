'use client'
import type {
McpAuthType,
McpMutationResult,
McpServerFormValues,
McpServerSummary,
McpTestResultState,
McpToolPolicyMode,
McpTransport
} from '@overlay/app-core'
import { mcpServerToFormValues } from '@overlay/app-core/extensions'
import {
AlertCircle,
Check,
Link2,
Loader2,
Plus,
Server,
Wrench,
Zap
} from 'lucide-react'
import { useState,type MouseEvent,type ReactNode } from 'react'
import { Badge, Button, Input, Tabs, TabsTriggerList as TabsList, TabsTrigger, TabsContent } from '@overlay/ui'

import { DeleteExtensionButton, ExtensionCard, ExtensionDialog, Field, FieldSelect } from './shared'
import { AppScreenBody } from '../shell'

export type McpDialogMutationOutcome = boolean | void | McpMutationResult

export interface McpServerDialogProps {
  state: { mode: 'create' | 'edit'; server?: McpServerSummary }
  onClose: () => void
  onSave: (values: McpServerFormValues) => Promise<McpDialogMutationOutcome>
  onDelete: (server: McpServerSummary) => Promise<McpDialogMutationOutcome>
  onTest: (values: McpServerFormValues) => Promise<McpTestResultState>
  /**
   * Saves the server if needed, then starts the OAuth flow. OAuth needs a persisted record to hang
   * tokens off, so the dialog never asks the user to save first — it does both behind one button.
   */
  onConnectOAuth?: (values: McpServerFormValues) => Promise<McpMutationResult>
  onDisconnectOAuth?: (server: McpServerSummary) => Promise<McpMutationResult>
  /** Move and archive controls for an existing server, supplied by the host (they depend on who is viewing). */
  scopeActions?: ReactNode
}

type FormValuesUpdate = <Key extends keyof McpServerFormValues>(key: Key, value: McpServerFormValues[Key]) => void

function readMutationOutcome(outcome: McpDialogMutationOutcome): { ok: boolean; error?: string } {
  if (outcome && typeof outcome === 'object') return { ok: outcome.ok, error: outcome.error }
  return { ok: outcome !== false }
}

async function saveMcpServer({
  saving,
  isEdit,
  values,
  onSave,
  onClose,
  setSaving,
  setSaved,
  setMutationError,
}: {
  saving: boolean
  isEdit: boolean
  values: McpServerFormValues
  onSave: McpServerDialogProps['onSave']
  onClose: () => void
  setSaving: (value: boolean) => void
  setSaved: (value: boolean) => void
  setMutationError: (error: string | null) => void
}) {
  if (saving) return
  if (!values.name.trim() || !values.url.trim()) return
  setSaving(true)
  setMutationError(null)
  try {
    const outcome = readMutationOutcome(await onSave(values))
    if (!outcome.ok) {
      setMutationError(outcome.error || (isEdit ? 'Could not save this MCP server.' : 'Could not add this MCP server.'))
      return
    }
    setSaved(true)
    window.setTimeout(() => {
      setSaved(false)
      onClose()
    }, 800)
  } catch {
    setMutationError(isEdit ? 'Could not save this MCP server.' : 'Could not add this MCP server.')
  } finally {
    setSaving(false)
  }
}

async function deleteMcpServer({
  isEdit,
  initial,
  deleting,
  onDelete,
  onClose,
  setDeleting,
  setMutationError,
}: {
  isEdit: boolean
  initial: McpServerSummary | undefined
  deleting: boolean
  onDelete: McpServerDialogProps['onDelete']
  onClose: () => void
  setDeleting: (value: boolean) => void
  setMutationError: (error: string | null) => void
}) {
  if (!isEdit || !initial || deleting) return
  setDeleting(true)
  setMutationError(null)
  try {
    const outcome = readMutationOutcome(await onDelete(initial))
    if (outcome.ok) onClose()
    else setMutationError(outcome.error || 'Could not delete this MCP server.')
  } catch {
    setMutationError('Could not delete this MCP server.')
  } finally {
    setDeleting(false)
  }
}

async function testMcpServerConnection({
  testing,
  values,
  onTest,
  setTesting,
  setTestResult,
  setMutationError,
}: {
  testing: boolean
  values: McpServerFormValues
  onTest: McpServerDialogProps['onTest']
  setTesting: (value: boolean) => void
  setTestResult: (result: McpTestResultState | null) => void
  setMutationError: (error: string | null) => void
}) {
  if (testing || !values.url.trim()) return
  setTesting(true)
  setTestResult(null)
  setMutationError(null)
  try {
    setTestResult(await onTest(values))
  } finally {
    setTesting(false)
  }
}

async function connectMcpServerOAuth({
  connecting,
  values,
  onConnectOAuth,
  setConnecting,
  setMutationError,
}: {
  connecting: boolean
  values: McpServerFormValues
  onConnectOAuth: McpServerDialogProps['onConnectOAuth']
  setConnecting: (value: boolean) => void
  setMutationError: (error: string | null) => void
}) {
  if (connecting || !onConnectOAuth) return
  if (!values.name.trim() || !values.url.trim()) {
    setMutationError('Add a name and URL before connecting.')
    return
  }
  setConnecting(true)
  setMutationError(null)
  try {
    const result = await onConnectOAuth(values)
    if (!result.ok) setMutationError(result.error || 'Could not start the OAuth flow.')
  } catch {
    setMutationError('Could not start the OAuth flow.')
  } finally {
    setConnecting(false)
  }
}

async function disconnectMcpServerOAuth({
  connecting,
  initial,
  onDisconnectOAuth,
  onClose,
  setConnecting,
  setMutationError,
}: {
  connecting: boolean
  initial: McpServerSummary | undefined
  onDisconnectOAuth: McpServerDialogProps['onDisconnectOAuth']
  onClose: () => void
  setConnecting: (value: boolean) => void
  setMutationError: (error: string | null) => void
}) {
  if (connecting || !onDisconnectOAuth || !initial) return
  setConnecting(true)
  setMutationError(null)
  try {
    const result = await onDisconnectOAuth(initial)
    if (!result.ok) setMutationError(result.error || 'Could not disconnect this server.')
    else onClose()
  } finally {
    setConnecting(false)
  }
}

function McpServerFormFields({ values, update }: { values: McpServerFormValues; update: FormValuesUpdate }) {
  return (
    <>
      <Field label="Name">
        <Input aria-label="Name" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. My API Server" />
      </Field>
      <Field label="Description">
        <Input aria-label="Description" value={values.description} onChange={(event) => update('description', event.target.value)} placeholder="Optional description" />
      </Field>
      <Field label="Server URL">
        <Input aria-label="Server URL" value={values.url} onChange={(event) => update('url', event.target.value)} placeholder="https://example.com/mcp" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Transport">
          <FieldSelect aria-label="Transport" value={values.transport} onChange={(value) => update('transport', value as McpTransport)} options={[{ value: 'streamable-http', label: 'Streamable HTTP' }, { value: 'sse', label: 'SSE' }]} />
        </Field>
        <Field label="Authentication">
          <FieldSelect aria-label="Authentication" value={values.authType} onChange={(value) => update('authType', value as McpAuthType)} options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer token' }, { value: 'header', label: 'Custom header' }, { value: 'oauth', label: 'OAuth' }]} />
        </Field>
      </div>
    </>
  )
}

function McpOAuthSection({
  oauthStatus,
  oauthError,
  connecting,
  canConnect,
  canDisconnect,
  onConnect,
  onDisconnect,
}: {
  oauthStatus: McpServerSummary['oauthStatus']
  oauthError: string | undefined
  connecting: boolean
  canConnect: boolean
  canDisconnect: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="space-y-2 py-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-(--foreground)">
            {oauthStatus === 'connected'
              ? 'Connected'
              : oauthStatus === 'needs_reauth'
                ? 'Needs reconnect'
                : 'Not connected'}
          </p>
          <p className="mt-0.5 text-[11px] text-(--muted)">
            {oauthStatus === 'connected'
              ? 'Overlay holds an authorized session for this server.'
              : 'Opens the server’s sign-in page in a new tab. No API key needed.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canDisconnect ? (
            <Button variant="ghost" type="button" onClick={onDisconnect} disabled={connecting}>
              Disconnect
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" type="button" onClick={onConnect} disabled={connecting || !canConnect}>
            {connecting ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            {connecting ? 'Opening…' : oauthStatus === 'connected' ? 'Reconnect' : 'Connect'}
          </Button>
        </div>
      </div>
      {oauthError ? (
        <p className="mt-2 text-[11px] text-red-400">{oauthError}</p>
      ) : null}
    </div>
  )
}

function McpAuthSecretFields({ values, update }: { values: McpServerFormValues; update: FormValuesUpdate }) {
  return (
    <>
      {values.authType === 'bearer' ? (
        <Field label="Bearer Token">
          <Input type="password" aria-label="Bearer token" value={values.bearerToken} onChange={(event) => update('bearerToken', event.target.value)} placeholder="Bearer token" />
        </Field>
      ) : null}
      {values.authType === 'header' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Header Name">
            <Input aria-label="Header name" value={values.headerName} onChange={(event) => update('headerName', event.target.value)} placeholder="X-Api-Key" />
          </Field>
          <Field label="Header Value">
            <Input type="password" aria-label="Header value" value={values.headerValue} onChange={(event) => update('headerValue', event.target.value)} placeholder="Secret value" />
          </Field>
        </div>
      ) : null}
    </>
  )
}

function McpDialogBanners({
  testResult,
  isOAuth,
  mutationError,
  onSwitchToOAuth,
}: {
  testResult: McpTestResultState | null
  isOAuth: boolean
  mutationError: string | null
  onSwitchToOAuth: () => void
}) {
  return (
    <>
      {testResult ? (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
          <span>
            {testResult.message}
            {testResult.requiresAuth && !isOAuth ? (
              <Button variant="ghost" type="button" onClick={onSwitchToOAuth}>
                Switch to OAuth
              </Button>
            ) : null}
          </span>
        </div>
      ) : null}
      {mutationError ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{mutationError}</span>
        </div>
      ) : null}
    </>
  )
}

function McpServerDialogFooter({
  isEdit,
  initial,
  busy,
  saving,
  saved,
  values,
  onClose,
  onSave,
  onDelete,
}: {
  isEdit: boolean
  initial: McpServerSummary | undefined
  busy: boolean
  saving: boolean
  saved: boolean
  values: McpServerFormValues
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}) {
  return (
    <>
      <div>{isEdit && initial ? <DeleteExtensionButton name={initial.name || 'this server'} kind="server" disabled={busy} onConfirm={onDelete} /> : null}</div>
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={busy || !values.name.trim() || !values.url.trim()}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saving ? 'Saving...' : saved ? 'Saved' : isEdit ? 'Save changes' : 'Add server'}
        </Button>
      </div>
    </>
  )
}

export function McpServerDialog({
  state,
  onClose,
  onSave,
  onDelete,
  onTest,
  onConnectOAuth,
  onDisconnectOAuth,
  scopeActions,
}: McpServerDialogProps) {
  const isEdit = state.mode === 'edit'
  const initial = state.server
  const scopeLabel = initial?.archivedAt !== undefined ? 'Archived' : (initial?.scope ?? 'personal') === 'workspace' ? 'Shared with the workspace' : 'Only you'
  const [values, setValues] = useState<McpServerFormValues>(() => mcpServerToFormValues(initial))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResultState | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const isOAuth = values.authType === 'oauth'
  const oauthStatus = initial?.oauthStatus

  const update: FormValuesUpdate = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setMutationError(null)
  }

  const busy = saving || deleting || connecting || testing || saved
  const handleSave = () => saveMcpServer({ saving: busy, isEdit, values, onSave, onClose, setSaving, setSaved, setMutationError })
  const handleDelete = () => deleteMcpServer({ isEdit, initial, deleting: busy, onDelete, onClose, setDeleting, setMutationError })
  const handleTest = () => testMcpServerConnection({ testing: busy, values, onTest, setTesting, setTestResult, setMutationError })
  const handleConnectOAuth = () => connectMcpServerOAuth({ connecting: busy, values, onConnectOAuth, setConnecting, setMutationError })
  const handleDisconnectOAuth = () => disconnectMcpServerOAuth({ connecting: busy, initial, onDisconnectOAuth, onClose, setConnecting, setMutationError })

  return (
    <ExtensionDialog
      title={isEdit ? initial?.name || 'MCP server' : 'Add MCP server'}
      description="Give your agents access to external tools."
      icon={<Server size={20} strokeWidth={1.6} />}
      onClose={onClose} busy={busy}
      enabled={values.enabled} onEnabledChange={enabled => update('enabled', enabled)}
      activeDescription="Make this server available to your agents."
      scopeActions={isEdit ? scopeActions : undefined} scopeLabel={scopeLabel}
      footer={<McpServerDialogFooter
        isEdit={isEdit} initial={initial} busy={busy} saving={saving} saved={saved} values={values}
        onClose={onClose} onSave={() => void handleSave()} onDelete={() => void handleDelete()}
      />}
    >
      <Tabs defaultValue="configuration">
        <TabsList className="mb-5"><TabsTrigger value="configuration">Configuration</TabsTrigger><TabsTrigger value="tools">Tools</TabsTrigger></TabsList>
        <TabsContent value="configuration" className="space-y-5">
          <McpServerFormFields values={values} update={update} />
          <McpAuthSecretFields values={values} update={update} />
          {isOAuth ? <McpOAuthSection
            oauthStatus={oauthStatus} oauthError={initial?.oauthError}
            connecting={connecting} canConnect={Boolean(onConnectOAuth) && !busy}
            canDisconnect={oauthStatus === 'connected' && Boolean(onDisconnectOAuth) && !busy}
            onConnect={() => void handleConnectOAuth()} onDisconnect={() => void handleDisconnectOAuth()}
          /> : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-(--muted)">Check the server connection.</p>
            <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={busy || !values.url.trim()}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {testing ? 'Testing...' : 'Test connection'}
            </Button>
          </div>
          <Field label="Timeout (ms)">
            <Input type="number" aria-label="Timeout (ms)" value={values.timeoutMs} onChange={event => update('timeoutMs', event.target.value === '' ? '' : Number(event.target.value))} placeholder="30000" />
          </Field>
        </TabsContent>
        <TabsContent value="tools" className="space-y-5">
          <p className="text-sm text-(--muted)">Choose how agents can use tools from this server.</p>
      <Field label="Tool execution policy">
        <FieldSelect aria-label="Tool execution policy" value={values.defaultToolPolicy} onChange={(value) => update('defaultToolPolicy', value as McpToolPolicyMode)} options={[{ value: 'allow', label: 'Allow tools' }, { value: 'approval_required', label: 'Require approval' }, { value: 'deny', label: 'Deny tools' }]} />
      </Field>
          {initial?.toolCatalogCount !== undefined ? <p className="text-sm text-(--muted)">{initial.toolCatalogCount} tools discovered</p> : null}
          {initial?.toolCatalogError ? <p role="status" className="text-xs text-red-500">{initial.toolCatalogError}</p> : null}
        </TabsContent>
      </Tabs>
      <McpDialogBanners testResult={testResult} isOAuth={isOAuth} mutationError={mutationError} onSwitchToOAuth={() => update('authType', 'oauth')} />
    </ExtensionDialog>
  )
}

export interface McpServersPanelProps {
  loading: boolean
  servers: readonly McpServerSummary[]
  filteredServers: readonly McpServerSummary[]
  /** Omitted when the person may not create here (the empty state then offers no button). */
  onCreate?: () => void
  onEdit: (server: McpServerSummary) => void
  onToggle: (server: McpServerSummary, event: MouseEvent) => void
}

export function McpServersPanel({ loading, servers, filteredServers, onCreate, onEdit }: McpServersPanelProps) {
  if (loading) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-(--muted)" />
      </AppScreenBody>
    )
  }

  if (servers.length === 0) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Server size={40} strokeWidth={1} className="text-(--muted-light)" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-(--foreground)">No MCP servers configured</p>
          <p className="text-xs text-(--muted-light)">Add remote MCP servers to extend the AI agent with custom tools</p>
        </div>
        {onCreate ? <Button variant="secondary" size="md" type="button" onClick={onCreate}><Plus size={14} />Add Server</Button> : null}
      </AppScreenBody>
    )
  }

  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredServers.map((server) => (
            <McpServerCard key={server._id} server={server} onEdit={onEdit} />
          ))}
        </div>
      </div>
    </AppScreenBody>
  )
}

function McpServerCard({ server, onEdit }: { server: McpServerSummary; onEdit: (server: McpServerSummary) => void }) {
  const error = Boolean(server.toolCatalogError) || server.oauthStatus === 'needs_reauth'
  const connected = server.authType === 'oauth' && server.oauthStatus === 'connected'
  const status = !server.enabled ? 'Inactive' : error ? 'Connection error' : connected ? 'Connected' : server.authType === 'oauth' ? 'Not connected' : 'Active'
  let host = server.url
  try { host = new URL(server.url).hostname } catch { /* Keep invalid saved URLs visible for correction. */ }

  return <ExtensionCard
    icon={<Server size={20} strokeWidth={1.6} />}
    title={server.name || 'Untitled'}
    description={server.description || server.url}
    status={status}
    statusTone={!server.enabled ? 'muted' : error ? 'error' : connected ? 'connected' : server.authType === 'oauth' ? 'muted' : 'active'}
    metadata={<>
      <Wrench size={14} /><span>{server.toolCatalogCount === undefined ? 'Tools not discovered' : `${server.toolCatalogCount} tools`}</span>
      <Badge variant="muted">{server.transport === 'sse' ? 'SSE' : 'HTTP'}</Badge>
      {server.authType !== 'none' ? <Badge variant="muted">{server.authType === 'oauth' ? 'OAuth' : 'Authenticated'}</Badge> : null}
    </>}
    detail={host}
    onEdit={() => onEdit(server)}
  >
    {server.toolCatalogError ? <p className="line-clamp-2 text-xs text-red-500" title={server.toolCatalogError}>Tools unavailable: {server.toolCatalogError}</p> : null}
  </ExtensionCard>
}
