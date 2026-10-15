'use client'

import { UserRound, UsersRound } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import type { ConversationLifecycleScope } from '@overlay/workspace-contracts'

export function ConversationScopeActionDialog({
  open,
  action,
  conversationTitle,
  canApplyToEveryone,
  busy = false,
  error,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  action: 'archive' | 'delete'
  conversationTitle: string
  canApplyToEveryone: boolean
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onSelect(scope: ConversationLifecycleScope): void | Promise<void>
}) {
  const destructive = action === 'delete'
  const verb = destructive ? 'Delete' : 'Archive'

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`${verb} ${conversationTitle}?`}
      description={`Choose whether this applies only to your workspace view or to everyone in the workspace.`}
      footer={(
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
      )}
      className="max-w-md"
    >
      <div className="mt-4 space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSelect('self')}
          className="flex w-full items-start gap-3 rounded-xl border border-(--border) p-3 text-left transition-colors hover:bg-(--surface-subtle) disabled:opacity-50"
        >
          <UserRound size={16} className="mt-0.5 shrink-0 text-(--muted)" />
          <span>
            <span className="block text-sm font-medium text-(--foreground)">{verb} only for me</span>
            <span className="mt-0.5 block text-xs text-(--muted)">
              {destructive ? 'Remove it from your workspace view without deleting it for teammates.' : 'Hide it from your workspace view while teammates keep it.'}
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={busy || !canApplyToEveryone}
          onClick={() => void onSelect('everyone')}
          className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            destructive
              ? 'border-red-500/30 hover:bg-red-500/5'
              : 'border-(--border) hover:bg-(--surface-subtle)'
          }`}
        >
          <UsersRound size={16} className={`mt-0.5 shrink-0 ${destructive ? 'text-red-500' : 'text-(--muted)'}`} />
          <span>
            <span className={`block text-sm font-medium ${destructive ? 'text-red-500' : 'text-(--foreground)'}`}>
              {verb} for everyone
            </span>
            <span className="mt-0.5 block text-xs text-(--muted)">
              {canApplyToEveryone
                ? destructive
                  ? 'Delete the conversation and its history for every workspace member.'
                  : 'Move the conversation to Archived for every current participant.'
                : 'Only the workspace owner can apply this action to everyone.'}
            </span>
          </span>
        </button>
        {error ? <p role="alert" className="pt-1 text-xs text-red-500">{error}</p> : null}
      </div>
    </DialogFrame>
  )
}
