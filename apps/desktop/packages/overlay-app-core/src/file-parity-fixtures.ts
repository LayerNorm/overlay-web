import type { KnowledgeFileNode } from './knowledge'

export const FILE_PARITY_FIXTURE_VERSION = '2026-07-20.2' as const
export const FILE_PARITY_FIXTURE_TIMESTAMP = 1_721_433_600_000

export type FileParityLoadState =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'error'

export type FileParitySyncState =
  | 'online'
  | 'offline'
  | 'syncing'
  | 'conflicted'
  | 'migration'

export type FileParityListScenario = {
  id: string
  title: string
  description: string
  loadState: FileParityLoadState
  syncState: FileParitySyncState
  query: string
  selectedId: string | null
  selectedIds: readonly string[]
  contextMenuId: string | null
  files: readonly KnowledgeFileNode[]
  errorMessage?: string
}

export type FileParityViewerKind =
  | 'markdown'
  | 'text'
  | 'csv'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'image'
  | 'audio'
  | 'video'
  | 'missing-preview'

export type FileParityViewerScenario = {
  id: string
  title: string
  kind: FileParityViewerKind
  name: string
  mimeType: string
  content: string
  source?: string
  previewAvailable: boolean
}

export type FileParityEditorState = 'ready' | 'hydrating' | 'saving' | 'conflicted' | 'migration'

export type FileParityEditorScenario = {
  id: string
  title: string
  state: FileParityEditorState
  documentHtml: string
}

const SVG_PREVIEW = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
  <rect width="720" height="420" fill="#e8e2f0"/>
  <circle cx="560" cy="105" r="54" fill="#fff1b8"/>
  <path d="M0 360 190 170l120 122 95-86 210 154H0Z" fill="#9b91a8"/>
  <path d="m130 360 220-245 245 245H130Z" fill="#524a5f"/>
  <text x="28" y="48" font-family="system-ui, sans-serif" font-size="22" fill="#2d2933">Overlay file fixture</text>
</svg>`

export const FILE_PARITY_IMAGE_DATA_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_PREVIEW.trim())}` as const
export const FILE_PARITY_AUDIO_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' as const
export const FILE_PARITY_VIDEO_DATA_URL =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=' as const

const at = (offset: number) => FILE_PARITY_FIXTURE_TIMESTAMP + offset

export const FILE_PARITY_FILES: readonly KnowledgeFileNode[] = [
  {
    _id: 'folder-projects',
    name: 'Projects',
    type: 'folder',
    kind: 'folder',
    parentId: null,
    createdAt: at(-90_000),
    updatedAt: at(-8_000),
  },
  {
    _id: 'folder-launch',
    name: 'Launch research',
    type: 'folder',
    kind: 'folder',
    parentId: 'folder-projects',
    createdAt: at(-80_000),
    updatedAt: at(-7_000),
  },
  {
    _id: 'note-plan',
    clientId: 'fixture-note-plan',
    name: 'Overlay desktop to-dos',
    type: 'file',
    kind: 'note',
    parentId: null,
    previewText: 'Unify hydration, persistence, viewers, and notebook formatting.',
    content: '<p>Unify hydration, persistence, viewers, and notebook formatting.</p>',
    mimeType: 'text/html',
    extension: 'note',
    createdAt: at(-70_000),
    updatedAt: at(-1_000),
  },
  {
    _id: 'note-empty',
    clientId: 'fixture-note-empty',
    name: 'Overlay desktop to-dos',
    type: 'file',
    kind: 'note',
    parentId: 'folder-launch',
    previewText: '',
    content: '',
    mimeType: 'text/html',
    extension: 'note',
    createdAt: at(-65_000),
    updatedAt: at(-2_000),
  },
  {
    _id: 'file-markdown',
    name: 'Release checklist.md',
    type: 'file',
    kind: 'upload',
    parentId: 'folder-launch',
    mimeType: 'text/markdown',
    extension: 'md',
    previewText: '# Release checklist',
    createdAt: at(-60_000),
    updatedAt: at(-3_000),
  },
  {
    _id: 'file-unicode',
    name: '研究ノート — café — مرحبا — launch-analysis-with-an-intentionally-long-name.csv',
    type: 'file',
    kind: 'upload',
    parentId: null,
    mimeType: 'text/csv',
    extension: 'csv',
    previewText: 'Region,Owner,Status',
    createdAt: at(-55_000),
    updatedAt: at(-4_000),
  },
  {
    _id: 'file-pdf',
    name: 'Research brief.pdf',
    type: 'file',
    kind: 'upload',
    parentId: null,
    mimeType: 'application/pdf',
    extension: 'pdf',
    createdAt: at(-50_000),
    updatedAt: at(-5_000),
  },
  {
    _id: 'file-docx',
    name: 'Launch narrative.docx',
    type: 'file',
    kind: 'upload',
    parentId: 'folder-projects',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    createdAt: at(-45_000),
    updatedAt: at(-6_000),
  },
  {
    _id: 'file-image',
    name: 'Concept image.svg',
    type: 'file',
    kind: 'upload',
    parentId: null,
    mimeType: 'image/svg+xml',
    extension: 'svg',
    downloadUrl: FILE_PARITY_IMAGE_DATA_URL,
    createdAt: at(-40_000),
    updatedAt: at(-7_000),
  },
  {
    _id: 'file-audio',
    name: 'Interview excerpt.wav',
    type: 'file',
    kind: 'upload',
    parentId: null,
    mimeType: 'audio/wav',
    extension: 'wav',
    createdAt: at(-35_000),
    updatedAt: at(-8_000),
  },
  {
    _id: 'file-video',
    name: 'Product walkthrough.mp4',
    type: 'file',
    kind: 'upload',
    parentId: null,
    mimeType: 'video/mp4',
    extension: 'mp4',
    createdAt: at(-30_000),
    updatedAt: at(-9_000),
  },
  {
    _id: 'output-image',
    name: 'Generated launch visual.png',
    type: 'file',
    kind: 'output',
    outputType: 'image',
    parentId: null,
    mimeType: 'image/png',
    extension: 'png',
    downloadUrl: FILE_PARITY_IMAGE_DATA_URL,
    createdAt: at(-25_000),
    updatedAt: at(-10_000),
  },
  {
    _id: 'output-video',
    name: 'Generated launch reel.mp4',
    type: 'file',
    kind: 'output',
    outputType: 'video',
    parentId: null,
    mimeType: 'video/mp4',
    extension: 'mp4',
    createdAt: at(-20_000),
    updatedAt: at(-11_000),
  },
] as const

function listScenario(
  overrides: Partial<FileParityListScenario> & Pick<FileParityListScenario, 'id' | 'title' | 'description'>,
): FileParityListScenario {
  return {
    loadState: 'ready',
    syncState: 'online',
    query: '',
    selectedId: null,
    selectedIds: [],
    contextMenuId: null,
    files: FILE_PARITY_FILES,
    ...overrides,
  }
}

export const FILE_PARITY_LIST_SCENARIOS: readonly FileParityListScenario[] = [
  listScenario({ id: 'empty', title: 'Empty', description: 'No files or folders.', loadState: 'empty', files: [] }),
  listScenario({ id: 'loading', title: 'Loading', description: 'Initial request before cached data is available.', loadState: 'loading' }),
  listScenario({ id: 'refreshing', title: 'Refreshing', description: 'Cached rows remain visible during refresh.', loadState: 'refreshing' }),
  listScenario({ id: 'error', title: 'Error', description: 'The latest refresh failed without discarding cached rows.', loadState: 'error', errorMessage: 'Could not refresh files. Showing the last saved copy.' }),
  listScenario({ id: 'inventory', title: 'Inventory', description: 'Files, folders, notes, outputs, duplicate names, Unicode, and nested folders.' }),
  listScenario({ id: 'search', title: 'Search', description: 'A deterministic search result with ancestor folders retained.', query: 'launch' }),
  listScenario({ id: 'selected-row', title: 'Selected row', description: 'One file is open in the viewer.', selectedId: 'file-markdown' }),
  listScenario({ id: 'bulk-selection', title: 'Bulk selection', description: 'Multiple rows are selected.', selectedIds: ['note-plan', 'file-pdf', 'output-image'] }),
  listScenario({ id: 'context-menu', title: 'Context menu', description: 'Row actions are open and keyboard reachable.', selectedId: 'note-plan', contextMenuId: 'note-plan' }),
  listScenario({ id: 'offline', title: 'Offline', description: 'Cached files remain available offline.', syncState: 'offline' }),
  listScenario({ id: 'syncing', title: 'Syncing', description: 'Local changes are uploading.', syncState: 'syncing' }),
  listScenario({ id: 'conflicted', title: 'Conflict', description: 'A local and remote note both changed.', syncState: 'conflicted', selectedId: 'note-plan' }),
  listScenario({ id: 'migration', title: 'Migration', description: 'Legacy local notes are being assigned canonical identities.', syncState: 'migration' }),
] as const

const MARKDOWN = `# Release readiness

- [x] Deterministic fixtures
- [ ] Desktop cutover

| Surface | Status |
| --- | --- |
| Web | Source of truth |
| Desktop | Baseline only |

\`\`\`ts
const parity = true
\`\`\``

export const FILE_PARITY_VIEWER_SCENARIOS: readonly FileParityViewerScenario[] = [
  { id: 'viewer-markdown', title: 'Markdown', kind: 'markdown', name: 'release.md', mimeType: 'text/markdown', content: MARKDOWN, previewAvailable: true },
  { id: 'viewer-text', title: 'Text', kind: 'text', name: 'notes.txt', mimeType: 'text/plain', content: 'Plain text preserves\nline breaks and spacing.', previewAvailable: true },
  { id: 'viewer-csv', title: 'CSV', kind: 'csv', name: 'launch.csv', mimeType: 'text/csv', content: 'Region,Owner,Status\nNorth America,Ada,Ready\nEurope,Grace,Review', previewAvailable: true },
  { id: 'viewer-html', title: 'HTML', kind: 'html', name: 'prototype.html', mimeType: 'text/html', content: '<main><h1>Prototype</h1><p>Sandboxed fixture content.</p></main>', previewAvailable: true },
  { id: 'viewer-pdf', title: 'PDF', kind: 'pdf', name: 'brief.pdf', mimeType: 'application/pdf', content: 'Extracted PDF text remains searchable when the original preview is unavailable.', previewAvailable: true },
  { id: 'viewer-docx', title: 'DOCX', kind: 'docx', name: 'narrative.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: '<h1>Launch narrative</h1><p>Converted document preview.</p>', previewAvailable: true },
  { id: 'viewer-image', title: 'Image', kind: 'image', name: 'concept.svg', mimeType: 'image/svg+xml', content: '', source: FILE_PARITY_IMAGE_DATA_URL, previewAvailable: true },
  { id: 'viewer-audio', title: 'Audio', kind: 'audio', name: 'interview.wav', mimeType: 'audio/wav', content: '', source: FILE_PARITY_AUDIO_DATA_URL, previewAvailable: true },
  { id: 'viewer-video', title: 'Video', kind: 'video', name: 'walkthrough.mp4', mimeType: 'video/mp4', content: '', source: FILE_PARITY_VIDEO_DATA_URL, previewAvailable: true },
  { id: 'viewer-missing', title: 'Missing preview', kind: 'missing-preview', name: 'archive.pages', mimeType: 'application/octet-stream', content: '', previewAvailable: false },
] as const

export const FILE_PARITY_NOTE_HTML = `
<h1>Notebook parity</h1>
<p>Formatting includes <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <mark>highlight</mark>, and <a href="https://example.com">links</a>.</p>
<h2>Tasks and structure</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked disabled></label><div><p>Capture deterministic fixtures</p></div></li>
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox" disabled></label><div><p>Cut over the production desktop editor later</p></div></li>
</ul>
<blockquote><p>The web remains the visual source of truth.</p></blockquote>
<table><thead><tr><th>Surface</th><th>State</th></tr></thead><tbody><tr><td>Web</td><td>Canonical</td></tr><tr><td>Desktop</td><td>Fixture</td></tr></tbody></table>
<pre><code>const save = await editor.flush()</code></pre>
<p>Inline math: <span class="Tiptap-mathematics-render">E = mc²</span></p>
<p><img src="${FILE_PARITY_IMAGE_DATA_URL}" alt="Fixture landscape"></p>
`.trim()

export const FILE_PARITY_EDITOR_SCENARIOS: readonly FileParityEditorScenario[] = [
  { id: 'editor-ready', title: 'Ready', state: 'ready', documentHtml: FILE_PARITY_NOTE_HTML },
  { id: 'editor-hydrating', title: 'Hydrating', state: 'hydrating', documentHtml: FILE_PARITY_NOTE_HTML },
  { id: 'editor-saving', title: 'Saving', state: 'saving', documentHtml: FILE_PARITY_NOTE_HTML },
  { id: 'editor-conflicted', title: 'Conflict', state: 'conflicted', documentHtml: FILE_PARITY_NOTE_HTML },
  { id: 'editor-migration', title: 'Migration', state: 'migration', documentHtml: FILE_PARITY_NOTE_HTML },
] as const

export type FileParityCounterSnapshot = {
  fetches: number
  mounts: Record<string, number>
  renders: Record<string, number>
  editorHydrations: number
  editorSaveQueued: number
  editorSaveCommitted: number
}

export type FileParityInstrumentation = {
  recordFetch(): void
  recordMount(component: string): void
  recordRender(component: string): void
  recordEditorHydration(): void
  recordEditorSave(stage: 'queued' | 'committed'): void
  snapshot(): FileParityCounterSnapshot
}

export function createFileParityInstrumentation(): FileParityInstrumentation {
  const counters: FileParityCounterSnapshot = {
    fetches: 0,
    mounts: {},
    renders: {},
    editorHydrations: 0,
    editorSaveQueued: 0,
    editorSaveCommitted: 0,
  }
  const increment = (record: Record<string, number>, key: string) => {
    record[key] = (record[key] ?? 0) + 1
  }
  return {
    recordFetch: () => { counters.fetches += 1 },
    recordMount: (component) => increment(counters.mounts, component),
    recordRender: (component) => increment(counters.renders, component),
    recordEditorHydration: () => { counters.editorHydrations += 1 },
    recordEditorSave: (stage) => {
      if (stage === 'queued') counters.editorSaveQueued += 1
      else counters.editorSaveCommitted += 1
    },
    snapshot: () => ({
      ...counters,
      mounts: { ...counters.mounts },
      renders: { ...counters.renders },
    }),
  }
}
