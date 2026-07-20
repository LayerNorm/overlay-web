import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd().endsWith(`${path.sep}overlay-desktop`)
  ? path.resolve(process.cwd(), '..')
  : process.cwd()
const contractPath = path.join(root, 'packages/overlay-app-core/src/knowledge-surface.ts')
const fixturePath = path.join(root, 'packages/overlay-app-core/src/knowledge-surface-fixture.ts')
const webAdapterPath = path.join(root, 'src/features/knowledge/adapters/webKnowledgeSurfaceAdapters.ts')
const desktopAdapterPath = path.join(root, 'overlay-desktop/src/renderer/src/adapters/desktopKnowledgeSurfaceAdapters.ts')

for (const file of [contractPath, fixturePath, webAdapterPath, desktopAdapterPath]) {
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

console.log('Knowledge surface contract boundaries passed.')
