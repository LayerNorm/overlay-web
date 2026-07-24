'use client'

import type {
ProjectResourceItems,
ProjectRouteView,
ProjectSummary
} from '@overlay/app-core'
import { projectRouteViewForFile,rootProjectFiles } from '@overlay/app-core'
import { BookOpen,ChevronRight,Folder,FolderOpen,MessageSquare,Pencil,Trash2 } from 'lucide-react'
import { useState,type MouseEvent,type ReactNode } from 'react'

import { FileTypeIcon } from '../shared/file-type-icon'
import { inlineConfirmDeleteButtonClass,panelItemClass } from './shared'

export interface ProjectInlineBranchProps {
  project: ProjectSummary
  allProjects: readonly ProjectSummary[]
  depth: number
  expanded: ReadonlySet<string>
  activeProjectId: string | null
  items: Record<string, ProjectResourceItems>
  itemsLoading: ReadonlySet<string>
  onToggle: (projectId: string) => void
  onOpenProject: (project: ProjectSummary) => void
  onNavigateItem: (project: ProjectSummary, view: ProjectRouteView, id: string) => void
  onDeleteProject: (projectId: string, event: MouseEvent) => void
  onDeleteItem: (type: 'chat' | 'note', id: string, event: MouseEvent) => void
  onRenameProject: (project: ProjectSummary, name: string) => Promise<string | null | undefined> | string | null | undefined
}

export function ProjectInlineBranch({
  project,
  allProjects,
  depth,
  expanded,
  activeProjectId,
  items,
  itemsLoading,
  onToggle,
  onOpenProject,
  onNavigateItem,
  onDeleteProject,
  onDeleteItem,
  onRenameProject,
}: ProjectInlineBranchProps) {
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null)
  const [pendingDeleteItemKey, setPendingDeleteItemKey] = useState<string | null>(null)

  const children = allProjects.filter((candidate) => candidate.parentId === project._id)
  const open = expanded.has(project._id)
  const projectItems = items[project._id]
  const rootFiles = rootProjectFiles(projectItems?.files ?? [])

  async function commitProjectRowRename() {
    if (renamingProjectId !== project._id) return
    const name = renameDraft.trim()
    setRenamingProjectId(null)
    if (!name || name === project.name) return
    await onRenameProject(project, name)
  }

  function requestProjectDelete(event: MouseEvent) {
    event.stopPropagation()
    setRenamingProjectId(null)
    setPendingDeleteProjectId(project._id)
  }

  function requestProjectItemDelete(type: 'chat' | 'note', id: string, event: MouseEvent) {
    event.stopPropagation()
    setPendingDeleteItemKey(`${type}:${id}`)
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onMouseLeave={() => {
          if (pendingDeleteProjectId === project._id) setPendingDeleteProjectId(null)
        }}
        onClick={() => {
          if (renamingProjectId === project._id) return
          onOpenProject(project)
        }}
        onKeyDown={(event) => {
          if (renamingProjectId === project._id) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenProject(project)
          }
        }}
        className={`${panelItemClass} cursor-pointer ${activeProjectId === project._id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle(project._id)
          }}
          className="shrink-0 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]"
          aria-label={open ? 'Collapse project' : 'Expand project'}
        >
          <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {open ? <FolderOpen size={12} className="shrink-0" /> : <Folder size={12} className="shrink-0" />}
        {renamingProjectId === project._id ? (
          <input
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-1 py-0.5 text-xs text-[var(--foreground)] outline-none"
            value={renameDraft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitProjectRowRename()
              }
              if (event.key === 'Escape') {
                setRenamingProjectId(null)
                setRenameDraft('')
              }
            }}
            onBlur={() => void commitProjectRowRename()}
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setPendingDeleteProjectId(null)
            setRenamingProjectId(project._id)
            setRenameDraft(project.name)
          }}
          className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
          aria-label="Rename project"
        >
          <Pencil size={11} />
        </button>
        {pendingDeleteProjectId === project._id ? (
          <button
            type="button"
            onClick={(event) => {
              setPendingDeleteProjectId(null)
              onDeleteProject(project._id, event)
            }}
            className={inlineConfirmDeleteButtonClass}
            aria-label="Confirm delete project"
          >
            Confirm
          </button>
        ) : (
          <button
            type="button"
            onClick={requestProjectDelete}
            className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
            aria-label="Delete project"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-0.5">
          {children.map((child) => (
            <ProjectInlineBranch
              key={child._id}
              project={child}
              allProjects={allProjects}
              depth={depth + 1}
              expanded={expanded}
              activeProjectId={activeProjectId}
              items={items}
              itemsLoading={itemsLoading}
              onToggle={onToggle}
              onOpenProject={onOpenProject}
              onNavigateItem={onNavigateItem}
              onDeleteProject={onDeleteProject}
              onDeleteItem={onDeleteItem}
              onRenameProject={onRenameProject}
            />
          ))}

          {itemsLoading.has(project._id) ? (
            <div className="space-y-1.5 py-1" style={{ paddingLeft: `${34 + depth * 14}px` }} aria-hidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 pr-2">
                  <div className="ui-skeleton-line h-2.5 w-2.5 shrink-0 rounded" />
                  <div
                    className="ui-skeleton-line h-2.5 max-w-[200px] flex-1 rounded"
                    style={{ width: `${78 - i * 6}%` }}
                  />
                </div>
              ))}
            </div>
          ) : projectItems ? (
            <>
              {projectItems.chats.map((chat) => (
                <div
                  key={chat._id}
                  onMouseLeave={() => {
                    if (pendingDeleteItemKey === `chat:${chat._id}`) setPendingDeleteItemKey(null)
                  }}
                  onClick={() => onNavigateItem(project, 'chat', chat._id)}
                  className={`${panelItemClass} cursor-pointer`}
                  style={{ paddingLeft: `${34 + depth * 14}px` }}
                >
                  <MessageSquare size={11} className="shrink-0 text-[var(--muted-light)]" />
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                  {pendingDeleteItemKey === `chat:${chat._id}` ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        setPendingDeleteItemKey(null)
                        onDeleteItem('chat', chat._id, event)
                      }}
                      className={inlineConfirmDeleteButtonClass}
                      aria-label="Confirm delete project chat"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => requestProjectItemDelete('chat', chat._id, event)}
                      className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                      aria-label="Delete project chat"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              ))}
              {projectItems.notes.map((note) => (
                <div
                  key={note._id}
                  onMouseLeave={() => {
                    if (pendingDeleteItemKey === `note:${note._id}`) setPendingDeleteItemKey(null)
                  }}
                  onClick={() => onNavigateItem(project, 'note', note._id)}
                  className={`${panelItemClass} cursor-pointer`}
                  style={{ paddingLeft: `${34 + depth * 14}px` }}
                >
                  <BookOpen size={11} className="shrink-0 text-[var(--muted-light)]" />
                  <span className="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
                  {pendingDeleteItemKey === `note:${note._id}` ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        setPendingDeleteItemKey(null)
                        onDeleteItem('note', note._id, event)
                      }}
                      className={inlineConfirmDeleteButtonClass}
                      aria-label="Confirm delete project note"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => requestProjectItemDelete('note', note._id, event)}
                      className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                      aria-label="Delete project note"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              ))}
              {rootFiles.map((file) => (
                <div
                  key={file._id}
                  onClick={() => onNavigateItem(project, projectRouteViewForFile(file), file._id)}
                  className={`${panelItemClass} cursor-pointer`}
                  style={{ paddingLeft: `${34 + depth * 14}px` }}
                >
                  <FileTypeIcon file={file} size={11} className="text-[var(--muted-light)]" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

export interface ProjectsInlineTreeProps {
  projects: readonly ProjectSummary[]
  rootProjects: readonly ProjectSummary[]
  loading?: boolean
  loadingContent?: ReactNode
  expanded: ReadonlySet<string>
  activeProjectId: string | null
  items: Record<string, ProjectResourceItems>
  itemsLoading: ReadonlySet<string>
  onToggle: (projectId: string) => void
  onOpenProject: (project: ProjectSummary) => void
  onNavigateItem: (project: ProjectSummary, view: ProjectRouteView, id: string) => void
  onDeleteProject: (projectId: string, event: MouseEvent) => void
  onDeleteItem: (type: 'chat' | 'note', id: string, event: MouseEvent) => void
  onRenameProject: (project: ProjectSummary, name: string) => Promise<string | null | undefined> | string | null | undefined
}

export function ProjectsInlineTree({
  projects,
  rootProjects,
  loading,
  loadingContent,
  expanded,
  activeProjectId,
  items,
  itemsLoading,
  onToggle,
  onOpenProject,
  onNavigateItem,
  onDeleteProject,
  onDeleteItem,
  onRenameProject,
}: ProjectsInlineTreeProps) {
  if (loading) return <>{loadingContent ?? <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">Loading...</p>}</>
  if (rootProjects.length === 0) return <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No projects yet</p>
  return (
    <>
      {rootProjects.map((project) => (
        <ProjectInlineBranch
          key={project._id}
          project={project}
          allProjects={projects}
          depth={0}
          expanded={expanded}
          activeProjectId={activeProjectId}
          items={items}
          itemsLoading={itemsLoading}
          onToggle={onToggle}
          onOpenProject={onOpenProject}
          onNavigateItem={onNavigateItem}
          onDeleteProject={onDeleteProject}
          onDeleteItem={onDeleteItem}
          onRenameProject={onRenameProject}
        />
      ))}
    </>
  )
}
