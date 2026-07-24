'use client'

import type {
ProjectChatSummary,
ProjectFileSummary,
ProjectNoteSummary,
ProjectSummary
} from '@overlay/app-core'
import { ArrowLeft,BookOpen,Folder,FolderOpen,FolderPlus,Loader2,MessageSquare,Plus,Trash2,Upload } from 'lucide-react'
import { type ChangeEvent,type KeyboardEvent,type MouseEvent,type ReactNode,type RefObject } from 'react'

import { ProjectFileTreeNode } from './file-tree'
import { PROJECT_TREE_CHEVRON_COL,PROJECT_TREE_GUTTER_PX,PROJECT_TREE_ICON_COL } from './shared'

export interface ProjectsSidebarFrameProps {
  selectedProject: ProjectSummary | null
  loading?: boolean
  itemsLoading?: boolean
  rootProjects: readonly ProjectSummary[]
  subprojects: readonly ProjectSummary[]
  projectChats: readonly ProjectChatSummary[]
  projectNotes: readonly ProjectNoteSummary[]
  rootProjectFiles: readonly ProjectFileSummary[]
  allProjectFiles: readonly ProjectFileSummary[]
  expandedProjectIds: ReadonlySet<string>
  expandedFileIds: ReadonlySet<string>
  showNewProject: boolean
  newProjectParentId: string | null
  newProjectName: string
  creatingProject?: boolean
  addMenuOpen: boolean
  addMenuRef: RefObject<HTMLDivElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  folderInputRef: RefObject<HTMLInputElement | null>
  projectUploadError?: string | null
  projectDraftName: string
  projectDraftInstructions: string
  savingProjectMeta?: boolean
  renderRootProject: (project: ProjectSummary) => ReactNode
  onBack: () => void
  onToggleAddMenu: () => void
  onOpenNewProjectForm: (parentId: string | null) => void
  onCancelNewProject: () => void
  onNewProjectNameChange: (value: string) => void
  onCreateProject: () => void
  onCreateChat: () => void
  onCreateNote: () => void
  onUploadFile: (event: ChangeEvent<HTMLInputElement>) => void
  onUploadFolder: (event: ChangeEvent<HTMLInputElement>) => void
  onProjectDraftNameChange: (value: string) => void
  onProjectDraftInstructionsChange: (value: string) => void
  onSaveProjectMeta: () => void
  onOpenSubproject: (project: ProjectSummary) => void
  onDeleteProject: (projectId: string, event: MouseEvent) => void
  onOpenProjectChat: (id: string) => void
  onOpenProjectNote: (id: string) => void
  onDeleteItem: (type: 'chat' | 'note', id: string, event: MouseEvent) => void
  onToggleFileFolder: (id: string, event: MouseEvent) => void
  onOpenProjectFile: (id: string) => void
  onDeleteProjectFile: (id: string, event: MouseEvent) => void
}

export function ProjectsSidebarFrame({
  selectedProject,
  loading,
  itemsLoading,
  rootProjects,
  subprojects,
  projectChats,
  projectNotes,
  rootProjectFiles,
  allProjectFiles,
  expandedFileIds,
  showNewProject,
  newProjectParentId,
  newProjectName,
  creatingProject,
  addMenuOpen,
  addMenuRef,
  fileInputRef,
  folderInputRef,
  projectUploadError,
  projectDraftName,
  projectDraftInstructions,
  savingProjectMeta,
  renderRootProject,
  onBack,
  onToggleAddMenu,
  onOpenNewProjectForm,
  onCancelNewProject,
  onNewProjectNameChange,
  onCreateProject,
  onCreateChat,
  onCreateNote,
  onUploadFile,
  onUploadFolder,
  onProjectDraftNameChange,
  onProjectDraftInstructionsChange,
  onSaveProjectMeta,
  onOpenSubproject,
  onDeleteProject,
  onOpenProjectChat,
  onOpenProjectNote,
  onDeleteItem,
  onToggleFileFolder,
  onOpenProjectFile,
  onDeleteProjectFile,
}: ProjectsSidebarFrameProps) {
  function onNewProjectKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') onCreateProject()
    if (event.key === 'Escape') onCancelNewProject()
  }

  return (
    <div className="w-52 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5] shrink-0">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onUploadFile} />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={onUploadFolder}
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
      />

      <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3 gap-2 shrink-0">
        {selectedProject ? (
          <>
            <button
              onClick={onBack}
              className="p-1 rounded hover:bg-[#e8e8e8] transition-colors shrink-0"
            >
              <ArrowLeft size={13} className="text-[#525252]" />
            </button>
            <span className="flex-1 text-sm font-medium text-[#0a0a0a] truncate">{selectedProject.name}</span>
            <div ref={addMenuRef} className="relative shrink-0">
              <button
                onClick={onToggleAddMenu}
                className="flex items-center justify-center w-6 h-6 rounded-md text-xs bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
              >
                <Plus size={13} />
              </button>
              {addMenuOpen && (
                <div className="overlay-pop-in absolute right-0 top-full mt-1 w-44 bg-white border border-[#e5e5e5] rounded-lg shadow-lg py-1 z-50">
                  <button onClick={onCreateChat} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors">
                    <MessageSquare size={12} />New Chat
                  </button>
                  <button onClick={onCreateNote} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors">
                    <BookOpen size={12} />New Note
                  </button>
                  <button onClick={() => { onToggleAddMenu(); fileInputRef.current?.click() }} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors">
                    <Upload size={12} />Upload File
                  </button>
                  <button onClick={() => { onToggleAddMenu(); folderInputRef.current?.click() }} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors">
                    <FolderPlus size={12} />Upload Folder
                  </button>
                  <div className="border-t border-[#f0f0f0] mt-1 pt-1">
                    <button onClick={() => onOpenNewProjectForm(selectedProject._id)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#525252] hover:bg-[#f5f5f5] transition-colors">
                      <Folder size={12} />New Subproject
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <button
            onClick={() => onOpenNewProjectForm(null)}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
          >
            <Plus size={13} />
            New Project
          </button>
        )}
      </div>

      {showNewProject && (
        <div className="px-3 py-2 border-b border-[#e5e5e5] bg-[#fafafa]">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#aaa] mb-1.5">
            {newProjectParentId ? 'New Subproject' : 'New Project'}
          </p>
          <input
            value={newProjectName}
            onChange={(event) => onNewProjectNameChange(event.target.value)}
            placeholder="Project name"
            autoFocus
            onKeyDown={onNewProjectKeyDown}
            className="w-full text-xs border border-[#e5e5e5] rounded-md px-2 py-1.5 outline-none placeholder-[#aaa] focus:border-[#0a0a0a] transition-colors bg-white"
          />
          <div className="flex gap-1.5 mt-1.5">
            <button
              onClick={onCancelNewProject}
              className="flex-1 py-1 rounded text-xs text-[#525252] hover:bg-[#e8e8e8] transition-colors"
            >Cancel</button>
            <button
              onClick={onCreateProject}
              disabled={!newProjectName.trim() || creatingProject}
              className="flex-1 py-1 rounded text-xs bg-[#0a0a0a] text-[#fafafa] disabled:opacity-40 hover:bg-[#222] transition-colors"
            >{creatingProject ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      )}

      {selectedProject && projectUploadError && (
        <div className="shrink-0 px-2 py-2 text-[10px] text-red-600 bg-red-50 border-b border-red-100 leading-snug">
          {projectUploadError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {loading ? (
          <div className="flex justify-center pt-8 text-[#888]"><Loader2 size={14} className="animate-spin" /></div>
        ) : selectedProject ? (
          itemsLoading ? (
            <div className="flex justify-center pt-8 text-[#888]"><Loader2 size={14} className="animate-spin" /></div>
          ) : (
            <div className="space-y-0.5">
              <div className="mx-1 mb-3 rounded-xl border border-[#e8e8e8] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#a1a1aa]">
                      Project
                    </p>
                    <input
                      value={projectDraftName}
                      onChange={(event) => onProjectDraftNameChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          onSaveProjectMeta()
                        }
                      }}
                      className="mt-1 w-full bg-transparent text-sm font-medium text-[#0a0a0a] outline-none placeholder-[#bbb]"
                      placeholder="Project name"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onSaveProjectMeta}
                    disabled={savingProjectMeta || !projectDraftName.trim()}
                    className="shrink-0 rounded-md bg-[#0a0a0a] px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-[#222] disabled:opacity-40"
                  >
                    {savingProjectMeta ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#a1a1aa]">
                    Instructions
                  </p>
                  <textarea
                    value={projectDraftInstructions}
                    onChange={(event) => onProjectDraftInstructionsChange(event.target.value)}
                    className="min-h-[92px] w-full resize-y rounded-lg border border-[#ececec] bg-[#fafafa] px-2.5 py-2 text-xs text-[#303030] outline-none transition-colors placeholder-[#b2b2b2] focus:border-[#0a0a0a]"
                    placeholder="Guidance that should apply to chats and notes in this project."
                  />
                </div>
              </div>

              {subprojects.map((subproject) => (
                <div
                  key={subproject._id}
                  onClick={() => onOpenSubproject(subproject)}
                  className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-xs text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a] transition-colors"
                >
                  <div className={PROJECT_TREE_CHEVRON_COL} aria-hidden />
                  <div className={PROJECT_TREE_ICON_COL}>
                    <Folder size={12} />
                  </div>
                  <span className="flex-1 truncate">{subproject.name}</span>
                  <button
                    type="button"
                    onClick={(event) => onDeleteProject(subproject._id, event)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              {projectChats.map((chat) => (
                <div
                  key={chat._id}
                  onClick={() => onOpenProjectChat(chat._id)}
                  className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a] transition-colors cursor-pointer"
                >
                  <div className={PROJECT_TREE_CHEVRON_COL} aria-hidden />
                  <div className={PROJECT_TREE_ICON_COL}>
                    <MessageSquare size={12} />
                  </div>
                  <span className="flex-1 truncate">{chat.title}</span>
                  <button
                    type="button"
                    onClick={(event) => onDeleteItem('chat', chat._id, event)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              {projectNotes.map((note) => (
                <div
                  key={note._id}
                  onClick={() => onOpenProjectNote(note._id)}
                  className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a] transition-colors cursor-pointer"
                >
                  <div className={PROJECT_TREE_CHEVRON_COL} aria-hidden />
                  <div className={PROJECT_TREE_ICON_COL}>
                    <BookOpen size={12} />
                  </div>
                  <span className="flex-1 truncate">{note.title || 'Untitled'}</span>
                  <button
                    type="button"
                    onClick={(event) => onDeleteItem('note', note._id, event)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              {rootProjectFiles.map((file) => (
                <ProjectFileTreeNode
                  key={file._id}
                  file={file}
                  allFiles={allProjectFiles}
                  depth={0}
                  baseIndentPx={PROJECT_TREE_GUTTER_PX}
                  expandedIds={expandedFileIds}
                  onToggleFolder={onToggleFileFolder}
                  onOpenFile={onOpenProjectFile}
                  onDeleteFile={onDeleteProjectFile}
                />
              ))}
              {subprojects.length === 0 && projectChats.length === 0 && projectNotes.length === 0 && allProjectFiles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
                  <FolderOpen size={28} strokeWidth={1} className="opacity-40" />
                  <p className="text-xs">Empty project</p>
                  <p className="text-[10px]">Use + to add items</p>
                </div>
              )}
            </div>
          )
        ) : (
          rootProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#aaa] text-center">
              <FolderOpen size={28} strokeWidth={1} className="opacity-40" />
              <p className="text-xs">No projects yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {rootProjects.map((project) => renderRootProject(project))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
