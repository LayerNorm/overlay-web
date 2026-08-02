'use client'

import { useState } from 'react'
import { Button, DialogFrame, Input } from '@overlay/ui/primitives'

export function CreateWorkspaceDialog({
  open,
  busy,
  error,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onCreate(name: string): Promise<void>
}) {
  const [name, setName] = useState('')

  const trimmedName = name.trim()

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Create a workspace"
      description="Workspaces keep your team, chats, agents, and shared resources together."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !trimmedName}
            onClick={() => void onCreate(trimmedName)}
          >
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </>
      )}
    >
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && trimmedName) void onCreate(trimmedName)
        }}
      >
        <label className="block text-xs font-medium text-[var(--foreground)]" htmlFor="workspace-name">
          Workspace name
        </label>
        <Input
          id="workspace-name"
          autoFocus
          className="mt-2"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Acme"
          autoComplete="organization"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-light)]">
          You will be the workspace owner. You can invite people and add agents next.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-xs text-red-500">
            {error}
          </p>
        ) : null}
      </form>
    </DialogFrame>
  )
}
