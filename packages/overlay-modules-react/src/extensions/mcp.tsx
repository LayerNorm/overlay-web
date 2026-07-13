'use client'

import type {
McpAuthType,
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
Pencil,
Plus,
Server,
ToggleLeft,
ToggleRight,
Trash2,
X,
Zap
} from 'lucide-react'
import { useState,type MouseEvent } from 'react'

import { Field } from './shared'
import { AppScreenBody } from '../shell'

export interface McpServerDialogProps {
  state: { mode: 'create' | 'edit'; server?: McpServerSummary }
  onClose: () => void
  onSave: (values: McpServerFormValues) => Promise<boolean | void>
  onDelete: (server: McpServerSummary) => Promise<boolean | void>
  onTest: (values: McpServerFormValues) => Promise<McpTestResultState>
}

export function McpServerDialog({ state, onClose, onSave, onDelete, onTest }: McpServerDialogProps) {
  const isEdit = state.mode === 'edit'
  const initial = state.server
  const [values, setValues] = useState<McpServerFormValues>(() => mcpServerToFormValues(initial))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResultState | null>(null)

  const update = <Key extends keyof McpServerFormValues>(key: Key, value: McpServerFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (saving) return
    if (!values.name.trim() || !values.url.trim()) return
    setSaving(true)
    try {
      const ok = await onSave(values)
      if (ok === false) return
      setSaved(true)
      window.setTimeout(() => {
        setSaved(false)
        onClose()
      }, 800)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEdit || !initial || deleting) return
    setDeleting(true)
    try {
      const ok = await onDelete(initial)
      if (ok !== false) onClose()
    } finally {
      setDeleting(false)
    }
  }

  async function handleTest() {
    if (testing || !values.url.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await onTest(values))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="overlay-dialog-in flex w-full max-w-xl flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl" style={{ maxHeight: 'calc(100vh - 80px)' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{isEdit ? 'Edit MCP Server' : 'Add MCP Server'}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><X size={16} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Field label="Name">
            <input value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. My API Server" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
          </Field>
          <Field label="Description">
            <input value={values.description} onChange={(event) => update('description', event.target.value)} placeholder="Optional description" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Transport">
              <select value={values.transport} onChange={(event) => update('transport', event.target.value as McpTransport)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]"><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select>
            </Field>
            <Field label="Timeout (ms)">
              <input type="number" value={values.timeoutMs} onChange={(event) => update('timeoutMs', event.target.value === '' ? '' : Number(event.target.value))} placeholder="30000" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
            </Field>
          </div>
          <Field label="URL">
            <input value={values.url} onChange={(event) => update('url', event.target.value)} placeholder="https://example.com/mcp or http://localhost:3000/mcp" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
            <p className="text-[10px] text-[var(--muted-light)]">HTTPS required in production. HTTP allowed for localhost only.</p>
          </Field>
          <Field label="Authentication">
            <select value={values.authType} onChange={(event) => update('authType', event.target.value as McpAuthType)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]"><option value="none">None</option><option value="bearer">Bearer Token</option><option value="header">Custom Header</option></select>
          </Field>
          <Field label="Tool execution policy">
            <select value={values.defaultToolPolicy} onChange={(event) => update('defaultToolPolicy', event.target.value as McpToolPolicyMode)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]">
              <option value="allow">Allow tools</option>
              <option value="approval_required">Require approval</option>
              <option value="deny">Deny tools</option>
            </select>
          </Field>
          {values.authType === 'bearer' ? (
            <Field label="Bearer Token">
              <input type="password" value={values.bearerToken} onChange={(event) => update('bearerToken', event.target.value)} placeholder="Bearer token" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
            </Field>
          ) : null}
          {values.authType === 'header' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Header Name">
                <input value={values.headerName} onChange={(event) => update('headerName', event.target.value)} placeholder="X-Api-Key" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
              </Field>
              <Field label="Header Value">
                <input type="password" value={values.headerValue} onChange={(event) => update('headerValue', event.target.value)} placeholder="Secret value" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] focus:bg-[var(--surface-elevated)]" />
              </Field>
            </div>
          ) : null}
          {testResult ? (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${testResult.ok ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border border-red-500/20 bg-red-500/10 text-red-400'}`}>
              {testResult.ok ? <Check size={12} /> : <AlertCircle size={12} />}
              <span>{testResult.message}</span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => update('enabled', !values.enabled)} className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
              {values.enabled ? <ToggleRight size={18} className="text-[var(--foreground)]" /> : <ToggleLeft size={18} className="text-[var(--muted-light)]" />}
              <span>{values.enabled ? 'Active' : 'Disabled'}</span>
            </button>
            {isEdit && initial ? (
              <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-red-400 disabled:opacity-50">
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void handleTest()} disabled={testing || !values.url.trim()} className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50">
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || !values.name.trim() || !values.url.trim()} className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
              {saving ? 'Saving…' : saved ? 'Saved' : isEdit ? 'Save' : 'Add Server'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface McpServersPanelProps {
  loading: boolean
  servers: readonly McpServerSummary[]
  filteredServers: readonly McpServerSummary[]
  onCreate: () => void
  onEdit: (server: McpServerSummary) => void
  onToggle: (server: McpServerSummary, event: MouseEvent) => void
}

export function McpServersPanel({ loading, servers, filteredServers, onCreate, onEdit, onToggle }: McpServersPanelProps) {
  if (loading) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
      </AppScreenBody>
    )
  }

  if (servers.length === 0) {
    return (
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Server size={40} strokeWidth={1} className="text-[var(--muted-light)]" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">No MCP servers configured</p>
          <p className="text-xs text-[var(--muted-light)]">Add remote MCP servers to extend the AI agent with custom tools</p>
        </div>
        <button onClick={onCreate} className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"><Plus size={14} />Add Server</button>
      </AppScreenBody>
    )
  }

  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredServers.map((server) => (
            <McpServerCard key={server._id} server={server} onEdit={onEdit} onToggle={onToggle} />
          ))}
        </div>
      </div>
    </AppScreenBody>
  )
}

function McpServerCard({
  server,
  onEdit,
  onToggle,
}: {
  server: McpServerSummary
  onEdit: (server: McpServerSummary) => void
  onToggle: (server: McpServerSummary, event: MouseEvent) => void
}) {
  return (
    <div onClick={() => onEdit(server)} className="group relative cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 transition-all hover:bg-[var(--surface-muted)] hover:shadow-sm">
      <span className={`absolute right-4 top-4 h-2 w-2 rounded-full transition-colors ${server.enabled ? 'bg-[var(--foreground)]' : 'bg-[var(--muted-light)]'}`} title={server.enabled ? 'Active' : 'Disabled'} />
      <div className="mb-3 flex items-start gap-2 pr-6">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-subtle)]">
          <Link2 size={13} className="text-[var(--muted)]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{server.name || 'Untitled'}</p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--muted)]">{server.url}</p>
          {server.description ? <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--muted-light)]">{server.description}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">{server.transport}</span>
        {server.hasAuth ? <span className="inline-flex rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">Auth</span> : null}
      </div>
      <div className="absolute bottom-3 right-3 hidden items-center gap-1 group-hover:flex">
        <button type="button" onClick={(event) => onToggle(server, event)} className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]" title={server.enabled ? 'Disable' : 'Enable'}>{server.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(server) }} className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]" title="Edit"><Pencil size={13} /></button>
      </div>
    </div>
  )
}
