import { lazyConvex as convex } from '../src/server/database/lazy-convex'
import { getInternalApiSecret } from '../src/server/shared/internal-api-secret'

type Page = {
  rows: number
  continueCursor: string
  isDone: boolean
}

type AuditPage = Page & {
  missingConversationScope: number
  missingMessageAuthor: number
  missingResourceScope: number
}

type Audit = {
  conversationCount: number
  messageCount: number
  missingConversationScope: number
  missingMessageAuthor: number
  missingResourceScope: number
}

const PAGE_SIZE = 25

async function migrate(path: string) {
  let cursor: string | null = null
  let rows = 0
  let migrated = 0
  let scopesBound = 0
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    const page = await convex.mutation<Page & { migrated: number; scopesBound?: number }>(
      path,
      {
        serverSecret: getInternalApiSecret(),
        paginationOpts: { cursor, numItems: PAGE_SIZE },
      },
      { throwOnError: true },
    )
    if (!page) throw new Error(`${path} returned no result`)
    rows += page.rows
    migrated += page.migrated
    scopesBound += page.scopesBound ?? 0
    if (page.isDone) return { rows, migrated, scopesBound, pages: pageNumber + 1 }
    cursor = page.continueCursor
  }
  throw new Error(`${path} exceeded 10,000 pages`)
}

async function auditTable(table: 'conversations' | 'messages') {
  let cursor: string | null = null
  const total: AuditPage = {
    rows: 0,
    missingConversationScope: 0,
    missingMessageAuthor: 0,
    missingResourceScope: 0,
    continueCursor: '',
    isDone: false,
  }
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    const page = await convex.query<AuditPage>(
      'collaboration/conversationMigration:auditBatchByServer',
      {
        serverSecret: getInternalApiSecret(),
        table,
        paginationOpts: { cursor, numItems: PAGE_SIZE },
      },
      { throwOnError: true },
    )
    if (!page) throw new Error(`Audit for ${table} returned no result`)
    total.rows += page.rows
    total.missingConversationScope += page.missingConversationScope
    total.missingMessageAuthor += page.missingMessageAuthor
    total.missingResourceScope += page.missingResourceScope
    if (page.isDone) return total
    cursor = page.continueCursor
  }
  throw new Error(`Audit for ${table} exceeded 10,000 pages`)
}

async function audit(): Promise<Audit> {
  const [conversations, messages] = await Promise.all([
    auditTable('conversations'),
    auditTable('messages'),
  ])
  return {
    conversationCount: conversations.rows,
    messageCount: messages.rows,
    missingConversationScope: conversations.missingConversationScope,
    missingMessageAuthor: messages.missingMessageAuthor,
    missingResourceScope: conversations.missingResourceScope,
  }
}

async function main() {
  const before = await audit()
  const conversationMigration = await migrate(
    'collaboration/conversationMigration:migrateConversationsBatchByServer',
  )
  const messageMigration = await migrate(
    'collaboration/conversationMigration:migrateMessagesBatchByServer',
  )
  const after = await audit()
  if (
    after.missingConversationScope
    || after.missingMessageAuthor
    || after.missingResourceScope
    || before.conversationCount !== after.conversationCount
    || before.messageCount !== after.messageCount
  ) {
    throw new Error(`Conversation migration audit failed: ${JSON.stringify({ before, after })}`)
  }
  console.log(JSON.stringify({
    ok: true,
    before,
    conversationMigration,
    messageMigration,
    after,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
