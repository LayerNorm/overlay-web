'use client'

import type React from 'react'
import {
  BookOpen,
  ChevronDown,
  FilePlus,
  FolderInput,
  FolderPlus,
  Plus,
  Upload,
} from 'lucide-react'
import { OUTPUT_FILTER_LABELS } from '@overlay/app-core'
import type {
  KnowledgeFileNode as FileNode,
  KnowledgeOutputFilter as OutputFilter,
} from '@overlay/app-core'

const TOOLBAR_ICON_BUTTON_CLASS =
  'inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export function OutputFilterMenu({
  onCommit,
  open,
  outputFilter,
  outputFilterRef,
  setOpen,
}: {
  onCommit: (filter: OutputFilter) => void
  open: boolean
  outputFilter: OutputFilter
  outputFilterRef: React.RefObject<HTMLDivElement | null>
  setOpen: (value: boolean | ((value: boolean) => boolean)) => void
}) {
  return (
    <div ref={outputFilterRef} className="relative h-8 w-fit max-w-[13rem]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none text-[var(--foreground)] ${
          open ? 'bg-[var(--border)]' : 'hover:bg-[var(--border)]'
        }`}
      >
        <span className="min-w-0 truncate">{OUTPUT_FILTER_LABELS[outputFilter]}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {open && (
        <div
          className="overlay-pop-in absolute left-0 top-full z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
          role="listbox"
        >
          {(['all', 'image', 'video', 'files'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={outputFilter === id}
              onClick={() => onCommit(id)}
              className={`w-full whitespace-nowrap px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-muted)] ${
                outputFilter === id ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'
              }`}
            >
              {OUTPUT_FILTER_LABELS[id]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FilesCreateUploadControls({
  activeFolder,
  createMenuOpen,
  createMenuRef,
  fileUploadRef,
  folderUploadRef,
  mode,
  onCreateNoteFile,
  onPickFile,
  onPickFolder,
  setCreateMenuOpen,
  setDialog,
  setDialogName,
  setUploadMenuOpen,
  uploadMenuOpen,
  uploadMenuRef,
}: {
  activeFolder: FileNode | null
  createMenuOpen: boolean
  createMenuRef: React.RefObject<HTMLDivElement | null>
  fileUploadRef: React.RefObject<HTMLInputElement | null>
  folderUploadRef: React.RefObject<HTMLInputElement | null>
  mode: 'knowledge' | 'files'
  onCreateNoteFile: () => void
  onPickFile?: () => void
  onPickFolder?: () => void
  setCreateMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setDialog: (value: { type: 'file' | 'folder'; parentId: string | null } | null) => void
  setDialogName: (value: string) => void
  setUploadMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  uploadMenuOpen: boolean
  uploadMenuRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      {mode === 'files' ? (
        <div ref={createMenuRef} className="relative">
          <button
            type="button"
            title="Create"
            onClick={() => {
              setCreateMenuOpen((v) => !v)
              setUploadMenuOpen(false)
            }}
            className={TOOLBAR_ICON_BUTTON_CLASS}
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
          >
            <Plus size={15} />
          </button>
          {createMenuOpen ? (
            <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setCreateMenuOpen(false)
                  onCreateNoteFile()
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              >
                <BookOpen size={13} />
                New Note
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateMenuOpen(false)
                  setDialog({ type: 'folder', parentId: activeFolder?._id ?? null })
                  setDialogName('')
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              >
                <FolderPlus size={13} />
                New Folder
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div ref={uploadMenuRef} className="relative">
        <button
          type="button"
          title="Upload"
          onClick={() => {
            setUploadMenuOpen((v) => !v)
            setCreateMenuOpen(false)
          }}
          className={TOOLBAR_ICON_BUTTON_CLASS}
          aria-expanded={uploadMenuOpen}
          aria-haspopup="menu"
        >
          <Upload size={15} />
        </button>
        {uploadMenuOpen ? (
          <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setUploadMenuOpen(false)
                if (onPickFile) onPickFile()
                else fileUploadRef.current?.click()
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              <FilePlus size={13} />
              Upload File
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadMenuOpen(false)
                if (onPickFolder) onPickFolder()
                else folderUploadRef.current?.click()
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              <FolderInput size={13} />
              Upload Folder
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
