'use client'

import {
  FILE_PARITY_EDITOR_SCENARIOS,
  FILE_PARITY_FILES,
  FILE_PARITY_LIST_SCENARIOS,
  FILE_PARITY_NOTE_HTML,
  FILE_PARITY_VIEWER_SCENARIOS,
  type FileParityEditorScenario,
  type FileParityInstrumentation,
  type FileParityListScenario,
  type FileParitySyncState,
  type FileParityViewerScenario,
} from '@overlay/app-core/file-parity-fixtures'
import {
  createFixtureKnowledgeSurfaceAdapters,
  normalizeKnowledgeSurfaceNode,
  type KnowledgeFileNode,
  type NoteDoc,
} from '@overlay/app-core'
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronRight,
  CloudOff,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { SharedKnowledgeSurface, type SharedKnowledgeRouteState } from './knowledge/surface'
import { FileViewer } from './knowledge/file-viewer'
import { CanonicalNotebookEditor, type NotebookEditorRepository } from './notes/editor'

export type FileParityFixtureScenario =
  | 'gallery'
  | 'states'
  | 'inventory'
  | 'viewers'
  | 'notebook'
  | 'sync'
  | 'surface'

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

function CanonicalFilesSurfaceFixture() {
  const [route, setRoute] = useState<SharedKnowledgeRouteState>({
    file: null, memory: null, folder: null, view: null, layout: 'list', outputFilter: null,
  })
  const files = useMemo(() => FILE_PARITY_FILES.map((file) => ({ ...file })), [])
  const adapters = useMemo(() => createFixtureKnowledgeSurfaceAdapters({
    nodes: files.map(normalizeKnowledgeSurfaceNode),
  }), [files])
  return (
    <div className="shared-app-scope h-[760px] overflow-hidden rounded-xl border border-[var(--border)]">
      <SharedKnowledgeSurface
        mode="files"
        initialFiles={files}
        initialMemories={[]}
        route={route}
        onUpdateQuery={(updates) => setRoute((current) => ({
          ...current,
          file: updates.file === undefined ? current.file : updates.file ?? null,
          folder: updates.folder === undefined ? current.folder : updates.folder ?? null,
          view: updates.view === undefined ? current.view : updates.view ?? null,
          layout: updates.layout === undefined ? current.layout : updates.layout ?? null,
          outputFilter: updates.out === undefined ? current.outputFilter : updates.out ?? null,
        }))}
        adapters={adapters}
        memories={{ list: async () => [], create: async () => ({ ok: true }), delete: async () => true }}
        files={{
          saveContent: async () => true,
          upload: async () => ({ ok: true }),
          isEditable: () => false,
          contentUrl: () => undefined,
          entityChanged: () => undefined,
        }}
        renderFileViewer={() => null}
      />
    </div>
  )
}

const CANONICAL_NOTE_FIXTURE: NoteDoc = {
  _id: 'note-canonical-fixture',
  title: 'Notebook parity',
  content: FILE_PARITY_NOTE_HTML,
  tags: [],
  createdAt: 1_721_264_400_000,
  updatedAt: 1_721_264_460_000,
}

function CanonicalNotebookEditorFixture() {
  const repository = useMemo<NotebookEditorRepository>(() => ({
    list: async () => [CANONICAL_NOTE_FIXTURE],
    get: async (noteId) => noteId === CANONICAL_NOTE_FIXTURE._id ? CANONICAL_NOTE_FIXTURE : null,
    create: async () => CANONICAL_NOTE_FIXTURE,
    save: async ({ title, content }) => ({
      note: { ...CANONICAL_NOTE_FIXTURE, title, content, updatedAt: CANONICAL_NOTE_FIXTURE.updatedAt + 1 },
    }),
  }), [])

  return (
    <div className="shared-app-scope h-[760px] overflow-hidden rounded-xl border border-[var(--border)]">
      <CanonicalNotebookEditor
        noteId={CANONICAL_NOTE_FIXTURE._id}
        hideSidebar
        repository={repository}
        runAgent={async () => new Response(null, { status: 204 })}
        models={[{ id: 'fixture-model', name: 'Fixture model' }]}
        initialModelId="fixture-model"
        onNavigateNote={() => undefined}
        onBackToFiles={() => undefined}
      />
    </div>
  )
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

function ViewerBody({ viewer }: { viewer: FileParityViewerScenario }) {
  // The DOCX fixture is deterministic post-conversion HTML; live DOCX files use
  // the same shared viewer's abortable fetch, Mammoth conversion, and sanitizer.
  if (viewer.kind === 'docx') {
    return <div className="file-parity-document" dangerouslySetInnerHTML={{ __html: viewer.content }} />
  }
  return <FileViewer name={viewer.name} content={viewer.content} url={viewer.source} />
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
          {scenario === 'notebook' ? <CanonicalNotebookEditorFixture /> : null}
          <div className="file-parity-grid file-parity-grid--editors">
            {FILE_PARITY_EDITOR_SCENARIOS.map((editor) => <EditorCard key={editor.id} editor={editor} instrumentation={instrumentation} />)}
          </div>
        </Section>
      ) : null}

      {scenario === 'surface' ? (
        <Section title="Canonical files surface" description="The exact shared renderer used by web and desktop.">
          <CanonicalFilesSurfaceFixture />
        </Section>
      ) : null}

      <span className="sr-only">{FILE_PARITY_FILES.length} deterministic file records</span>
    </div>
  )
}
