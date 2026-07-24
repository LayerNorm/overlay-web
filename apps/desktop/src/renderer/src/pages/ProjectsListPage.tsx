import { useState, useEffect, useCallback, useMemo, ReactElement } from 'react'
import { FolderOpen, Folder as FolderIcon, ChevronRight, Trash2 } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { desktopAppJson } from '../services/app-api-client'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'
import {
  loadProjects,
  type Project,
  PROJECTS_CHANGED_EVENT
} from '../utils/projectStorage'

interface ProjectsListPageProps {
  theme: Theme
  refreshToken?: number
  selectedProjectId?: string | null
  onSelectProject?: (id: string) => void
}

function ProjectNode({
  project,
  allProjects,
  depth,
  expanded,
  onToggle,
  onDelete,
  onRename,
  onSelect,
  selectedProjectId,
  theme,
}: {
  project: Project
  allProjects: Project[]
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  onRename: (id: string, name: string) => void
  onSelect?: (id: string) => void
  selectedProjectId?: string | null
  theme: Theme
}): ReactElement {
  const children = useMemo(
    () => allProjects.filter((p) => p.parentId === project.id),
    [allProjects, project.id]
  )
  const isOpen = expanded.has(project.id)
  const isSelected = selectedProjectId === project.id
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== project.name) onRename(project.id, trimmed)
    setEditing(false)
  }

  return (
    <div>
      <SidebarListItem
        depth={depth}
        icon={isOpen ? FolderOpen : FolderIcon}
        label={editing ? '' : project.name}
        isActive={isSelected}
        onClick={() => onSelect?.(project.id)}
        theme={theme}
        leading={
          <button
            onClick={(event) => {
              event.stopPropagation()
              if (children.length > 0) onToggle(project.id)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: children.length > 0 ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              color: theme.textSecondary,
              opacity: children.length > 0 ? 1 : 0,
              width: '14px',
            }}
          >
            <ChevronRight
              size={12}
              style={{
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
        }
        actions={
          editing ? undefined : (
            <SidebarItemAction
              onClick={(e) => onDelete(project.id, e)}
              title="Delete project"
              icon={Trash2}
              color={theme.textSecondary}
            />
          )
        }
      />

      {/* Inline edit input — rendered below the item when editing */}
      {editing && (
        <div style={{ paddingLeft: 10 + depth * 16 + 14 + 13 + 6 }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(project.name)
                setEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              fontSize: '12px',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          />
        </div>
      )}

      {isOpen && children.length > 0 && (
        <div>
          {children.map((child) => (
            <ProjectNode
              key={child.id}
              project={child}
              allProjects={allProjects}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onDelete={onDelete}
              onRename={onRename}
              onSelect={onSelect}
              selectedProjectId={selectedProjectId}
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectsListPage({
  theme,
  refreshToken = 0,
  selectedProjectId,
  onSelectProject
}: ProjectsListPageProps): ReactElement {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const remoteProjects = await desktopAppJson<
        Array<{
          _id: string
          name: string
          parentId?: string | null
          instructions?: string
          createdAt: number
          updatedAt: number
        }>
      >('/api/v1/projects')
      setProjects(
        remoteProjects.map((project) => ({
          id: project._id,
          name: project.name,
          parentId: project.parentId ?? null,
          instructions: project.instructions,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        }))
      )
    } catch (error) {
      console.warn('[ProjectsListPage] Failed to load cloud projects; using local cache:', error)
      setProjects(loadProjects())
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    const handler = () => void refresh()
    window.addEventListener('storage', handler)
    window.addEventListener(PROJECTS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handler)
    }
  }, [refresh])

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      void desktopAppJson(`/api/v1/projects?projectId=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      }).finally(() => void refresh())
    },
    [refresh]
  )

  const handleRename = useCallback(
    (id: string, name: string) => {
      void desktopAppJson('/api/v1/projects', {
        method: 'PATCH',
        body: JSON.stringify({ projectId: id, name })
      }).finally(() => void refresh())
    },
    [refresh]
  )

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const rootProjects = useMemo(
    () =>
      projects
        .filter((p) => p.parentId === null)
        .sort((a, b) => a.createdAt - b.createdAt),
    [projects]
  )

  const isDark = theme.isDark

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 8px 8px',
        }}
      >
        {rootProjects.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary,
            }}
          >
            <FolderOpen
              size={28}
              strokeWidth={1}
              style={{ opacity: 0.35, color: isDark ? '#fafafa' : '#0a0a0a' }}
            />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>No projects yet</span>
          </div>
        ) : (
          rootProjects.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              allProjects={projects}
              depth={0}
              expanded={expanded}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onRename={handleRename}
              onSelect={onSelectProject}
              selectedProjectId={selectedProjectId}
              theme={theme}
            />
          ))
        )}
      </div>
    </div>
  )
}
