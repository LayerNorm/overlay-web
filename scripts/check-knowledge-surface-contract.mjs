import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd().endsWith(`${path.sep}overlay-desktop`)
  ? path.resolve(process.cwd(), '..')
  : process.cwd()
const contractPath = path.join(root, 'packages/overlay-app-core/src/knowledge-surface.ts')
const fixturePath = path.join(root, 'packages/overlay-app-core/src/knowledge-surface-fixture.ts')
const webAdapterPath = path.join(root, 'src/features/knowledge/adapters/webKnowledgeSurfaceAdapters.ts')
const desktopAdapterPath = path.join(root, 'overlay-desktop/src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.ts')
const sharedSurfacePath = path.join(root, 'packages/overlay-modules-react/src/knowledge/surface.tsx')
const webWrapperPath = path.join(root, 'src/features/knowledge/components/KnowledgeView.tsx')
const desktopSharedPath = path.join(root, 'overlay-desktop/src/renderer/src/pages/SharedDesktopFilesSurface.tsx')
const desktopMainPath = path.join(root, 'overlay-desktop/src/renderer/src/pages/MainWindow.tsx')
const desktopFlagPath = path.join(root, 'overlay-desktop/src/renderer/src/features/files/shared-files-surface-flag.ts')
const sharedViewerPath = path.join(root, 'packages/overlay-modules-react/src/knowledge/file-viewer.tsx')
const webViewerHostPath = path.join(root, 'src/app/app/_components/KnowledgeViewHost.tsx')
const desktopOutputViewerPath = path.join(root, 'overlay-desktop/src/renderer/src/pages/OutputPreviewPage.tsx')

for (const file of [contractPath, fixturePath, webAdapterPath, desktopAdapterPath, sharedSurfacePath, webWrapperPath, desktopSharedPath, desktopMainPath, desktopFlagPath, sharedViewerPath, webViewerHostPath, desktopOutputViewerPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing knowledge surface contract boundary: ${path.relative(root, file)}`)
}

const contract = fs.readFileSync(contractPath, 'utf8')
for (const name of [
  'KnowledgeRepository',
  'KnowledgeRouteAdapter',
  'FilePickerAdapter',
  'FileNavigationAdapter',
  'KnowledgeAnalyticsAdapter',
  'KnowledgeSurfaceController',
  'KnowledgeMutationEvent',
]) {
  if (!contract.includes(name)) throw new Error(`Knowledge surface contract is missing ${name}`)
}

const appCoreSources = [contractPath, fixturePath].map((file) => fs.readFileSync(file, 'utf8')).join('\n')
for (const pattern of [
  /from ['"](?:next|electron)(?:\/|['"])/,
  /from ['"]node:/,
  /from ['"]@\/server\//,
  /\bwindow\b/,
  /\bdocument\b/,
]) {
  if (pattern.test(appCoreSources)) throw new Error(`Platform import or global leaked into @overlay/app-core knowledge surface: ${pattern}`)
}

const fixture = fs.readFileSync(fixturePath, 'utf8')
if (!fixture.includes('exerciseKnowledgeAdapterContract')) {
  throw new Error('Fixture adapter must continue exporting the shared contract exercise')
}

const sharedSurface = fs.readFileSync(sharedSurfacePath, 'utf8')
for (const pattern of [
  /from ['"]next(?:\/|['"])/,
  /from ['"]electron(?:\/|['"])/,
  /from ['"]node:/,
  /from ['"]@\//,
  /from ['"]@\/server\//,
]) {
  if (pattern.test(sharedSurface)) throw new Error(`Platform import leaked into shared knowledge surface: ${pattern}`)
}
if (!sharedSurface.includes('SharedKnowledgeSurface')) {
  throw new Error('Shared knowledge package must own SharedKnowledgeSurface')
}

const sharedViewer = fs.readFileSync(sharedViewerPath, 'utf8')
for (const pattern of [
  /from ['"]next(?:\/|['"])/,
  /from ['"]electron(?:\/|['"])/,
  /from ['"]node:/,
  /from ['"]@\//,
  /\bwindow\.bridge\b/,
  /\bipcRenderer\b/,
]) {
  if (pattern.test(sharedViewer)) throw new Error(`Platform capability leaked into shared file viewer: ${pattern}`)
}
for (const required of ['resolveSafeViewerUrl', 'DOCX_SANITIZE_CONFIG', 'FILE_VIEWER_HTML_SANDBOX', 'controller.abort()', 'OutputViewer']) {
  if (!sharedViewer.includes(required)) throw new Error(`Shared file viewer lost security or output boundary: ${required}`)
}
if (!fs.readFileSync(webViewerHostPath, 'utf8').includes('<OutputViewer')) {
  throw new Error('Web outputs must render through the canonical OutputViewer')
}
if (!fs.readFileSync(desktopOutputViewerPath, 'utf8').includes('<OutputViewer')) {
  throw new Error('Desktop outputs must render through the canonical OutputViewer')
}

const webWrapper = fs.readFileSync(webWrapperPath, 'utf8')
if (!webWrapper.includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('Web KnowledgeView must remain a compatibility wrapper around the shared surface')
}
if (webWrapper.split('\n').length > 260) {
  throw new Error('Web KnowledgeView compatibility wrapper regained presentation/orchestration')
}

const desktopLegacyPage = fs.readFileSync(
  path.join(root, 'overlay-desktop/src/renderer/src/pages/FilesListPage.tsx'),
  'utf8',
)
const desktopShared = fs.readFileSync(desktopSharedPath, 'utf8')
const desktopMain = fs.readFileSync(desktopMainPath, 'utf8')
const desktopFlag = fs.readFileSync(desktopFlagPath, 'utf8')
if (!desktopShared.includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('Desktop files must render the canonical shared knowledge surface')
}
for (const required of ['openFilesInHost', 'enableExternalDrop', 'createDesktopKnowledgeSurfaceAdapters']) {
  if (!desktopShared.includes(required)) throw new Error(`Desktop shared surface lost ${required}`)
}
if (!desktopMain.includes('<SharedDesktopFilesSurface') || !desktopMain.includes('sharedFilesSurfaceEnabled ?')) {
  throw new Error('MainWindow must use the shared files surface by default with an explicit rollback branch')
}
if (!desktopFlag.includes("'legacy'") || !desktopFlag.includes('VITE_DESKTOP_SHARED_FILES_SURFACE')) {
  throw new Error('Desktop files cutover must retain its temporary rollback flag')
}
if (desktopLegacyPage.includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('The legacy rollback renderer must not masquerade as the canonical shared surface')
}
for (const forbidden of ['FileParityFixtureSurface', 'KnowledgeFileList', 'KnowledgeFileCards']) {
  if (desktopShared.includes(`function ${forbidden}`)) {
    throw new Error(`Desktop files introduced an independent ${forbidden} renderer`)
  }
}

console.log('Knowledge surface contract boundaries passed.')
