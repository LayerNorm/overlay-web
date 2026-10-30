import { desktopWebShellViolations } from './desktop-web-shell-boundary.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const failures = desktopWebShellViolations(root)
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

}

if (/\.app-note-editor\b/.test(read('src/app/globals.css'))) {
  failures.push('src/app/globals.css: notebook editor rules must live in notebook-editor.css')
}

requireText(
  'src/app/dev-fixtures/file-parity/page.tsx',
  /NODE_ENV === 'production'.*FILE_PARITY_FIXTURES/s,
  'web fixture route must stay production-gated',
)

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
  'packages/overlay-modules-react/src/notes/editor-state.ts',
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

]
for (const path of retiredPlatformFiles) {
  if (existsSync(join(root, path))) failures.push(`${path}: retired compatibility or independent renderer must stay deleted`)
}

const platformFileSources = [
  ...sourceFiles('src/features/files'),
  ...sourceFiles('src/features/knowledge'),
  ...sourceFiles('src/features/notebook'),

]
for (const path of platformFileSources) {
  const source = read(path)
  const base = path.split('/').at(-1) ?? path
  if (/^(?:NotesListPage|NotebookStyles|NotebookToolbar|SlashMenu|InlineDiffExtension|FileViewer)\.[cm]?[jt]sx?$/.test(base)) {
    failures.push(`${path}: independent file viewer or notebook renderer is forbidden`)
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

]) {
  requireText(path, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `embedded consumer must retain canonical shared boundary: ${required}`)
}

for (const adapterTest of [
  'src/features/knowledge/adapters/webKnowledgeSurfaceAdapters.test.ts',

]) {
  requireText(
    adapterTest,
    /exerciseKnowledgeAdapterContract\(adapters\)/,
    'web adapter used by both surfaces must execute the canonical contract fixture',
  )
}
requireText(
  'packages/overlay-modules-react/src/notes/editor-state.ts',
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
    'packages/overlay-modules-react/src/knowledge/surface-state.ts',
    /lastFileTriggerRef[\s\S]*requestAnimationFrame[\s\S]*\.focus\(\)/,
    'closing a file must restore focus to the element that opened it',
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
