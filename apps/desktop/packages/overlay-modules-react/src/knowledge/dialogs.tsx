'use client'

import type { MemoryRow } from '@overlay/app-core'
import { IMPORT_MEMORY_PROMPT } from '@overlay/app-core'
import { Brain,Check,Copy,FileText,Loader2,Search,Trash2,X } from 'lucide-react'
import { type ReactNode } from 'react'

const DIALOG_ACTION_BUTTON_CLASS =
  'px-3 py-1.5 rounded-md text-xs border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)] transition-colors hover:bg-[var(--border)]'

export function KnowledgePendingNotice({
  title,
  preview,
}: {
  title: ReactNode
  preview: ReactNode
}) {
  return (
    <div
      className="mx-auto mb-4 flex max-w-3xl items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3"
      aria-busy
      aria-live="polite"
    >
      <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-[var(--muted)]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--foreground)]">{title}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">{preview}</p>
      </div>
    </div>
  )
}

export function KnowledgeEmptyState({
  kind,
  message,
  actionLabel,
  onAction,
}: {
  kind: 'memory' | 'file' | 'search'
  message: ReactNode
  actionLabel?: ReactNode
  onAction?: () => void
}) {
  const Icon = kind === 'memory' ? Brain : kind === 'file' ? FileText : Search
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-[var(--muted-light)]">
      <Icon size={32} strokeWidth={1} className="opacity-40" />
      <p className="text-sm">{message}</p>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="text-xs text-[var(--foreground)] underline underline-offset-2"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

export function AddMemoryDialog({
  value,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: string
  saving: boolean
  error?: string | null
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div
      className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-dialog-in w-[480px] max-w-[90vw] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--foreground)]">Add memory</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type or paste memory content..."
          autoFocus
          rows={5}
          onKeyDown={(event) => { if (event.key === 'Enter' && event.metaKey) onSave() }}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)]"
        />
        <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
          Long memories stay as one saved item; the list shows short previews so you can scan them quickly.
        </p>
        {error ? <p className="mt-3 text-xs text-red-400" role="alert">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className={DIALOG_ACTION_BUTTON_CLASS}>Cancel</button>
          <button
            onClick={onSave}
            disabled={!value.trim() || saving}
            className={`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ImportMemoryDialog({
  value,
  saving,
  error,
  promptCopied,
  onChange,
  onClose,
  onSave,
  onCopyPrompt,
}: {
  value: string
  saving: boolean
  error?: string | null
  promptCopied: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  onCopyPrompt: () => void
}) {
  return (
    <div
      className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-dialog-in w-[540px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--foreground)]">Import memory</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mb-5 flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[10px] font-semibold text-[var(--background)]">1</span>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium text-[var(--foreground)]">Copy this prompt into a chat with your other AI provider</p>
            <div className="relative rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 pb-10 pt-3">
              <p className="text-xs leading-relaxed text-[var(--foreground)]">{IMPORT_MEMORY_PROMPT}</p>
              <button
                type="button"
                onClick={onCopyPrompt}
                className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
              >
                {promptCopied ? <Check size={11} /> : <Copy size={11} />}
                {promptCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
        <div className="mb-5 flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[10px] font-semibold text-[var(--background)]">2</span>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium text-[var(--foreground)]">Paste results below to add to your memory</p>
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Paste your memory details here"
              rows={6}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)]"
            />
          </div>
        </div>
        {error ? <p className="mb-3 text-xs text-red-400" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={DIALOG_ACTION_BUTTON_CLASS}>Cancel</button>
          <button
            onClick={onSave}
            disabled={!value.trim() || saving}
            className={`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`}
          >
            {saving ? 'Saving…' : 'Add to memory'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreateKnowledgeItemDialog({
  type,
  value,
  creating,
  onChange,
  onClose,
  onCreate,
}: {
  type: 'file' | 'folder'
  value: string
  creating: boolean
  onChange: (value: string) => void
  onClose: () => void
  onCreate: () => void
}) {
  return (
    <div
      className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)]"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="overlay-dialog-in w-[400px] max-w-[90vw] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--foreground)]">
            New {type === 'folder' ? 'folder' : 'file'}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
            <X size={14} />
          </button>
        </div>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={type === 'folder' ? 'Folder name' : 'filename.txt'}
          autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter') onCreate() }}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className={DIALOG_ACTION_BUTTON_CLASS}>Cancel</button>
          <button
            onClick={onCreate}
            disabled={!value.trim() || creating}
            className={`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MemoryDetailDialog({
  memory,
  onClose,
  onDelete,
}: {
  memory: MemoryRow
  onClose: () => void
  onDelete: (memoryId: string) => void
}) {
  return (
    <div
      className="overlay-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        className="overlay-dialog-in flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--foreground)]">Memory</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-light)]">
              {new Date(memory.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => onDelete(memory.memoryId)}
              className="rounded-md p-1.5 text-[var(--muted-light)] transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{memory.fullContent}</p>
          {memory.source ? <p className="mt-4 text-xs text-[var(--muted-light)]">Source: {memory.source}</p> : null}
        </div>
      </div>
    </div>
  )
}
