'use client'
import { Button, Input, Textarea } from '@overlay/ui/primitives'
import { unstyledButton, unstyledInput, unstyledTextarea } from '@overlay/ui/control-reset'
import type { MemoryRow } from '@overlay/app-core'
import { IMPORT_MEMORY_PROMPT } from '@overlay/app-core'
import { Dialog, DialogContent } from '@overlay/ui'
import { Brain,Check,Copy,FileText,Loader2,Search,Trash2,X } from 'lucide-react'
import type { ReactNode } from 'react'

const DIALOG_ACTION_BUTTON_CLASS =
  'px-3 py-1.5 rounded-md text-xs border border-(--border) bg-(--surface-subtle) text-(--foreground) transition-colors hover:bg-(--border)'

function DialogShell({
  ariaLabelledBy,
  onClose,
  dialogClassName,
  scrimClassName = '',
  children,
}: {
  ariaLabelledBy: string
  onClose: () => void
  dialogClassName: string
  scrimClassName?: string
  children: ReactNode
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={`overlay-backdrop-in z-50 bg-(--overlay-scrim) ${scrimClassName}`}
        aria-labelledby={ariaLabelledBy}
        className={`block gap-0 ${dialogClassName}`}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function KnowledgePendingNotice({
  title,
  preview,
}: {
  title: ReactNode
  preview: ReactNode
}) {
  return (
    <div
      className="mx-auto mb-4 flex max-w-3xl items-start gap-3 rounded-xl border border-(--border) bg-(--surface-subtle) px-3 py-3"
      aria-busy
      aria-live="polite"
    >
      <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-(--muted)" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-(--foreground)">{title}</p>
        <p className='mt-1 whitespace-pre-wrap text-sm leading-relaxed text-(--muted)'>
          {preview}
        </p>
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
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-(--muted-light)">
      <Icon size={32} strokeWidth={1} className="opacity-40" />
      <p className="text-sm">{message}</p>
      {actionLabel ? (
        <Button variant="ghost"
          type="button"
          onClick={onAction}
          className={unstyledButton("text-xs text-(--foreground) underline underline-offset-2")}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function AddMemoryDialog({
  value,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  value: string
  saving: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <DialogShell
      ariaLabelledBy="add-memory-dialog-title"
      onClose={onClose}
      dialogClassName="overlay-dialog-in w-[480px] max-w-[90vw] rounded-xl border border-(--border) bg-(--surface-elevated) p-6 shadow-xl"
    >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="add-memory-dialog-title" className="text-sm font-medium text-(--foreground)">Add memory</h3>
          <Button variant="ghost" type="submit"
            aria-label="Close"
            onClick={onClose}
            className={unstyledButton("rounded-sm p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
          >
            <X size={14} />
          </Button>
        </div>
        <Textarea
          aria-label="Memory content"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type or paste memory content..."
          data-autofocus
          rows={5}
          onKeyDown={(event) => { if (event.key === 'Enter' && event.metaKey) onSave() }}
          className={unstyledTextarea("w-full resize-none rounded-lg border border-(--border) bg-(--surface-elevated) px-3 py-2.5 text-sm text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted)")}
        />
        <p className="mt-2 text-[11px] leading-snug text-(--muted)">
          Long memories stay as one saved item; the list shows short previews so you can scan them quickly.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" type="submit" onClick={onClose} className={unstyledButton(DIALOG_ACTION_BUTTON_CLASS)}>
            Cancel
          </Button>
          <Button variant="ghost" type="submit"
            onClick={onSave}
            disabled={!value.trim() || saving}
            className={unstyledButton(`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`)}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
    </DialogShell>
  )
}

export function ImportMemoryDialog({
  value,
  saving,
  promptCopied,
  onChange,
  onClose,
  onSave,
  onCopyPrompt,
}: {
  value: string
  saving: boolean
  promptCopied: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  onCopyPrompt: () => void
}) {
  return (
    <DialogShell
      ariaLabelledBy="import-memory-dialog-title"
      onClose={onClose}
      dialogClassName="overlay-dialog-in w-[540px] max-w-[92vw] rounded-xl border border-(--border) bg-(--surface-elevated) p-6 shadow-xl"
    >
        <div className="mb-6 flex items-center justify-between">
          <h3 id="import-memory-dialog-title" className="text-sm font-medium text-(--foreground)">Import memory</h3>
          <Button variant="ghost" type="submit"
            aria-label="Close"
            onClick={onClose}
            className={unstyledButton("rounded-sm p-1 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
          >
            <X size={14} />
          </Button>
        </div>
        <div className="mb-5 flex gap-3">
          <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--foreground) text-[10px] font-semibold text-(--background)'>
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className='mb-2 text-xs font-medium text-(--foreground)'>
              Copy this prompt into a chat with your other AI provider
            </p>
            <div className="relative rounded-lg border border-(--border) bg-(--surface-muted) px-3 pb-10 pt-3">
              <p className='text-xs leading-relaxed text-(--foreground)'>
                {IMPORT_MEMORY_PROMPT}
              </p>
              <Button variant="ghost"
                type="button"
                onClick={onCopyPrompt}
                className={unstyledButton("absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-elevated) px-2 py-1 text-[11px] text-(--foreground) transition-colors hover:bg-(--surface-subtle)")}
              >
                {promptCopied ? <Check size={11} /> : <Copy size={11} />}
                {promptCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
        <div className="mb-5 flex gap-3">
          <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--foreground) text-[10px] font-semibold text-(--background)'>
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium text-(--foreground)" id="import-memory-paste-label">Paste results below to add to your memory</p>
            <Textarea
              aria-labelledby="import-memory-paste-label"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Paste your memory details here"
              rows={6}
              className={unstyledTextarea("w-full resize-none rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2.5 text-xs text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted)")}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="submit" onClick={onClose} className={unstyledButton(DIALOG_ACTION_BUTTON_CLASS)}>
            Cancel
          </Button>
          <Button variant="ghost" type="submit"
            onClick={onSave}
            disabled={!value.trim() || saving}
            className={unstyledButton(`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`)}
          >
            {saving ? 'Saving…' : 'Add to memory'}
          </Button>
        </div>
    </DialogShell>
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
    <DialogShell
      ariaLabelledBy="new-file-dialog-title"
      onClose={onClose}
      dialogClassName="overlay-dialog-in w-[400px] max-w-[90vw] rounded-xl border border-(--border) bg-(--surface-elevated) p-6 shadow-xl"
    >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="new-file-dialog-title" className="text-sm font-medium text-(--foreground)">
            New {type === 'folder' ? 'folder' : 'file'}
          </h3>
          <Button variant="ghost" type="submit" aria-label="Close" onClick={onClose} className={unstyledButton("rounded-sm p-1 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)")}>
            <X size={14} />
          </Button>
        </div>
        <Input
          aria-label={type === 'folder' ? 'Folder name' : 'File name'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={type === 'folder' ? 'Folder name' : 'filename.txt'}
          data-autofocus
          onKeyDown={(event) => { if (event.key === 'Enter') onCreate() }}
          className={unstyledInput("w-full rounded-lg border border-(--border) bg-(--surface-elevated) px-3 py-2.5 text-sm text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted-light) focus:border-(--muted)")}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" type="submit" onClick={onClose} className={unstyledButton(DIALOG_ACTION_BUTTON_CLASS)}>
            Cancel
          </Button>
          <Button variant="ghost" type="submit"
            onClick={onCreate}
            disabled={!value.trim() || creating}
            className={unstyledButton(`${DIALOG_ACTION_BUTTON_CLASS} disabled:opacity-40`)}
          >
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </div>
    </DialogShell>
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
    <DialogShell
      ariaLabelledBy="memory-detail-dialog-title"
      onClose={onClose}
      scrimClassName="p-4"
      dialogClassName="overlay-dialog-in flex max-h-[min(90vh,640px)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) shadow-xl"
    >
        <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
          <span id="memory-detail-dialog-title" className="text-sm font-medium text-(--foreground)">Memory</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--muted-light)">
              {
                // Locale is pinned to 'en-US', so SSR and client output are identical.
                // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
                new Date(memory.createdAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              }
            </span>
            <Button variant="ghost"
              type="button"
              aria-label="Delete memory"
              onClick={() => onDelete(memory.memoryId)}
              className={unstyledButton("rounded-md p-1.5 text-(--muted-light) transition-colors hover:bg-red-500/10 hover:text-red-400")}
            >
              <Trash2 size={13} />
            </Button>
            <Button variant="ghost"
              type="button"
              aria-label="Close"
              onClick={onClose}
              className={unstyledButton("rounded-md p-1.5 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
            >
              <X size={14} />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className='whitespace-pre-wrap text-sm leading-relaxed text-(--foreground)'>
            {memory.fullContent}
          </p>
          {memory.source ? (
            <p className='mt-4 text-xs text-(--muted-light)'>
              Source: {memory.source}
            </p>
          ) : null}
        </div>
    </DialogShell>
  )
}
