import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const read = (path) => readFileSync(join(root, path), 'utf8')
const requireText = (path, pattern, message) => {
  const source = read(path)
  if (!pattern.test(source)) failures.push(`${path}: ${message}`)
}
const forbidText = (path, pattern, message) => {
  const source = read(path)
  if (pattern.test(source)) failures.push(`${path}: ${message}`)
}

const stylesheets = ['knowledge-surface.css', 'file-viewer.css', 'notebook-editor.css']
for (const stylesheet of stylesheets) {
  const path = `packages/overlay-modules-react/src/styles/${stylesheet}`
  if (!existsSync(join(root, path))) failures.push(`${path}: missing canonical stylesheet`)
  requireText(
    'src/app/globals.css',
    new RegExp(`@import ['"]@overlay/modules-react/${stylesheet.replace('.', '\\.')}['"]`),
    `web must import ${stylesheet}`,
  )
  requireText(
    'overlay-desktop/src/renderer/src/styles/shared-chat.css',
    new RegExp(`@import ['"]@overlay/modules-react/${stylesheet.replace('.', '\\.')}['"]`),
    `desktop must import ${stylesheet}`,
  )
}

if (/\.app-note-editor\b/.test(read('src/app/globals.css'))) {
  failures.push('src/app/globals.css: notebook editor rules must live in notebook-editor.css')
}

requireText(
  'src/app/%5F_fixtures/file-parity/page.tsx',
  /NODE_ENV === 'production'.*FILE_PARITY_FIXTURES/s,
  'web fixture route must stay production-gated',
)
requireText(
  'overlay-desktop/src/main/index.ts',
  /!app\.isPackaged && process\.env\.OVERLAY_FILE_PARITY_FIXTURE === '1'/,
  'Electron fixture mode must stay unpackaged-only',
)
requireText(
  'overlay-desktop/src/renderer/src/main.tsx',
  /import\.meta\.env\.DEV && fixtureWindow === 'file-parity-fixture'/,
  'renderer fixture entry must stay development-only',
)

for (const productionEditor of [
  'overlay-desktop/src/renderer/src/pages/NotebookPanel.tsx',
  'overlay-desktop/src/renderer/src/pages/MainWindow.tsx',
]) {
  requireText(
    productionEditor,
    /DesktopNotebookEditor/,
    'desktop notebook consumers must use the shared editor adapter',
  )
  forbidText(
    productionEditor,
    /\buseEditor\s*\(|NotebookStyles|NotebookToolbar|InlineDiffExtension|SlashMenu/,
    'desktop notebook consumers cannot restore an independent renderer',
  )
}

const sharedNotebookFiles = [
  'packages/overlay-modules-react/src/notes/editor.tsx',
  'packages/overlay-modules-react/src/notes/editor-content.ts',
  'packages/overlay-modules-react/src/notes/inline-diff-extension.ts',
  'packages/overlay-modules-react/src/notes/slash-menu.tsx',
]

for (const path of sharedNotebookFiles) {
  if (!existsSync(join(root, path))) {
    failures.push(`${path}: missing canonical notebook source`)
    continue
  }
  forbidText(
    path,
    /(?:from\s+|import\s*\()["'](?:next(?:\/|["'])|electron(?:\/|["'])|node:|@\/)/,
    'shared notebook source cannot import Next.js, Electron, Node builtins, or web aliases',
  )
}

requireText(
  'packages/overlay-modules-react/src/notes/editor.tsx',
  /new NotebookEditorController\(/,
  'canonical editor must delegate hydration and persistence to NotebookEditorController',
)

const sourceFiles = (relativeDirectory) => {
  const absoluteDirectory = join(root, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return []
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(relative)
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ? [relative]
      : []
  })
}

const sharedFileSources = [
  ...sourceFiles('packages/overlay-modules-react/src/knowledge'),
  ...sourceFiles('packages/overlay-modules-react/src/notes'),
  ...sourceFiles('packages/overlay-modules-react/src/projects'),
  'packages/overlay-app-core/src/knowledge-surface.ts',
  'packages/overlay-app-core/src/knowledge-surface-fixture.ts',
  'packages/overlay-app-core/src/file-viewer.ts',
  'packages/overlay-app-core/src/notebook-editor-controller.ts',
].filter((path) => existsSync(join(root, path)))

const forbiddenSharedImport = /(?:from\s+|import\s*\()\s*['"](?:next(?:\/|['"])|electron(?:\/|['"])|node:|@\/server\/|(?:fs|path|os|child_process|worker_threads)(?:\/|['"]))/
for (const path of sharedFileSources) {
  forbidText(
    path,
    forbiddenSharedImport,
    'shared file, project, and notebook source cannot import Next.js, Electron, Node builtins, or @/server/*',
  )
}

const retiredPlatformFiles = [
  'src/features/files/components/FileViewer.tsx',
  'src/features/knowledge/components/KnowledgeViewHost.tsx',
  'src/features/knowledge/components/KnowledgeViewHeader.tsx',
  'src/features/knowledge/components/KnowledgeToolbarMenus.tsx',
  'src/features/notebook/components/SlashMenu.tsx',
  'src/features/notebook/components/InlineDiffExtension.ts',
  'overlay-desktop/src/renderer/src/pages/FilesListPage.tsx',
  'overlay-desktop/src/renderer/src/pages/NotesListPage.tsx',
  'overlay-desktop/src/renderer/src/pages/InlineNoteView.tsx',
  'overlay-desktop/src/renderer/src/pages/inlineNoteSaveQueue.ts',
  'overlay-desktop/src/renderer/src/services/files-list-cache.ts',
  'overlay-desktop/src/renderer/src/features/files/shared-files-surface-flag.ts',
  'overlay-desktop/src/renderer/src/components/ui/ProjectFileTree.tsx',
]
for (const path of retiredPlatformFiles) {
  if (existsSync(join(root, path))) failures.push(`${path}: retired compatibility or independent renderer must stay deleted`)
}

const platformFileSources = [
  ...sourceFiles('src/features/files'),
  ...sourceFiles('src/features/knowledge'),
  ...sourceFiles('src/features/notebook'),
  ...sourceFiles('overlay-desktop/src/renderer/src/features/files'),
  ...sourceFiles('overlay-desktop/src/renderer/src/features/notebook'),
  ...sourceFiles('overlay-desktop/src/renderer/src/pages'),
]
for (const path of platformFileSources) {
  const source = read(path)
  const base = path.split('/').at(-1) ?? path
  if (/^(?:FilesListPage|NotesListPage|NotebookStyles|NotebookToolbar|SlashMenu|InlineDiffExtension|FileViewer)\.[cm]?[jt]sx?$/.test(base)) {
    failures.push(`${path}: independent file sidebar, viewer, or notebook renderer is forbidden`)
  }
  if (/\bfunction\s+(?:FileViewer|KnowledgeFileList|KnowledgeFileCards)\b|\bReactMarkdown\b|\bmammoth\.convertToHtml\b/.test(source)) {
    failures.push(`${path}: platform source cannot implement an independent file renderer`)
  }
  if (/notebook/i.test(path) && !/AutomationInstructionsEditor\.tsx$/.test(path) && /\buseEditor\s*\(/.test(source)) {
    failures.push(`${path}: platform notebook source cannot configure TipTap independently`)
  }
}

for (const [path, required] of [
  ['src/app/app/_components/KnowledgeViewHost.tsx', "from '@overlay/modules-react/knowledge'"],
  ['src/features/projects/components/ProjectsView.tsx', "from '@overlay/modules-react/knowledge'"],
  ['overlay-desktop/src/renderer/src/pages/RemoteFilePreviewPage.tsx', "from '@overlay/modules-react/knowledge'"],
  ['overlay-desktop/src/renderer/src/pages/OutputPreviewPage.tsx', "from '@overlay/modules-react/knowledge'"],
  ['overlay-desktop/src/renderer/src/features/notebook/DesktopNotebookEditor.tsx', "from '@overlay/modules-react/notes'"],
  ['overlay-desktop/src/renderer/src/components/ui/NativeProjectFileTreeHost.tsx', "from '@overlay/modules-react/projects'"],
  ['overlay-desktop/src/renderer/src/components/chat/DesktopAttachmentPreview.tsx', 'AttachmentPreviewPanel'],
  ['overlay-desktop/src/renderer/src/components/chat/DesktopAttachmentPreview.tsx', 'FileViewerPanel'],
]) {
  requireText(path, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `embedded consumer must retain canonical shared boundary: ${required}`)
}

forbidText(
  'overlay-desktop/src/renderer/src/pages/MainWindow.tsx',
  /FilesListPage|sharedFilesSurfaceEnabled|VITE_DESKTOP_SHARED_FILES_SURFACE/,
  'desktop MainWindow cannot restore the files rollback renderer or flag',
)
forbidText(
  'overlay-desktop/src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.ts',
  /mergeDesktopFileList|reconcileLocalNoteItems/,
  'desktop cannot silently merge raw local and remote entities',
)
requireText(
  'overlay-desktop/src/renderer/src/pages/SharedDesktopFilesSurface.tsx',
  /authority === 'on-this-mac'[\s\S]*createDesktopLocalKnowledgeSurfaceAdapters/,
  'desktop local-only operation must be explicit and must not merge with cloud entities',
)

for (const adapterTest of [
  'src/features/knowledge/adapters/webKnowledgeSurfaceAdapters.test.ts',
  'overlay-desktop/src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.test.ts',
]) {
  requireText(
    adapterTest,
    /exerciseKnowledgeAdapterContract\(adapters\)/,
    'web and desktop adapters must execute the identical contract fixture',
  )
}
requireText(
  'packages/overlay-modules-react/src/notes/editor.tsx',
  /useEditor\(\{[\s\S]*InlineDiffExtension/,
  'canonical editor must own the TipTap extension configuration',
)
requireText(
  'packages/overlay-modules-react/src/notes/editor.tsx',
  /<SlashMenu\b/,
  'canonical editor must own the slash menu integration',
)
requireText(
  'src/features/notebook/components/NotebookEditor.tsx',
  /<CanonicalNotebookEditor\b/,
  'web notebook route must render the shared canonical editor',
)
forbidText(
  'src/features/notebook/components/NotebookEditor.tsx',
  /\buseEditor\s*\(/,
  'web notebook host adapter cannot introduce an independent TipTap renderer',
)
requireText(
  'packages/overlay-modules-react/src/file-parity-fixture.tsx',
  /<CanonicalNotebookEditor\b/,
  'notebook fixture must exercise the canonical editor',
)

for (const [path, pattern, message] of [
  [
    'packages/overlay-modules-react/src/knowledge/view-header.tsx',
    /aria-label="Folder breadcrumbs"/,
    'shared folder navigation must retain a screen-reader breadcrumb landmark',
  ],
  [
    'packages/overlay-modules-react/src/knowledge/view-header.tsx',
    /aria-pressed=\{layout === 'list'\}[\s\S]*aria-pressed=\{layout === 'cards'\}/,
    'shared layout controls must expose their selected state',
  ],
  [
    'packages/overlay-modules-react/src/knowledge/surface.tsx',
    /lastFileTriggerRef[\s\S]*requestAnimationFrame[\s\S]*\.focus\(\)/,
    'closing a file must restore focus to the element that opened it',
  ],
  [
    'overlay-desktop/src/renderer/src/components/chat/DesktopAttachmentPreview.tsx',
    /contentResponse\(nextPreview\.fileId,\s*\{[\s\S]*signal: controller\.signal/,
    'desktop attachment previews must cancel abandoned content requests',
  ],
  [
    'overlay-desktop/src/renderer/src/adapters/desktopLocalKnowledgeSurfaceAdapters.test.ts',
    /never merges cloud rows/,
    'local authority must retain explicit no-merge contract coverage',
  ],
  [
    'overlay-desktop/src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.test.ts',
    /opens 100 files without refetching the list/,
    'desktop adapter must retain the 100-open zero-refetch performance gate',
  ],
  [
    'packages/overlay-app-core/src/notebook-editor-controller.test.ts',
    /hydrating 100 notes causes zero writes[\s\S]*100-edit burst produces one bounded save/,
    'notebook controller must retain hydration and edit-burst performance gates',
  ],
]) {
  requireText(path, pattern, message)
}

if (failures.length) {
  console.error(`File parity boundary check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log('File parity fixture and stylesheet boundaries passed.')
