import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const read = (path) => readFileSync(join(root, path), 'utf8')
const requireText = (path, pattern, message) => {
  const source = read(path)
  if (!pattern.test(source)) failures.push(`${path}: ${message}`)
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
  'overlay-desktop/src/renderer/src/pages/InlineNoteView.tsx',
]) {
  requireText(
    productionEditor,
    /NotebookStyles/,
    'PR 2 must not cut over the production desktop editor',
  )
}

if (failures.length) {
  console.error(`File parity boundary check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log('File parity fixture and stylesheet boundaries passed.')
