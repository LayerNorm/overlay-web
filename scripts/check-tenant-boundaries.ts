import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type ConvexTableAuditRow = {
  name: string
  hasUserId: boolean
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = path.join(root, 'convex/schema.ts')
const tenancyDocPath = path.join(root, 'docs/deploy-operate/tenancy.mdx')

async function main() {
  const [schemaSource, tenancyDoc] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    readFile(tenancyDocPath, 'utf8'),
  ])

  const tables = parseConvexTables(schemaSource)
  const documentedTables = parseDocumentedTenantTables(tenancyDoc)
  const userOwnedTables = tables.filter((table) => table.hasUserId)

  const missing = userOwnedTables
    .map((table) => table.name)
    .filter((tableName) => !documentedTables.has(tableName))

  const stale = [...documentedTables]
    .filter((tableName) => !tables.some((table) => table.name === tableName))
    .sort()

  let failed = false
  if (missing.length > 0) {
    failed = true
    console.error('FAIL tenant-boundaries: user-owned Convex tables missing tenant decisions:')
    for (const tableName of missing) console.error(`  - ${tableName}`)
  }

  if (stale.length > 0) {
    failed = true
    console.error('FAIL tenant-boundaries: docs/deploy-operate/tenancy.mdx lists tables not found in convex/schema.ts:')
    for (const tableName of stale) console.error(`  - ${tableName}`)
  }

  if (!tenancyDoc.includes('API keys') || !tenancyDoc.includes('Webhook')) {
    failed = true
    console.error('FAIL tenant-boundaries: docs/deploy-operate/tenancy.mdx must state tenant behavior for API keys and webhooks')
  }

  if (!tenancyDoc.includes('single-customer deployment') || !tenancyDoc.includes('shared multi-tenant deployment')) {
    failed = true
    console.error(
      'FAIL tenant-boundaries: docs/deploy-operate/tenancy.mdx must state the current single-customer model and shared multi-tenant boundary',
    )
  }

  if (failed) process.exit(1)

  const nonUserOwnedCount = tables.length - userOwnedTables.length
  console.log(
    `OK tenant-boundaries: ${tables.length} Convex tables audited; ` +
      `${userOwnedTables.length} user-owned tables documented; ${nonUserOwnedCount} non-user-owned tables reviewed.`,
  )
}

function parseConvexTables(source: string): ConvexTableAuditRow[] {
  const tablePattern = /^  ([A-Za-z0-9_]+): defineTable\(\{/gm
  const rows: ConvexTableAuditRow[] = []

  for (const match of source.matchAll(tablePattern)) {
    const tableName = match[1]
    if (!tableName || match.index === undefined) continue
    const bodyStart = match.index + match[0].length
    const nextMatch = /^  [A-Za-z0-9_]+: defineTable\(\{/gm
    nextMatch.lastIndex = bodyStart
    const next = nextMatch.exec(source)
    const bodyEnd = next?.index ?? source.indexOf('\n})', bodyStart)
    const tableSource = source.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : source.length)
    rows.push({
      name: tableName,
      hasUserId: /^\s+userId:\s/m.test(tableSource),
    })
  }

  if (rows.length === 0) {
    throw new Error('No Convex tables found in convex/schema.ts')
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name))
}

function parseDocumentedTenantTables(markdown: string): Set<string> {
  const tables = new Set<string>()
  const rowPattern = /^\|\s*`([^`]+)`\s*\|/gm
  for (const match of markdown.matchAll(rowPattern)) {
    const tableName = match[1]?.trim()
    if (tableName) tables.add(tableName)
  }
  return tables
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
