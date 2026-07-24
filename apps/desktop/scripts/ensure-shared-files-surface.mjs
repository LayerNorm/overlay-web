import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const files = {
  adapters: path.join(root, 'src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.ts'),
  build: path.join(root, 'electron.vite.config.ts'),
  main: path.join(root, 'src/renderer/src/pages/MainWindow.tsx'),
  nativeIpc: path.join(root, 'src/main/ipc/knowledge-files-ipc.ts'),
  preview: path.join(root, 'src/renderer/src/pages/RemoteFilePreviewPage.tsx'),
  styles: path.join(root, 'src/renderer/src/styles/shared-chat.css'),
  surface: path.join(root, 'src/renderer/src/pages/SharedDesktopFilesSurface.tsx')
}

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`Missing desktop shared files ${name} boundary`)
}

const surface = fs.readFileSync(files.surface, 'utf8')
for (const required of [
  'SharedKnowledgeSurface',
  'createDesktopKnowledgeSurfaceAdapters',
  'openFilesInHost',
  'enableExternalDrop',
  'uploadDesktopFile',
  'shared-app-scope',
  "authority === 'on-this-mac'",
  'createDesktopLocalKnowledgeSurfaceAdapters'
]) {
  if (!surface.includes(required)) throw new Error(`Desktop shared files surface lost ${required}`)
}
if (/fetchDesktopFileList|FilesListPage/.test(surface)) {
  throw new Error(
    'Canonical desktop files surface must not depend on the legacy list/cache renderer'
  )
}
if (
  !fs.existsSync(
    path.join(root, 'src/renderer/src/adapters/desktopLocalKnowledgeSurfaceAdapters.ts')
  )
) {
  throw new Error('Explicit On this Mac adapter is missing')
}

const main = fs.readFileSync(files.main, 'utf8')
if (!main.includes('<FilesListPage')) {
  throw new Error('MainWindow no longer renders the compact native files sidebar')
}
for (const required of ['<DesktopNotebookEditor', '<RemoteFilePreviewPage', '<OutputPreviewPage']) {
  if (!main.includes(required)) throw new Error(`MainWindow file content lost ${required}`)
}
if (
  /sharedFilesSurfaceEnabled|VITE_DESKTOP_SHARED_FILES_SURFACE|<SharedDesktopFilesSurface/.test(
    main
  )
) {
  throw new Error('MainWindow restored a files rollback flag or replaced its native sidebar')
}

const adapters = fs.readFileSync(files.adapters, 'utf8')
for (const required of [
  'knowledgeFiles.pick',
  'knowledgeFiles.revealDownloaded',
  'noteReplicas.subscribe'
]) {
  if (!adapters.includes(required)) throw new Error(`Desktop knowledge adapters lost ${required}`)
}

const preview = fs.readFileSync(files.preview, 'utf8')
if (!preview.includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('Desktop remote files must use the shared canonical viewer')
}

const styles = fs.readFileSync(files.styles, 'utf8')
for (const stylesheet of ['knowledge-surface.css', 'file-viewer.css', 'notebook-editor.css']) {
  if (!styles.includes(`@overlay/modules-react/${stylesheet}`)) {
    throw new Error(`Desktop renderer lost canonical ${stylesheet}`)
  }
}
if (!styles.includes(':where(.shared-app-scope)')) {
  throw new Error('Desktop shared files must retain their scoped preflight parity reset')
}

const build = fs.readFileSync(files.build, 'utf8')
if (!build.includes("publicDir: resolve('public')")) {
  throw new Error('Desktop must package the canonical web file-kind assets')
}
if (!build.includes("'@overlay/modules-react/projects'")) {
  throw new Error('Desktop must resolve the shared project file browser entrypoint')
}

console.log('Desktop shared files surface guard passed.')
