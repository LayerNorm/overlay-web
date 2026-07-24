import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const files = {
  app: path.join(root, 'src/renderer/src/App.tsx'),
  migration: path.join(root, 'src/renderer/src/services/desktop-knowledge-migration.ts'),
  sidebarCache: path.join(root, 'src/renderer/src/services/files-list-cache.ts'),
  store: path.join(root, 'src/main/services/knowledge-migration-store.ts'),
  sync: path.join(root, 'src/renderer/src/services/desktop-sync-service.ts')
}
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${name} knowledge migration boundary`)
}

const migration = fs.readFileSync(files.migration, 'utf8')
for (const required of [
  'createBackup',
  'loadJournal',
  'saveJournal',
  'checksum',
  "status = 'verifying'",
  'rewriteKnowledgeMigrationReferences',
  "setDesktopKnowledgeAuthority('cloud')",
  "setDesktopKnowledgeAuthority('on-this-mac')"
]) {
  if (!migration.includes(required))
    throw new Error(`Knowledge migration lost required behavior: ${required}`)
}

const store = fs.readFileSync(files.store, 'utf8')
if (/\b(?:unlink|rm|rmdir)Sync\b/.test(store)) {
  throw new Error('Knowledge migration store must never delete legacy sources')
}
if (!store.includes("'backups'") || !store.includes("'journals'")) {
  throw new Error('Knowledge migration must retain recoverable backups and journals')
}

if (
  !migration.includes(
    "export type DesktopKnowledgeAuthority = 'cloud' | 'migrating' | 'on-this-mac'"
  )
) {
  throw new Error('Legacy local-only data must retain an explicit On this Mac authority')
}
const sidebarCache = fs.readFileSync(files.sidebarCache, 'utf8')
if (!sidebarCache.includes("authority === 'cloud'") || /mergeDesktopFileList/.test(sidebarCache)) {
  throw new Error(
    'The desktop sidebar cache must select one authority and never merge local and remote entities'
  )
}

const app = fs.readFileSync(files.app, 'utf8')
if (!app.includes('migrateLegacyDesktopKnowledge')) {
  throw new Error('Desktop authentication startup must run the knowledge migration')
}

const sync = fs.readFileSync(files.sync, 'utf8')
if (!sync.includes("localStorage.getItem(KNOWLEDGE_AUTHORITY_KEY) === 'cloud'")) {
  throw new Error('The legacy note outbox must wait for canonical remote identity verification')
}

console.log('Desktop knowledge migration guard passed.')
