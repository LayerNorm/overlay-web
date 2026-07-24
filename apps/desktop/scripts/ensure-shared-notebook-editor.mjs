import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const failures = []

for (const consumer of [
  'src/renderer/src/pages/NotebookPanel.tsx',
  'src/renderer/src/pages/MainWindow.tsx',
]) {
  const source = read(consumer)
  if (!source.includes('DesktopNotebookEditor')) failures.push(`${consumer} must use DesktopNotebookEditor`)
  if (/\buseEditor\s*\(/.test(source)) failures.push(`${consumer} cannot configure an independent TipTap editor`)
  if (/NotebookStyles|NotebookToolbar|SlashMenu|InlineDiffExtension/.test(source)) {
    failures.push(`${consumer} still references a legacy notebook renderer`)
  }
}

const adapter = read('src/renderer/src/features/notebook/DesktopNotebookEditor.tsx')
for (const boundary of [
  'CanonicalNotebookEditor',
  'createDesktopNotebookRepository',
  'persistImage',
  'onPanelVisibilityChanged',
  'onNoteInputText',
]) {
  if (!adapter.includes(boundary)) failures.push(`Desktop notebook adapter lost ${boundary}`)
}

const retired = 'src/renderer/src/components/notebook'
if (fs.existsSync(path.join(root, retired)) && fs.readdirSync(path.join(root, retired)).length > 0) {
  failures.push('duplicated desktop notebook components must stay deleted')
}

for (const retiredFile of [
  'src/renderer/src/pages/InlineNoteView.tsx',
  'src/renderer/src/pages/inlineNoteSaveQueue.ts',
]) {
  if (fs.existsSync(path.join(root, retiredFile))) {
    failures.push(`${retiredFile} must stay deleted`)
  }
}

const sharedSidebar = fs.readFileSync(
  path.resolve(root, 'packages/overlay-modules-react/src/notes/sidebar.tsx'),
  'utf8',
)
const sharedEditor = fs.readFileSync(
  path.resolve(root, 'packages/overlay-modules-react/src/notes/editor.tsx'),
  'utf8',
)
if (!sharedSidebar.includes('const NotebookNoteRow = memo(')) {
  failures.push('completed notebook sidebar rows must remain memoized')
}
if (!sharedEditor.includes('onDeleteNote={deleteSidebarNote}')) {
  failures.push('notebook row callbacks must remain stable during editor typing')
}

if (failures.length > 0) {
  console.error(`Shared notebook editor guard failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log('Desktop shared notebook editor guard passed.')
