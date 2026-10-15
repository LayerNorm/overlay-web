'use client'

import { unstyledButton, unstyledInput } from './control-reset'
import { Button, Input } from '@overlay/ui/primitives'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent } from '@overlay/ui'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { workspaceManagementClient } from '../lib/workspace-client'

/**
 * The first thing a new person does: name their workspace. It starts as "<First name>’s workspace"; this lets them keep
 * that or call it something else before the tour. Skipping keeps the default.
 */
export function NameWorkspaceStep({ onDone }: { onDone: () => void }) {
  const { activeWorkspace, refresh } = useWorkspace()
  const [name, setName] = useState(activeWorkspace?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!activeWorkspace) return null

  async function save() {
    const next = name.trim()
    if (!activeWorkspace || !next || next === activeWorkspace.name) {
      onDone()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await workspaceManagementClient.renameWorkspace(activeWorkspace.id, next)
      await refresh()
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the name. You can change it later in Settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-9998 bg-black/55 p-4"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        aria-labelledby="name-workspace-title"
        className="block w-[calc(100%-2rem)] max-w-sm gap-0 p-5"
      >
        <h3 id="name-workspace-title" className="text-sm font-semibold text-(--foreground)">Name your workspace</h3>
        <p className="mt-1 text-xs leading-5 text-(--muted)">
          Your chats, files, and agents live here, and you can invite people to it later. You can rename it any time in Settings.
        </p>
        <Input
          aria-label="Workspace name"
          value={name}
          maxLength={80}
          disabled={busy}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
          className={unstyledInput(`mt-4 w-full rounded-md border border-(--border) bg-(--surface-subtle) px-3 py-2 text-sm text-(--foreground) outline-hidden`)}
        />
        {error ? <p role="alert" className="mt-2 text-xs text-red-500">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" type="button" disabled={busy} onClick={onDone} className={unstyledButton(`rounded-md px-3 py-1.5 text-xs text-(--muted) hover:bg-(--surface-subtle)`)}>
            Keep this name
          </Button>
          <Button variant="ghost" type="button" disabled={busy || !name.trim()} onClick={() => void save()} className={unstyledButton(`inline-flex items-center gap-1.5 rounded-md bg-(--foreground) px-3 py-1.5 text-xs font-medium text-(--background) hover:opacity-80 disabled:opacity-50`)}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
