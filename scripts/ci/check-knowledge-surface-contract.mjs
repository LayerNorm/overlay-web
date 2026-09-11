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
const sharedViewerPath = path.join(root, 'packages/overlay-modules-react/src/knowledge/file-viewer.tsx')
const webViewerHostPath = path.join(root, 'src/app/app/_components/KnowledgeViewHost.tsx')
const desktopOutputViewerPath = path.join(root, 'overlay-desktop/src/renderer/src/pages/OutputPreviewPage.tsx')

for (const file of [contractPath, fixturePath, webAdapterPath, desktopAdapterPath, sharedSurfacePath, webWrapperPath, desktopSharedPath, desktopMainPath, sharedViewerPath, webViewerHostPath, desktopOutputViewerPath]) {
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
  'KnowledgeEntityMutation',
  'KnowledgeMutationConsumer',
  'KnowledgeMutationRevisionTracker',
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
if (/\bfilesChanged\b|\bnoteCreated\b/.test(sharedSurface)) {
  throw new Error('Shared knowledge surface restored broadcast-and-refetch callbacks')
}

for (const adapterPath of [webAdapterPath, desktopAdapterPath]) {
  const adapter = fs.readFileSync(adapterPath, 'utf8')
  for (const required of ['KNOWLEDGE_ENTITY_MUTATION_EVENT', 'KnowledgeMutationConsumer', 'isKnowledgeEntityMutation']) {
    if (!adapter.includes(required)) throw new Error(`${path.relative(root, adapterPath)} lost payload mutation handling: ${required}`)
  }
  if (/FILES_CHANGED_EVENT/.test(adapter)) {
    throw new Error(`${path.relative(root, adapterPath)} restored broadcast-and-refetch behavior`)
  }
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
  throw new Error('Web KnowledgeView host adapter must render the shared surface')
}
if (webWrapper.split('\n').length > 260) {
  throw new Error('Web KnowledgeView host adapter regained presentation/orchestration')
}

const desktopShared = fs.readFileSync(desktopSharedPath, 'utf8')
const desktopMain = fs.readFileSync(desktopMainPath, 'utf8')
if (!desktopShared.includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('Desktop files must render the canonical shared knowledge surface')
}
for (const required of ['openFilesInHost', 'enableExternalDrop', 'createDesktopKnowledgeSurfaceAdapters']) {
  if (!desktopShared.includes(required)) throw new Error(`Desktop shared surface lost ${required}`)
}
if (!desktopMain.includes('<FilesListPage')) {
  throw new Error('MainWindow must retain the compact native files sidebar')
}
for (const required of ['<DesktopNotebookEditor', '<RemoteFilePreviewPage', '<OutputPreviewPage']) {
  if (!desktopMain.includes(required)) {
    throw new Error(`MainWindow file content lost shared consumer ${required}`)
  }
}
if (/sharedFilesSurfaceEnabled|VITE_DESKTOP_SHARED_FILES_SURFACE|<SharedDesktopFilesSurface/.test(desktopMain)) {
  throw new Error('MainWindow restored a files rollback branch or replaced its native sidebar')
}
for (const forbidden of ['FileParityFixtureSurface', 'KnowledgeFileList', 'KnowledgeFileCards']) {
  if (desktopShared.includes(`function ${forbidden}`)) {
    throw new Error(`Desktop files introduced an independent ${forbidden} renderer`)
  }
}

console.log('Knowledge surface contract boundaries passed.')
