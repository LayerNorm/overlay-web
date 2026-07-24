'use client'

import { useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen, RefreshCw, X } from 'lucide-react'

export interface NativeProjectFileNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children: NativeProjectFileNode[]
  depth: number
}

export function buildNativeProjectFileTree(paths: readonly string[]): NativeProjectFileNode[] {
  const root: NativeProjectFileNode[] = []
  for (const rawPath of paths) {
    const normalized = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath
    if (!normalized) continue
    const parts = normalized.split('/').filter(Boolean)
    let children = root
    let relativePath = ''
    parts.forEach((part, depth) => {
      relativePath = relativePath ? `${relativePath}/${part}` : part
      const isFile = depth === parts.length - 1
      let node = children.find((candidate) => candidate.name === part)
      if (!node) {
        node = {
          name: part,
          relativePath,
          type: isFile ? 'file' : 'directory',
          children: [],
          depth,
        }
        children.push(node)
      } else if (!isFile) {
        node.type = 'directory'
      }
      if (!isFile) children = node.children
    })
  }

  const sort = (nodes: NativeProjectFileNode[]): void => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    nodes.forEach((node) => sort(node.children))
  }
  sort(root)
  return root
}

function NativeFileTreeRow({
  node,
  modifiedPaths,
  onOpenFile,
}: {
  node: NativeProjectFileNode
  modifiedPaths: ReadonlySet<string>
  onOpenFile?(path: string): void
}) {
  const [expanded, setExpanded] = useState(node.depth === 0)
  const directory = node.type === 'directory'
  const modified = modifiedPaths.has(node.relativePath)
  const activate = (): void => {
    if (directory) setExpanded((current) => !current)
    else onOpenFile?.(node.relativePath)
  }

  return (
    <div>
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{ paddingLeft: 8 + node.depth * 14 }}
        onClick={activate}
        aria-expanded={directory ? expanded : undefined}
        aria-label={`${directory ? 'Folder' : 'File'} ${node.name}`}
      >
        {directory ? (
          <>
            <ChevronRight
              size={11}
              className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            {expanded ? <FolderOpen size={13} className="shrink-0" /> : <Folder size={13} className="shrink-0" />}
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" aria-hidden />
            <File size={12} className="shrink-0" />
          </>
        )}
        <span className={`min-w-0 flex-1 truncate font-mono ${modified ? 'text-emerald-500' : ''}`}>
          {node.name}
        </span>
        {modified ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Modified" /> : null}
      </button>
      {directory && expanded
        ? node.children.map((child) => (
            <NativeFileTreeRow
              key={child.relativePath}
              node={child}
              modifiedPaths={modifiedPaths}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </div>
  )
}

export function NativeProjectFileTree({
  label,
  nodes,
  modifiedPaths = new Set<string>(),
  loading = false,
  error = null,
  closing = false,
  onRefresh,
  onClose,
  onOpenFile,
}: {
  label: string
  nodes: readonly NativeProjectFileNode[]
  modifiedPaths?: ReadonlySet<string>
  loading?: boolean
  error?: string | null
  closing?: boolean
  onRefresh(): void
  onClose(): void
  onOpenFile?(path: string): void
}) {
  return (
    <aside
      aria-label={`${label} files`}
      className={`shared-app-scope flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-opacity ${closing ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <FolderOpen size={14} className="shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]">{label}</span>
        <button type="button" onClick={onRefresh} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-subtle)]" aria-label="Refresh project files">
          <RefreshCw size={12} />
        </button>
        <button type="button" onClick={onClose} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-subtle)]" aria-label="Close project files">
          <X size={12} />
        </button>
      </div>
      {modifiedPaths.size > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-[10px] text-emerald-500">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {modifiedPaths.size} file{modifiedPaths.size === 1 ? '' : 's'} modified
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {loading ? (
          <p className="px-3 py-3 text-xs text-[var(--muted)]">Loading…</p>
        ) : error ? (
          <p role="alert" className="px-3 py-3 text-xs text-red-500">{error}</p>
        ) : nodes.length === 0 ? (
          <p className="px-3 py-3 text-xs text-[var(--muted)]">No files found</p>
        ) : (
          nodes.map((node) => (
            <NativeFileTreeRow
              key={node.relativePath}
              node={node}
              modifiedPaths={modifiedPaths}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </aside>
  )
}
