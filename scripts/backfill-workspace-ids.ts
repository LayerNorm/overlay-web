import { lazyConvex as convex } from '../src/server/database/lazy-convex'
import { getInternalApiSecret } from '../src/server/shared/internal-api-secret'

type Table =
  | 'conversations'
  | 'files'
  | 'notes'
  | 'skills'
  | 'mcpServers'
  | 'projects'
  | 'automations'
  | 'memories'
  | 'outputs'
  | 'webhookSubscriptions'
  | 'knowledgeChunks'

const TABLES: Table[] = [
  'conversations',
  'files',
  'notes',
  'skills',
  'mcpServers',
  'projects',
  'automations',
  'memories',
  'outputs',
  'webhookSubscriptions',
  'knowledgeChunks',
]

const PAGE_SIZE = 50

type AuditPage = {
  table: string
  rows: number
  missingWorkspaceId: number
  continueCursor: string
  isDone: boolean
}

type MigratePage = {
  table: string
  rows: number
  migrated: number
  skipped: number
  continueCursor: string
  isDone: boolean
}

async function auditTable(table: Table): Promise<{ rows: number; missingWorkspaceId: number }> {
  let cursor: string | null = null
  let rows = 0
  let missingWorkspaceId = 0
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    const page = await convex.query<AuditPage>(
      'migrations/backfillWorkspaceIds:auditBackfillByServer',
      {
        serverSecret: getInternalApiSecret(),
        table,
        paginationOpts: { cursor, numItems: PAGE_SIZE },
      },
      { throwOnError: true },
    )
    if (!page) throw new Error(`Audit for ${table} returned no result`)
    rows += page.rows
    missingWorkspaceId += page.missingWorkspaceId
    if (page.isDone) return { rows, missingWorkspaceId }
    cursor = page.continueCursor
  }
  throw new Error(`Audit for ${table} exceeded 10,000 pages`)
}

async function migrateTable(table: Table): Promise<{ rows: number; migrated: number; skipped: number }> {
  let cursor: string | null = null
  let rows = 0
  let migrated = 0
  let skipped = 0
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    const page = await convex.mutation<MigratePage>(
      'migrations/backfillWorkspaceIds:backfillBatchByServer',
      {
        serverSecret: getInternalApiSecret(),
        table,
        paginationOpts: { cursor, numItems: PAGE_SIZE },
      },
      { throwOnError: true },
    )
    if (!page) throw new Error(`Migration for ${table} returned no result`)
    rows += page.rows
    migrated += page.migrated
    skipped += page.skipped
    process.stdout.write(`  ${table}: page ${pageNumber + 1} — ${page.rows} rows, ${page.migrated} migrated, ${page.skipped} skipped\n`)
    if (page.isDone) return { rows, migrated, skipped }
    cursor = page.continueCursor
  }
  throw new Error(`Migration for ${table} exceeded 10,000 pages`)
}

async function main() {
  console.log('=== Workspace ID Backfill Migration ===\n')

  console.log('Phase 1: Audit (before)')
  const before: Record<string, { rows: number; missingWorkspaceId: number }> = {}
  for (const table of TABLES) {
    const result = await auditTable(table)
    before[table] = result
    console.log(`  ${table}: ${result.rows} rows, ${result.missingWorkspaceId} missing workspaceId`)
  }

  console.log('\nPhase 2: Migrate')
  const migration: Record<string, { rows: number; migrated: number; skipped: number }> = {}
  for (const table of TABLES) {
    console.log(`\n  Migrating ${table}...`)
    const result = await migrateTable(table)
    migration[table] = result
    console.log(`  ${table}: ${result.rows} rows, ${result.migrated} migrated, ${result.skipped} skipped`)
  }

  console.log('\nPhase 3: Audit (after)')
  const after: Record<string, { rows: number; missingWorkspaceId: number }> = {}
  let totalMissing = 0
  for (const table of TABLES) {
    const result = await auditTable(table)
    after[table] = result
    totalMissing += result.missingWorkspaceId
    console.log(`  ${table}: ${result.rows} rows, ${result.missingWorkspaceId} missing workspaceId`)
  }

  if (totalMissing > 0) {
    throw new Error(`Backfill audit failed: ${totalMissing} rows still missing workspaceId after migration`)
  }

  console.log('\n=== Backfill Complete ===')
  console.log(JSON.stringify({ ok: true, before, migration, after }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
