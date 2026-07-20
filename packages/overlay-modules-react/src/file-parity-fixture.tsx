'use client'

import {
  FILE_PARITY_EDITOR_SCENARIOS,
  FILE_PARITY_FILES,
  FILE_PARITY_LIST_SCENARIOS,
  FILE_PARITY_VIEWER_SCENARIOS,
  type FileParityEditorScenario,
  type FileParityInstrumentation,
  type FileParityListScenario,
  type FileParitySyncState,
  type FileParityViewerScenario,
} from '@overlay/app-core/file-parity-fixtures'
import type { KnowledgeFileNode } from '@overlay/app-core'
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronRight,
  CircleEllipsis,
  CloudOff,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, type CSSProperties, type ReactNode } from 'react'

export type FileParityFixtureScenario =
  | 'gallery'
  | 'states'
  | 'inventory'
  | 'viewers'
  | 'notebook'
  | 'sync'

export type FileParityFixtureSurfaceProps = {
  platform: 'web' | 'desktop'
  scenario: FileParityFixtureScenario
  instrumentation: FileParityInstrumentation
  onReady?: () => void
}

const SYNC_LABELS: Record<FileParitySyncState, string> = {
  online: 'Up to date',
  offline: 'Offline copy',
  syncing: 'Syncing changes',
  conflicted: 'Resolve conflict',
  migration: 'Migrating notes',
}

function titleMatches(file: KnowledgeFileNode, query: string): boolean {
  return !query || file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

function visibleFiles(scenario: FileParityListScenario): KnowledgeFileNode[] {
  if (!scenario.query) return [...scenario.files]
  const matched = new Set(
    scenario.files.filter((file) => titleMatches(file, scenario.query)).map((file) => file._id),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const file of scenario.files) {
      if (!matched.has(file._id)) continue
      if (file.parentId && !matched.has(file.parentId)) {
        matched.add(file.parentId)
        changed = true
      }
    }
  }
  return scenario.files.filter((file) => matched.has(file._id))
}

function fileDepth(file: KnowledgeFileNode, allFiles: readonly KnowledgeFileNode[]): number {
  let depth = 0
  let parentId = file.parentId
  while (parentId && depth < 8) {
    depth += 1
    parentId = allFiles.find((candidate) => candidate._id === parentId)?.parentId ?? null
  }
  return depth
}

function FileIcon({ file }: { file: KnowledgeFileNode }) {
  if (file.type === 'folder') return <Folder size={16} />
  if (file.kind === 'note') return <BookOpen size={16} />
  if (file.mimeType?.startsWith('image/')) return <FileImage size={16} />
  if (file.mimeType?.startsWith('audio/')) return <FileAudio size={16} />
  if (file.mimeType?.startsWith('video/')) return <FileVideo size={16} />
  if (file.mimeType?.includes('html') || file.mimeType?.includes('markdown')) return <FileCode2 size={16} />
  return <FileText size={16} />
}

function SyncBadge({ state }: { state: FileParitySyncState }) {
  const Icon =
    state === 'offline'
      ? CloudOff
      : state === 'syncing' || state === 'migration'
        ? RefreshCw
        : state === 'conflicted'
          ? TriangleAlert
          : Check
  return (
    <span className={`file-parity-sync file-parity-sync--${state}`} data-sync-state={state}>
      <Icon size={12} aria-hidden />
      {SYNC_LABELS[state]}
    </span>
  )
}

function StateNotice({ scenario }: { scenario: FileParityListScenario }) {
  if (scenario.loadState === 'loading') {
    return (
      <div className="file-parity-empty">
        <LoaderCircle size={22} className="animate-spin" />
        <span>Loading files</span>
      </div>
    )
  }
  if (scenario.loadState === 'empty') {
    return (
      <div className="file-parity-empty">
        <FileText size={22} />
        <span>No files yet</span>
      </div>
    )
  }
  return null
}

function FileRows({
  scenario,
  compact = false,
}: {
  scenario: FileParityListScenario
  compact?: boolean
}) {
  const files = visibleFiles(scenario)
  const selectedIds = new Set(scenario.selectedIds)
  return (
    <div className="file-parity-list" data-compact={compact || undefined}>
      {files.map((file) => {
        const selected = scenario.selectedId === file._id
        const bulkSelected = selectedIds.has(file._id)
        const menuOpen = scenario.contextMenuId === file._id
        return (
          <div
            className="file-parity-row-wrap"
            key={file._id}
            style={{ '--file-depth': fileDepth(file, scenario.files) } as CSSProperties}
          >
            <button
              type="button"
              className="file-parity-row"
              data-selected={selected || undefined}
              data-bulk-selected={bulkSelected || undefined}
              aria-pressed={selected || bulkSelected}
            >
              {scenario.selectedIds.length ? (
                <span className="file-parity-checkbox" data-checked={bulkSelected || undefined}>
                  {bulkSelected ? <Check size={11} /> : null}
                </span>
              ) : null}
              <span className="file-parity-row__icon"><FileIcon file={file} /></span>
              <span className="file-parity-row__name">{file.name}</span>
              {file.kind === 'output' ? <span className="file-parity-kind">Output</span> : null}
              {file.type === 'folder' ? <ChevronRight size={13} className="file-parity-row__chevron" /> : null}
              <span className="file-parity-row__actions" aria-hidden={!menuOpen}>
                <MoreHorizontal size={15} />
              </span>
            </button>
            {menuOpen ? (
              <div className="file-parity-context-menu" role="menu">
                <button type="button" role="menuitem">Open</button>
                <button type="button" role="menuitem">Move to folder</button>
                <button type="button" role="menuitem">Rename</button>
                <button type="button" role="menuitem" data-danger>Delete</button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function FileStateCard({
  scenario,
  instrumentation,
}: {
  scenario: FileParityListScenario
  instrumentation: FileParityInstrumentation
}) {
  instrumentation.recordRender('FileStateCard')
  return (
    <article className="file-parity-card" data-state={scenario.loadState}>
      <header className="file-parity-card__header">
        <div>
          <h3>{scenario.title}</h3>
          <p>{scenario.description}</p>
        </div>
        <SyncBadge state={scenario.syncState} />
      </header>
      {scenario.query ? (
        <div className="file-parity-search"><Search size={13} /><span>{scenario.query}</span></div>
      ) : null}
      {scenario.loadState === 'refreshing' ? (
        <div className="file-parity-notice"><RefreshCw size={12} className="animate-spin" /> Refreshing</div>
      ) : null}
      {scenario.loadState === 'error' ? (
        <div className="file-parity-notice file-parity-notice--error"><AlertCircle size={12} /> {scenario.errorMessage}</div>
      ) : null}
      <StateNotice scenario={scenario} />
      {scenario.loadState !== 'empty' && scenario.loadState !== 'loading' ? (
        <FileRows scenario={scenario} compact />
      ) : null}
    </article>
  )
}

function parseCsv(content: string): string[][] {
  return content.split(/\r?\n/).map((line) => line.split(','))
}

function ViewerBody({ viewer }: { viewer: FileParityViewerScenario }) {
  // Shared web/Electron fixture; Next's image runtime is intentionally unavailable here.
  // eslint-disable-next-line @next/next/no-img-element
  if (viewer.kind === 'image') return <img src={viewer.source} alt={viewer.name} />
  if (viewer.kind === 'audio') return <audio controls src={viewer.source} />
  if (viewer.kind === 'video') {
    return (
      <div className="file-parity-video-preview">
        <video aria-label={viewer.name} muted preload="none" src={viewer.source} />
        <span><Play size={11} fill="currentColor" /> 0:00</span>
      </div>
    )
  }
  if (viewer.kind === 'csv') {
    const [headers = [], ...rows] = parseCsv(viewer.content)
    return (
      <table><thead><tr>{headers.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
      </table>
    )
  }
  if (viewer.kind === 'html' || viewer.kind === 'docx') {
    return <div className="file-parity-document" dangerouslySetInnerHTML={{ __html: viewer.content }} />
  }
  if (viewer.kind === 'markdown') {
    return (
      <div className="file-parity-markdown">
        <h1>Release readiness</h1>
        <ul><li>☑ Deterministic fixtures</li><li>☐ Desktop cutover</li></ul>
        <table><thead><tr><th>Surface</th><th>Status</th></tr></thead><tbody><tr><td>Web</td><td>Source of truth</td></tr><tr><td>Desktop</td><td>Baseline only</td></tr></tbody></table>
        <pre><code>const parity = true</code></pre>
      </div>
    )
  }
  if (viewer.kind === 'missing-preview') {
    return <div className="file-parity-missing"><CircleEllipsis size={25} /><span>Preview not available</span></div>
  }
  return <pre>{viewer.content}</pre>
}

function ViewerCard({
  viewer,
  instrumentation,
}: {
  viewer: FileParityViewerScenario
  instrumentation: FileParityInstrumentation
}) {
  instrumentation.recordRender('FileViewerFixture')
  return (
    <article className="file-parity-viewer" data-viewer-kind={viewer.kind}>
      <header><span>{viewer.title}</span><code>{viewer.name}</code></header>
      <div className="file-parity-viewer__body"><ViewerBody viewer={viewer} /></div>
    </article>
  )
}

function EditorCard({
  editor,
  instrumentation,
}: {
  editor: FileParityEditorScenario
  instrumentation: FileParityInstrumentation
}) {
  instrumentation.recordRender('NotebookEditorFixture')
  return (
    <article className="file-parity-editor-card" data-editor-state={editor.state}>
      <header>
        <div><span>Notebook parity</span><small>{editor.title}</small></div>
        <span className={`file-parity-editor-status file-parity-editor-status--${editor.state}`}>{editor.state}</span>
      </header>
      <div className="app-note-editor" dangerouslySetInnerHTML={{ __html: editor.documentHtml }} />
    </article>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="file-parity-section">
      <header className="file-parity-section__header"><div><h2>{title}</h2><p>{description}</p></div></header>
      {children}
    </section>
  )
}

export function FileParityFixtureSurface({
  platform,
  scenario,
  instrumentation,
  onReady,
}: FileParityFixtureSurfaceProps) {
  instrumentation.recordRender('FileParityFixtureSurface')

  useEffect(() => {
    instrumentation.recordMount('FileParityFixtureSurface')
    instrumentation.recordFetch()
    if (scenario === 'gallery' || scenario === 'notebook') {
      instrumentation.recordEditorHydration()
      instrumentation.recordEditorSave('queued')
      instrumentation.recordEditorSave('committed')
    }
    const frame = requestAnimationFrame(() => onReady?.())
    return () => cancelAnimationFrame(frame)
  }, [instrumentation, onReady, scenario])

  const stateScenarios = FILE_PARITY_LIST_SCENARIOS.filter((item) =>
    ['empty', 'loading', 'refreshing', 'error'].includes(item.id),
  )
  const syncScenarios = FILE_PARITY_LIST_SCENARIOS.filter((item) =>
    ['offline', 'syncing', 'conflicted', 'migration'].includes(item.id),
  )
  const inventory = FILE_PARITY_LIST_SCENARIOS.find((item) => item.id === 'inventory')!
  const interactionScenarios = FILE_PARITY_LIST_SCENARIOS.filter((item) =>
    ['search', 'selected-row', 'bulk-selection', 'context-menu'].includes(item.id),
  )

  return (
    <div className="overlay-knowledge-surface file-parity-fixture" data-platform={platform} data-scenario={scenario}>
      {(scenario === 'gallery' || scenario === 'states') ? (
        <Section title="Loading and refresh states" description="Cached data remains stable across loading, refreshing, and errors.">
          <div className="file-parity-grid file-parity-grid--states">
            {stateScenarios.map((item) => <FileStateCard key={item.id} scenario={item} instrumentation={instrumentation} />)}
          </div>
        </Section>
      ) : null}

      {(scenario === 'gallery' || scenario === 'inventory') ? (
        <Section title="Files and interactions" description="Nested folders, duplicate names, Unicode, search, selection, and row menus.">
          <div className="file-parity-layout">
            <FileStateCard scenario={inventory} instrumentation={instrumentation} />
            <div className="file-parity-grid file-parity-grid--interactions">
              {interactionScenarios.map((item) => <FileStateCard key={item.id} scenario={item} instrumentation={instrumentation} />)}
            </div>
          </div>
        </Section>
      ) : null}

      {(scenario === 'gallery' || scenario === 'sync') ? (
        <Section title="Offline, sync, conflicts, and migration" description="Durable local states render without live network data.">
          <div className="file-parity-grid file-parity-grid--states">
            {syncScenarios.map((item) => <FileStateCard key={item.id} scenario={item} instrumentation={instrumentation} />)}
          </div>
        </Section>
      ) : null}

      {(scenario === 'gallery' || scenario === 'viewers') ? (
        <Section title="File viewers" description="Text and binary formats, including unavailable previews.">
          <div className="file-parity-grid file-parity-grid--viewers">
            {FILE_PARITY_VIEWER_SCENARIOS.map((viewer) => <ViewerCard key={viewer.id} viewer={viewer} instrumentation={instrumentation} />)}
          </div>
        </Section>
      ) : null}

      {(scenario === 'gallery' || scenario === 'notebook') ? (
        <Section title="Notebook editor" description="Formatting, tables, tasks, code, math, images, links, hydration, saves, and conflicts.">
          <div className="file-parity-grid file-parity-grid--editors">
            {FILE_PARITY_EDITOR_SCENARIOS.map((editor) => <EditorCard key={editor.id} editor={editor} instrumentation={instrumentation} />)}
          </div>
        </Section>
      ) : null}

      <span className="sr-only">{FILE_PARITY_FILES.length} deterministic file records</span>
    </div>
  )
}
