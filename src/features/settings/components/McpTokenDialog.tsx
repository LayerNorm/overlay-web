'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { Button, DialogFrame, Input, ListboxSelect, SegmentedControl } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { MCP_ACCESS_DESCRIPTION, MCP_ACCESS_LABEL, MCP_ACCESS_LEVELS, type McpAccessLevel } from '@/shared/mcp/access'
import { McpCopyField } from './McpCopyField'

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const

/** Create a token for a local agent that cannot sign in with OAuth. The token is shown once. */
export function McpTokenDialog({ workspaces, onClose, onCreated }: {
  workspaces: WorkspaceSummary[]
  onClose(): void
  onCreated(): void
}) {
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [access, setAccess] = useState<McpAccessLevel>('read')
  const [days, setDays] = useState<string>('90')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: string; endpoint: string } | null>(null)

  useEffect(() => {
    if (!workspaceId && workspaces[0]) setWorkspaceId(workspaces[0].id)
  }, [workspaceId, workspaces])

  const submit = async () => {
    if (busy || !workspaceId) return
    setBusy(true)
    setError(null)
    try {
      const result = await overlayAppClient.mcpAccess.createToken({
        ...(name.trim() ? { name: name.trim() } : {}), workspaceId, access, ttlDays: Number(days),
      })
      setCreated({ token: result.token, endpoint: result.endpoint })
      onCreated()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the token.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      open
      onOpenChange={(open) => { if (!open && !busy) onClose() }}
      title={created ? 'Your token' : 'Create a token'}
      aria-label="Create a token"
    >
      {created ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-5 text-[var(--muted)]">Copy it now. It is not shown again. Send it as an <code>Authorization: Bearer</code> header to the Overlay address.</p>
          <McpCopyField value={created.token} label="token" />
          <McpCopyField value={`Authorization: Bearer ${created.token}`} label="header" />
          <div className="flex justify-end pt-2"><Button variant="primary" size="sm" onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="mcp-token-name" className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Name <span className="font-normal text-[var(--muted-light)]">optional</span></label>
            <Input id="mcp-token-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="My local agent" />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Workspace</p>
            <ListboxSelect
              aria-label="Workspace"
              value={workspaceId}
              options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              onChange={setWorkspaceId}
              portal
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Access</p>
            <SegmentedControl
              ariaLabel="Access"
              layout="stretch"
              value={access}
              options={MCP_ACCESS_LEVELS.map((level) => ({ value: level, label: MCP_ACCESS_LABEL[level] }))}
              onChange={setAccess}
            />
            <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">{MCP_ACCESS_DESCRIPTION[access]}</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Expires</p>
            <ListboxSelect aria-label="Expires" value={days} options={[...EXPIRY_OPTIONS]} onChange={setDays} portal />
          </div>
          {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !workspaceId}>{busy ? 'Creating…' : 'Create token'}</Button>
          </div>
        </div>
      )}
    </DialogFrame>
  )
}
