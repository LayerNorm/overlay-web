import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const files = {
  contract: 'packages/overlay-app-core/src/knowledge-surface.ts',
  fixture: 'packages/overlay-app-core/src/knowledge-surface-fixture.ts',
  sharedSurface: 'packages/overlay-modules-react/src/knowledge/surface.tsx',
  sharedViewer: 'packages/overlay-modules-react/src/knowledge/file-viewer.tsx',
  desktopAdapter: 'src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.ts',
  desktopSurface: 'src/renderer/src/pages/SharedDesktopFilesSurface.tsx',
  desktopViewer: 'src/renderer/src/pages/OutputPreviewPage.tsx'
}

for (const [name, relative] of Object.entries(files)) {
  if (!fs.existsSync(path.join(root, relative))) {
    throw new Error(`Missing standalone knowledge ${name}: ${relative}`)
  }
}

const read = (name) => fs.readFileSync(path.join(root, files[name]), 'utf8')
const contract = read('contract')
for (const required of [
  'KnowledgeRepository',
  'KnowledgeRouteAdapter',
  'FilePickerAdapter',
  'KnowledgeSurfaceController',
  'KnowledgeMutationConsumer'
]) {
  if (!contract.includes(required)) throw new Error(`Knowledge contract lost ${required}`)
}

const packageSources = ['contract', 'fixture', 'sharedSurface', 'sharedViewer']
  .map(read)
  .join('\n')
for (const forbidden of [
  /from ['"](?:electron|next)(?:\/|['"])/,
  /from ['"]node:/,
  /from ['"]@\/server\//,
  /\bipcRenderer\b/
]) {
  if (forbidden.test(packageSources)) {
    throw new Error(`Platform capability leaked into a public shared package: ${forbidden}`)
  }
}

const sharedSurface = read('sharedSurface')
if (!sharedSurface.includes('SharedKnowledgeSurface')) {
  throw new Error('Shared package must own SharedKnowledgeSurface')
}
if (/\bfilesChanged\b|\bnoteCreated\b/.test(sharedSurface)) {
  throw new Error('Shared surface restored broadcast-and-refetch callbacks')
}

const adapter = read('desktopAdapter')
for (const required of [
  'KNOWLEDGE_ENTITY_MUTATION_EVENT',
  'KnowledgeMutationConsumer',
  'isKnowledgeEntityMutation'
]) {
  if (!adapter.includes(required)) throw new Error(`Desktop adapter lost ${required}`)
}
if (/FILES_CHANGED_EVENT/.test(adapter)) {
  throw new Error('Desktop adapter restored broadcast-and-refetch behavior')
}

const sharedViewer = read('sharedViewer')
for (const required of [
  'resolveSafeViewerUrl',
  'DOCX_SANITIZE_CONFIG',
  'FILE_VIEWER_HTML_SANDBOX',
  'controller.abort()',
  'OutputViewer'
]) {
  if (!sharedViewer.includes(required)) throw new Error(`Shared viewer lost ${required}`)
}
if (!read('desktopViewer').includes('<OutputViewer')) {
  throw new Error('Desktop outputs must render through the canonical OutputViewer')
}
if (!read('desktopSurface').includes("from '@overlay/modules-react/knowledge'")) {
  throw new Error('Desktop files must render the canonical shared knowledge surface')
}

console.log('Standalone knowledge surface contract boundaries passed.')
