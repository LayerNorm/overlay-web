'use client'

import type {
ConversationSummary,
KnowledgeFile,
NoteDoc,
ProjectSummary
} from '@overlay/app-core'
import type { TreeNode } from '@overlay/app-core/modules'
import { Badge,Button,EmptyState,cn } from '@overlay/ui'
import { type ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'

export interface ProjectsModuleShellProps {
  projects: readonly TreeNode<ProjectSummary>[]
  selectedProjectId?: string | null
  loading?: boolean
  sidebarActions?: ReactNode
  detail?: ReactNode
  onSelectProject?: (project: ProjectSummary) => void
  onCreateProject?: () => void
  onRenameProject?: (project: ProjectSummary) => void
  onDeleteProject?: (project: ProjectSummary) => void
}

export function ProjectsModuleShell({
  projects,
  selectedProjectId,
  loading,
  sidebarActions,
  detail,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
}: ProjectsModuleShellProps) {
  return (
    <AppScreenShell
      sidebarBehavior="always"
      sidebarClassName="w-72"
      sidebar={
        <>
          <AppScreenHeader className="min-h-14 px-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h1 className="text-sm font-semibold">Projects</h1>
              <div className="flex items-center gap-1">
                {sidebarActions}
                {onCreateProject ? (
                  <Button size="sm" variant="ghost" onClick={onCreateProject}>
                    New
                  </Button>
                ) : null}
              </div>
            </div>
          </AppScreenHeader>
        <ProjectTree
          nodes={projects}
          selectedProjectId={selectedProjectId}
          loading={loading}
          onSelectProject={onSelectProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
        </>
      }
    >
      <AppScreenBody padding="none" maxWidth="none">
        {detail ?? <EmptyState className="h-full" title="Select a project" />}
      </AppScreenBody>
    </AppScreenShell>
  )
}

export interface ProjectTreeProps {
  nodes: readonly TreeNode<ProjectSummary>[]
  selectedProjectId?: string | null
  loading?: boolean
  onSelectProject?: (project: ProjectSummary) => void
  onRenameProject?: (project: ProjectSummary) => void
  onDeleteProject?: (project: ProjectSummary) => void
}

export function ProjectTree({
  nodes,
  selectedProjectId,
  loading,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
}: ProjectTreeProps) {
  if (loading) return <div className="px-3 py-3 text-xs text-[var(--muted)]">Loading projects...</div>
  if (nodes.length === 0) return <EmptyState className="h-full px-4" title="No projects yet" />
  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      {nodes.map((node) => (
        <ProjectTreeRow
          key={node.item._id}
          node={node}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
      ))}
    </div>
  )
}

function ProjectTreeRow({
  node,
  selectedProjectId,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
}: {
  node: TreeNode<ProjectSummary>
  selectedProjectId?: string | null
  onSelectProject?: (project: ProjectSummary) => void
  onRenameProject?: (project: ProjectSummary) => void
  onDeleteProject?: (project: ProjectSummary) => void
}) {
  const project = node.item
  return (
    <div>
      <div
        className={cn(
          'group/row flex min-h-9 items-center gap-2 px-3 text-sm transition-colors',
          selectedProjectId === project._id
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]',
        )}
        style={{ paddingLeft: 12 + node.depth * 16 }}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => onSelectProject?.(project)}
        >
          {project.name}
        </button>
        <div className="hidden shrink-0 items-center gap-1 group-hover/row:flex">
          {onRenameProject ? (
            <button type="button" className="text-xs text-[var(--muted)]" onClick={() => onRenameProject(project)}>
              Rename
            </button>
          ) : null}
          {onDeleteProject ? (
            <button type="button" className="text-xs text-[var(--muted)]" onClick={() => onDeleteProject(project)}>
              Delete
            </button>
          ) : null}
        </div>
      </div>
      {node.children.map((child) => (
        <ProjectTreeRow
          key={child.item._id}
          node={child}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
      ))}
    </div>
  )
}

export interface ProjectDetailProps {
  project: ProjectSummary | null
  conversations?: readonly ConversationSummary[]
  notes?: readonly NoteDoc[]
  files?: readonly KnowledgeFile[]
  actions?: ReactNode
}

export function ProjectDetail({ project, conversations = [], notes = [], files = [], actions }: ProjectDetailProps) {
  if (!project) return <EmptyState className="h-full" title="Select a project" />
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{project.name}</h2>
          {project.instructions ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{project.instructions}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <ProjectStat label="Chats" value={conversations.length} />
        <ProjectStat label="Notes" value={notes.length} />
        <ProjectStat label="Files" value={files.length} />
      </div>
      <div className="mt-6 space-y-3">
        {[...conversations, ...notes, ...files].slice(0, 8).map((item) => (
          <div key={item._id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2">
            <p className="truncate text-sm font-medium">{'title' in item ? item.title : item.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Updated {new Date(item.updatedAt).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xl font-semibold">{value}</p>
        <Badge variant="muted">{label.toLowerCase()}</Badge>
      </div>
    </div>
  )
}
