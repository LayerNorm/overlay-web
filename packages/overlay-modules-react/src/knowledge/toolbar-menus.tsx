'use client'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
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
  'inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md border border-(--border) bg-(--surface-elevated) text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)'

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
    <div ref={outputFilterRef} className="relative h-8 w-fit max-w-52">
      <Button variant="ghost"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={unstyledButton(`flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-(--border) bg-(--surface-subtle) px-2.5 py-0 text-left text-xs leading-none text-(--foreground) ${
          open ? 'bg-(--border)' : 'hover:bg-(--border)'
        }`)}
      >
        <span className="min-w-0 truncate">{OUTPUT_FILTER_LABELS[outputFilter]}</span>
        <ChevronDown size={11} className="shrink-0" />
      </Button>
      {open && (
        <div
          className="overlay-pop-in absolute left-0 top-full z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-(--border) bg-(--surface-elevated) py-1 shadow-lg"
          role="listbox"
        >
          {(['all', 'image', 'video', 'files'] as const).map((id) => (
            <Button variant="ghost"
              key={id}
              type="button"
              role="option"
              aria-selected={outputFilter === id}
              onClick={() => onCommit(id)}
              className={unstyledButton(`w-full whitespace-nowrap px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-(--surface-muted) ${
                outputFilter === id ? 'font-medium text-(--foreground)' : 'text-(--muted)'
              }`)}
            >
              {OUTPUT_FILTER_LABELS[id]}
            </Button>
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
          <Button variant="ghost"
            type="button"
            title="Create"
            onClick={() => {
              setCreateMenuOpen((v) => !v)
              setUploadMenuOpen(false)
            }}
            className={unstyledButton(TOOLBAR_ICON_BUTTON_CLASS)}
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
          >
            <Plus size={15} />
          </Button>
          {createMenuOpen ? (
            <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-(--border) bg-(--surface-elevated) py-1 shadow-lg">
              <Button variant="ghost"
                type="button"
                onClick={() => {
                  setCreateMenuOpen(false)
                  onCreateNoteFile()
                }}
                className={unstyledButton("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)")}
              >
                <BookOpen size={13} />
                New Note
              </Button>
              <Button variant="ghost"
                type="button"
                onClick={() => {
                  setCreateMenuOpen(false)
                  setDialog({ type: 'folder', parentId: activeFolder?._id ?? null })
                  setDialogName('')
                }}
                className={unstyledButton("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)")}
              >
                <FolderPlus size={13} />
                New Folder
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div ref={uploadMenuRef} className="relative">
        <Button variant="ghost"
          type="button"
          title="Upload"
          onClick={() => {
            setUploadMenuOpen((v) => !v)
            setCreateMenuOpen(false)
          }}
          className={unstyledButton(TOOLBAR_ICON_BUTTON_CLASS)}
          aria-expanded={uploadMenuOpen}
          aria-haspopup="menu"
        >
          <Upload size={15} />
        </Button>
        {uploadMenuOpen ? (
          <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-(--border) bg-(--surface-elevated) py-1 shadow-lg">
            <Button variant="ghost"
              type="button"
              onClick={() => {
                setUploadMenuOpen(false)
                if (onPickFile) onPickFile()
                else fileUploadRef.current?.click()
              }}
              className={unstyledButton("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)")}
            >
              <FilePlus size={13} />
              Upload File
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => {
                setUploadMenuOpen(false)
                if (onPickFolder) onPickFolder()
                else folderUploadRef.current?.click()
              }}
              className={unstyledButton("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)")}
            >
              <FolderInput size={13} />
              Upload Folder
            </Button>
          </div>
        ) : null}
      </div>
    </>
  )
}
