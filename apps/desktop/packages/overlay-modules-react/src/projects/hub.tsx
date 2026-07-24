'use client'

import type {
ProjectChatSummary,
ProjectFileSummary,
ProjectHubTab
} from '@overlay/app-core'
import { projectRouteViewForFile } from '@overlay/app-core'
import { BookOpen,ChevronDown,FileText,FolderOpen,FolderPlus,Loader2,MessageSquare,Pencil,Plus,Upload } from 'lucide-react'
import { type ChangeEvent,type ReactNode,type RefObject } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'
import { FileTypeIcon } from '../shared/file-type-icon'

export interface ProjectHubHeaderProps {
  projectName: string
  editingName: boolean
  draftName: string
  savingName?: boolean
  actions?: ReactNode
  onStartRename: () => void
  onDraftNameChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
}

export function ProjectHubHeader({
  projectName,
  editingName,
  draftName,
  savingName,
  actions,
  onStartRename,
  onDraftNameChange,
  onCommitRename,
  onCancelRename,
}: ProjectHubHeaderProps) {
  return (
    <AppScreenHeader className="px-3 py-2.5 md:px-4 md:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <FolderOpen size={16} className="shrink-0 text-[var(--muted)]" />
        {editingName ? (
          <input
            className="max-w-md min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-sm font-medium text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            value={draftName}
            disabled={savingName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommitRename()
              }
              if (event.key === 'Escape') {
                onCancelRename()
              }
            }}
            onBlur={onCommitRename}
            autoFocus
          />
        ) : (
          <div className="group/project-head flex min-w-0 items-center gap-1">
            <h1
              className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {projectName || 'Project'}
            </h1>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--border)] hover:text-[var(--foreground)] group-hover/project-head:opacity-100 focus-visible:opacity-100"
              aria-label="Rename project"
              onClick={onStartRename}
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
        {actions}
      </div>
    </AppScreenHeader>
  )
}

export interface ProjectHubActionsProps {
  creatingOpen: boolean
  uploadOpen: boolean
  uploading?: boolean
  plusRef: RefObject<HTMLDivElement | null>
  uploadRef: RefObject<HTMLDivElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  folderInputRef: RefObject<HTMLInputElement | null>
  onToggleCreate: () => void
  onToggleUpload: () => void
  onCreateChat: () => void
  onCreateNote: () => void
  onUploadFiles: (event: ChangeEvent<HTMLInputElement>) => void
  onUploadFolder: (event: ChangeEvent<HTMLInputElement>) => void
}

export function ProjectHubActions({
  creatingOpen,
  uploadOpen,
  uploading,
  plusRef,
  uploadRef,
  fileInputRef,
  folderInputRef,
  onToggleCreate,
  onToggleUpload,
  onCreateChat,
  onCreateNote,
  onUploadFiles,
  onUploadFolder,
}: ProjectHubActionsProps) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <div ref={plusRef} className="relative">
        <button
          type="button"
          onClick={onToggleCreate}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
          aria-label="Create"
        >
          <Plus size={14} />
          <ChevronDown size={11} className="opacity-60" />
        </button>
        {creatingOpen && (
          <div className="overlay-pop-in absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] shadow-lg">
            <button
              type="button"
              onClick={onCreateChat}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
            >
              <MessageSquare size={13} /> New chat
            </button>
            <button
              type="button"
              onClick={onCreateNote}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
            >
              <BookOpen size={13} /> New file
            </button>
          </div>
        )}
      </div>
      <div ref={uploadRef} className="relative">
        <button
          type="button"
          onClick={onToggleUpload}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
          aria-label="Upload"
          disabled={uploading}
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          <ChevronDown size={11} className="opacity-60" />
        </button>
        {uploadOpen && (
          <div className="overlay-pop-in absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] shadow-lg">
            <button
              type="button"
              onClick={() => {
                onToggleUpload()
                fileInputRef.current?.click()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
            >
              <FileText size={13} /> Upload file
            </button>
            <button
              type="button"
              onClick={() => {
                onToggleUpload()
                folderInputRef.current?.click()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
            >
              <FolderPlus size={13} /> Upload folder
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onUploadFiles}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error - non-standard attribute for folder uploads
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={onUploadFolder}
      />
    </div>
  )
}

export interface ProjectHubTabsProps {
  activeTab: ProjectHubTab
  chats: readonly ProjectChatSummary[]
  files: readonly ProjectFileSummary[]
  listsLoading?: boolean
  instructions: string
  instructionsLoaded: boolean
  savingInstructions?: boolean
  instructionsSavedAt?: number | null
  onTabChange: (tab: ProjectHubTab) => void
  onOpenChat: (id: string) => void
  onOpenFile: (file: ProjectFileSummary) => void
  onInstructionsChange: (value: string) => void
}

export function ProjectHubTabs({
  activeTab,
  chats,
  files,
  listsLoading,
  instructions,
  instructionsLoaded,
  savingInstructions,
  instructionsSavedAt,
  onTabChange,
  onOpenChat,
  onOpenFile,
  onInstructionsChange,
}: ProjectHubTabsProps) {
  const tabBtnClass = (active: boolean) =>
    `inline-flex items-center rounded-md px-3 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
        : 'text-[var(--muted)] hover:text-[var(--foreground)]'
    }`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onTabChange('chats')} className={tabBtnClass(activeTab === 'chats')}>
          Chats
        </button>
        <button type="button" onClick={() => onTabChange('files')} className={tabBtnClass(activeTab === 'files')}>
          Files
        </button>
        <button type="button" onClick={() => onTabChange('instructions')} className={tabBtnClass(activeTab === 'instructions')}>
          Instructions
        </button>
      </div>

      {activeTab === 'chats' && (
        <div>
          {listsLoading ? (
            <div className="flex justify-center py-6 text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /></div>
          ) : chats.length === 0 ? (
            <p className="px-1 py-2 text-xs text-[var(--muted)]">No chats yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {chats.map((chat) => (
                <li key={chat._id}>
                  <button
                    type="button"
                    onClick={() => onOpenChat(chat._id)}
                    className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:opacity-80"
                  >
                    <MessageSquare size={13} className="shrink-0 text-[var(--muted-light)]" />
                    <span className="min-w-0 flex-1 truncate">{chat.title || 'Untitled'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'files' && (
        <div>
          {listsLoading ? (
            <div className="flex justify-center py-6 text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /></div>
          ) : files.length === 0 ? (
            <p className="px-1 py-2 text-xs text-[var(--muted)]">No files yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {files.map((file) => (
                <li key={file._id}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(file)}
                    className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:opacity-80"
                  >
                    {projectRouteViewForFile(file) === 'note' ? (
                      <BookOpen size={13} className="shrink-0 text-[var(--muted-light)]" />
                    ) : (
                      <FileTypeIcon file={file} size={13} className="text-[var(--muted-light)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{file.name || 'Untitled'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'instructions' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted)]">
            Set context and customize how Overlay responds in this project.
          </p>
          <textarea
            value={instructions}
            disabled={!instructionsLoaded}
            onChange={(event) => onInstructionsChange(event.target.value)}
            placeholder={instructionsLoaded ? 'Project instructions…' : 'Loading…'}
            rows={8}
            className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
          <div className="flex h-4 items-center text-[11px] text-[var(--muted-light)]">
            {savingInstructions ? 'Saving…' : instructionsSavedAt ? 'Saved' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

export interface ProjectsEmptyLandingProps {
  creating?: boolean
  onCreateProject: () => void
}

export function ProjectsEmptyLanding({ creating, onCreateProject }: ProjectsEmptyLandingProps) {
  return (
    <AppScreenShell
      header={
        <AppScreenHeader
          title="Projects"
          className="px-3 py-2.5 md:px-4 md:py-0"
          actions={
            <button
              type="button"
              onClick={onCreateProject}
              disabled={creating}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              New project
            </button>
          }
        />
      }
    >
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-[var(--muted)]">No projects yet.</p>
      </AppScreenBody>
    </AppScreenShell>
  )
}
