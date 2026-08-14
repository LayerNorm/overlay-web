import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import {
  conversations,
  r2UploadIntents,
  users,
} from '../src/server/database/postgres/schema'
import { PostgresActConversationRepository } from '../src/server/conversations/PostgresActConversationRepository'
import { PostgresBackgroundMaintenanceService } from '../src/server/app-data/PostgresBackgroundMaintenanceService'
import { UnlimitedUsagePolicy } from '../src/server/conversations/ActUsagePolicy'
import { FileService } from '../src/server/files/FileService'
import { PostgresFileRepository } from '../src/server/files/PostgresFileRepository'
import { PostgresNoteRepository } from '../src/server/notes'
import { PostgresUserRepository } from '../src/server/users'

const REQUIRED_TABLES = [
  'auth_identities',
  'conversation_context_summaries',
  'conversation_messages',
  'conversations',
  'files',
  'notes',
  'onboarding_state',
  'overlay_app_data_metadata',
  'projects',
  'r2_upload_intents',
  'user_settings',
  'users',
] as const

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to smoke-test the Overlay app-data database')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    const metadata = await db.execute(sql`
      SELECT value
      FROM overlay_app_data_metadata
      WHERE key = 'schema_kind'
      LIMIT 1
    `)
    const schemaKind = metadata.rows[0]?.value
    if (schemaKind !== 'overlay-app-data') {
      throw new Error('Overlay app-data metadata marker is missing. Run npm run app-db:migrate first.')
    }

    const tables = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (${sql.join(REQUIRED_TABLES.map((tableName) => sql`${tableName}`), sql`, `)})
      ORDER BY table_name
    `)
    const tableNames = new Set(tables.rows.map((row) => String(row.table_name)))
    const missingTables = REQUIRED_TABLES.filter((tableName) => !tableNames.has(tableName))
    if (missingTables.length > 0) {
      throw new Error(`Overlay app-data schema is missing tables: ${missingTables.join(', ')}`)
    }

    const version = await db.execute(sql`SELECT current_database() AS database_name, version() AS postgres_version`)
    const verticalSlice = await smokeChatVerticalSlice(db)

    console.log(JSON.stringify({
      ok: true,
      databaseName: version.rows[0]?.database_name,
      schemaKind,
      tableCount: tableNames.size,
      verticalSlice,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function smokeChatVerticalSlice(db: ReturnType<typeof createOverlayPostgresDb>) {
  const userId = `smoke_user_${randomUUID()}`
  const email = `${userId}@example.com`
  const usersRepository = new PostgresUserRepository(db)
  const conversationsRepository = new PostgresActConversationRepository(db)
  const filesRepository = new PostgresFileRepository(db)
  const notesRepository = new PostgresNoteRepository(db)
  const maintenanceService = new PostgresBackgroundMaintenanceService(db)
  const usagePolicy = new UnlimitedUsagePolicy()
  const deletedStorageKeys: string[] = []
  const filesService = new FileService({
    repository: filesRepository,
    storage: {
      checkGlobalR2Budget: async () => {},
      deleteObject: async (key) => {
        deletedStorageKeys.push(key)
      },
      deleteObjects: async (keys) => {
        deletedStorageKeys.push(...keys)
      },
      generatePresignedDownloadUrl: async (key) => `https://storage.example.test/${encodeURIComponent(key)}`,
      generatePresignedUploadUrl: async (key) => `https://storage.example.test/upload/${encodeURIComponent(key)}`,
      getMaxPresignedUploadBytes: () => 10_000_000,
      getR2PresignTtlSeconds: () => 900,
      headObject: async () => ({ sizeBytes: 12, contentType: 'text/plain' }),
      keyForFile: (owner, id, name) => `users/${owner}/files/${id}/${encodeURIComponent(name)}`,
      uploadBuffer: async () => {},
    },
  })

  try {
    await usersRepository.upsertFromIdentity({
      identity: {
        provider: 'better-auth',
        subject: userId,
        email,
      },
      now: new Date(),
      user: {
        id: userId,
        email,
        firstName: 'Smoke',
        lastName: 'User',
        emailVerified: true,
      },
    })

    const entitlements = await usagePolicy.getEntitlements({ userId })
    if (entitlements.planKind !== 'paid') {
      throw new Error('UnlimitedUsagePolicy did not return paid entitlements')
    }

    const conversationId = await conversationsRepository.createConversation({
      userId,
      title: 'Postgres smoke chat',
      askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free',
      lastMode: 'act',
      clientId: `smoke_${randomUUID()}`,
    })
    await conversationsRepository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      role: 'user',
      mode: 'act',
      content: 'hello',
      contentType: 'text',
      parts: [{ type: 'text', text: 'hello' }],
      modelId: 'openrouter/free',
    })
    const assistantMessageId = await conversationsRepository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      role: 'assistant',
      mode: 'act',
      content: 'hello back',
      contentType: 'text',
      parts: [{ type: 'text', text: 'hello back' }],
      modelId: 'openrouter/free',
      tokens: { input: 1, output: 2 },
    })
    if (!assistantMessageId) throw new Error('Failed to create assistant message')
    const messages = await conversationsRepository.getConversationMessages({
      conversationId,
      userId,
    })
    if (messages.length !== 2 || messages[1]?.content !== 'hello back') {
      throw new Error(`Unexpected Postgres chat messages after smoke write: ${messages.length}`)
    }

    const createdNote = await notesRepository.createNote({
      userId,
      title: 'Postgres smoke note',
      content: '<p>hello note</p>',
      tags: ['smoke'],
      clientId: `smoke_note_${randomUUID()}`,
    })
    if (!createdNote.note || createdNote.note.name !== 'Postgres smoke note') {
      throw new Error('Failed to create Postgres smoke note')
    }
    const updatedNote = await notesRepository.updateNote({
      noteId: createdNote.id,
      userId,
      title: 'Updated Postgres smoke note',
      content: '<p>updated note</p>',
      tags: ['smoke', 'updated'],
    })
    if (!updatedNote || updatedNote.name !== 'Updated Postgres smoke note') {
      throw new Error('Failed to update Postgres smoke note')
    }
    const listedNotes = await notesRepository.listNotes({ userId })
    if (!listedNotes.some((note) => note._id === createdNote.id)) {
      throw new Error('Postgres smoke note was not returned from listNotes')
    }
    const deletedNote = await notesRepository.deleteNote({
      noteId: createdNote.id,
      userId,
    })
    if (!deletedNote?.deletedAt) {
      throw new Error('Failed to delete Postgres smoke note')
    }

    const createdFile = await filesService.createFile({
      userId,
      body: {
        name: 'smoke-file.txt',
        type: 'file',
        content: 'hello phase six files',
      },
    })
    const fileId = String(createdFile.id)
    const duplicateFile = await filesService.createFile({
      userId,
      body: {
        name: 'smoke-file-copy.txt',
        type: 'file',
        content: 'hello phase six files',
      },
    })
    const duplicateFileId = String(duplicateFile.id)
    const duplicateBeforeDelete = await filesRepository.getFile({ fileId: duplicateFileId, userId })
    if (duplicateBeforeDelete?.duplicateOfFileId !== fileId) {
      throw new Error('Postgres file duplicate was not linked to canonical file')
    }

    await filesService.updateFile({
      userId,
      body: {
        fileId,
        name: 'renamed-smoke-file.txt',
      },
    })
    const search = await filesService.searchText({
      userId,
      body: {
        fileIds: [fileId],
        query: 'phase six',
      },
    })
    if (!search.matches.some((match) => match.fileId === fileId)) {
      throw new Error('Postgres file text search did not return expected match')
    }
    const share = await filesService.setShare({
      userId,
      fileId,
      visibility: 'public',
      origin: 'https://overlay.example.test',
    })
    if (!share.token || !share.url?.includes('/share/f/')) {
      throw new Error('Postgres file sharing did not return a public token')
    }

    await filesService.deleteFile({ userId, fileId })
    const duplicateAfterDelete = await filesRepository.getFile({ fileId: duplicateFileId, userId })
    if (!duplicateAfterDelete || duplicateAfterDelete.duplicateOfFileId) {
      throw new Error('Postgres file duplicate was not promoted after canonical delete')
    }

    const folder = await filesService.createFile({
      userId,
      body: {
        name: 'smoke-folder',
        type: 'folder',
        kind: 'folder',
      },
    })
    const folderId = String(folder.id)
    const r2Key = `users/${userId}/files/smoke-upload/upload.txt`
    await filesRepository.createUploadIntent({
      userId,
      r2Key,
      declaredSizeBytes: 20,
      mimeType: 'text/plain',
      expiresAt: Date.now() + 60_000,
    })
    const uploadIntent = await filesRepository.getUploadIntent({
      userId,
      r2Key,
      now: Date.now(),
    })
    if (!uploadIntent) {
      throw new Error('Postgres upload intent was not readable after create')
    }
    const uploadedFileId = await filesRepository.createFileWithStorage({
      userId,
      name: 'upload.txt',
      parentId: folderId,
      r2Key,
      mimeType: 'text/plain',
      sizeBytes: 12,
    })
    if (!uploadedFileId) {
      throw new Error('Postgres storage-backed file was not created')
    }
    await filesRepository.finalizeUploadIntent({
      userId,
      r2Key,
      actualSizeBytes: 12,
      fileId: uploadedFileId,
      now: Date.now(),
    })
    const [finalizedIntent] = await db
      .select()
      .from(r2UploadIntents)
      .where(eq(r2UploadIntents.r2Key, r2Key))
      .limit(1)
    if (finalizedIntent?.status !== 'finalized' || finalizedIntent.fileId !== uploadedFileId) {
      throw new Error('Postgres upload intent did not finalize against the file')
    }

    await filesService.deleteFile({ userId, fileId: folderId })
    const uploadedAfterFolderDelete = await filesRepository.getFile({ fileId: uploadedFileId, userId })
    if (uploadedAfterFolderDelete) {
      throw new Error('Postgres recursive folder delete left child file visible')
    }
    if (!deletedStorageKeys.includes(r2Key)) {
      throw new Error('Postgres recursive folder delete did not surface R2 cleanup key')
    }

    const maintenanceResult = await smokeBackgroundMaintenance({
      conversationsRepository,
      db,
      maintenanceService,
      userId,
    })

    return {
      ok: true,
      conversationId,
      messageCount: messages.length,
      noteId: createdNote.id,
      fileId,
      duplicateFileId,
      uploadedFileId,
      maintenance: maintenanceResult,
      usagePolicy: 'unlimited',
    }
  } finally {
    await db.delete(users).where(eq(users.id, userId))
  }
}

async function smokeBackgroundMaintenance(args: {
  conversationsRepository: PostgresActConversationRepository
  db: ReturnType<typeof createOverlayPostgresDb>
  maintenanceService: PostgresBackgroundMaintenanceService
  userId: string
}) {
  const now = new Date()
  const oldDate = new Date(now.getTime() - 15 * 60_000)
  const conversationId = await args.conversationsRepository.createConversation({
    userId: args.userId,
    title: 'Postgres maintenance smoke',
    askModelIds: ['openrouter/free'],
    actModelId: 'openrouter/free',
    lastMode: 'act',
    clientId: `smoke_maintenance_${randomUUID()}`,
  })
  const userMessageId = await args.conversationsRepository.addMessage({
    conversationId,
    userId: args.userId,
    turnId: 'maintenance_expired_run',
    role: 'user',
    mode: 'act',
    content: 'expire this run',
    contentType: 'text',
    parts: [{ type: 'text', text: 'expire this run' }],
    modelId: 'openrouter/free',
  })
  if (!userMessageId) throw new Error('Failed to create maintenance user message')
  const expiredRun = await args.conversationsRepository.startAgentRun({
    conversationId,
    userId: args.userId,
    userMessageId,
    turnId: 'maintenance_expired_run',
    mode: 'chat',
    runner: 'tool_loop',
    modelId: 'openrouter/free',
    leaseExpiresAt: oldDate.getTime(),
  })
  if (!expiredRun) throw new Error('Failed to create expired AgentRun')

  const emptyConversationId = await args.conversationsRepository.createConversation({
    userId: args.userId,
    title: 'Postgres empty maintenance smoke',
    askModelIds: ['openrouter/free'],
    actModelId: 'openrouter/free',
    lastMode: 'act',
    clientId: `smoke_empty_${randomUUID()}`,
  })
  await args.db
    .update(conversations)
    .set({
      createdAt: oldDate,
      lastModified: oldDate,
      updatedAt: oldDate,
    })
    .where(eq(conversations.id, emptyConversationId))

  const summary = await args.maintenanceService.runAll({
    emptyConversationCutoffMinutes: 5,
    limit: 20,
    now,
  })
  if (summary.expiredAgentRuns.failed < 1) {
    throw new Error('Postgres background maintenance did not fail the expired AgentRun')
  }
  if (summary.emptyConversations.deleted < 1) {
    throw new Error('Postgres background maintenance did not remove empty conversations')
  }

  const reconciledRun = await args.conversationsRepository.getLatestAgentRun({
    conversationId,
    userId: args.userId,
  })
  if (reconciledRun?.id !== expiredRun.id || reconciledRun.status !== 'failed') {
    throw new Error('Postgres expired AgentRun did not reach failed state')
  }
  const [emptyAfter] = await args.db
    .select()
    .from(conversations)
    .where(eq(conversations.id, emptyConversationId))
    .limit(1)
  if (emptyAfter) {
    throw new Error('Postgres empty conversation was not deleted')
  }

  return summary
}
