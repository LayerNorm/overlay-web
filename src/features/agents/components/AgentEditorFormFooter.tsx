'use client'

import { Button } from '@overlay/ui/primitives'

export function AgentEditorFormFooter({
  mode,
  busy,
  valid,
  dirty,
  conflict,
  onCreate,
  onClose,
  onSave,
  onCancel,
  onDiscard,
}: {
  mode: 'new' | 'edit'
  busy: boolean
  valid: boolean
  dirty: boolean
  conflict: boolean
  onCreate(): void
  onClose(): void
  onSave(): void
  onCancel(): void
  onDiscard(): void
}) {
  return (
    <>
      {mode === 'edit' && conflict ? (
        <div role="alert" className="mt-3 rounded-lg border border-(--border) bg-(--surface-subtle) p-3 text-xs text-(--muted)">
          <p>This agent changed elsewhere. Your draft is preserved and autosave is paused.</p>
          <Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={onDiscard}>
            Discard draft and reload
          </Button>
        </div>
      ) : null}
      {mode === 'new' ? (
        <>
          <Button className="mt-2 w-full" disabled={busy || !valid} onClick={onCreate}>
            {busy ? 'Creating…' : 'Create agent'}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button className="mt-2 w-full" disabled={busy || !valid || !dirty || conflict} onClick={onSave}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </>
  )
}
