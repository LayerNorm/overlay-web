import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'
import { betterAuth } from 'better-auth'
import { makeSignature } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'

import { AccountDeletionService } from '../src/server/account'
import { PostgresAccountDataDeletionRepository } from '../src/server/account/PostgresAccountDataDeletionRepository'
import type { OverlayServerContext } from '../src/server/bootstrap'
import { PostgresActConversationRepository } from '../src/server/conversations/PostgresActConversationRepository'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import {
  files,
  r2UploadIntents,
  users,
} from '../src/server/database/postgres/schema'
import { PostgresNoteRepository } from '../src/server/notes'
import { UserService } from '../src/server/users'
import { PostgresUserRepository } from '../src/server/users/PostgresUserRepository'

loadDotenv({ path: '.env.better-auth.local', override: false })
loadDotenv({ path: '.env.app-data.local', override: false })

type BetterAuthInternalContext = {
  authCookies: {
    sessionToken: {
      name: string
    }
  }
  internalAdapter: {
    createSession: (userId: string) => Promise<{ token: string }>
    createUser: (user: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
  secret: string
}

type SmokeBetterAuthConfig = {
  basePath: string
  baseUrl: string
  databaseUrl: string
  secret: string
  trustedOrigins: string[]
}

async function main() {
  const betterAuthConfig = resolveSmokeBetterAuthConfig()
  const appDataConnectionString = requiredEnv('OVERLAY_DATABASE_URL')
  const betterAuthPool = new Pool({
    connectionString: betterAuthConfig.databaseUrl,
  })
  const appDataPool = createOverlayPostgresPool({
    connectionString: appDataConnectionString,
    sslMode: optionalEnv('OVERLAY_DATABASE_SSL_MODE'),
  })
  const appDataDb = createOverlayPostgresDb(appDataPool)
  const conversationsRepository = new PostgresActConversationRepository(appDataDb)
  const noteRepository = new PostgresNoteRepository(appDataDb)
  const userService = new UserService({
    authProvider: 'better-auth',
    repository: new PostgresUserRepository(appDataDb),
  })

  const userId = `smoke_user_${randomUUID()}`
  const email = `${userId}@example.com`

  try {
    const betterAuthOptions = {
      baseURL: betterAuthConfig.baseUrl,
      basePath: betterAuthConfig.basePath,
      secret: betterAuthConfig.secret,
      database: betterAuthPool,
      trustedOrigins: [
        betterAuthConfig.baseUrl,
        ...betterAuthConfig.trustedOrigins,
      ],
      emailAndPassword: {
        enabled: false,
      },
      user: {
        deleteUser: {
          enabled: true,
        },
      },
    } satisfies Parameters<typeof betterAuth>[0]
    const testAuth = betterAuth(betterAuthOptions)
    const context = createAccountDeletionSmokeContext({
      accountDeletionRepository: new PostgresAccountDataDeletionRepository(appDataDb),
      authDeleteUser: async (id, request) => {
        if (!request) throw new Error('Smoke auth delete requires a request')
        const session = await testAuth.api.getSession({ headers: request.headers })
        if (session?.user?.id !== id) {
          throw new Error('Smoke auth delete requires a matching session')
        }
        await testAuth.api.deleteUser({
          headers: request.headers,
          body: {},
        })
      },
    })
    const authContext = await testAuth.$context as unknown as BetterAuthInternalContext
    await authContext.internalAdapter.createUser({
      id: userId,
      email,
      name: 'Phase Six Smoke',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const session = await authContext.internalAdapter.createSession(userId)
    const headers = await createSignedSessionHeaders(authContext, session.token)
    headers.set('origin', new URL(betterAuthConfig.baseUrl).origin)

    await userService.upsertFromSession({
      accessToken: 'smoke-access-token',
      user: {
        id: userId,
        email,
        firstName: 'Phase',
        lastName: 'Smoke',
        emailVerified: true,
      },
    })

    const note = await noteRepository.createNote({
      userId,
      title: 'Delete smoke note',
      content: '<p>delete me</p>',
      tags: ['smoke'],
      clientId: `note_${randomUUID()}`,
    })
    assert.ok(note.id)

    const conversationId = await conversationsRepository.createConversation({
      userId,
      title: 'Delete smoke chat',
      askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free',
      lastMode: 'act',
      clientId: `conversation_${randomUUID()}`,
    })
    await conversationsRepository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      role: 'user',
      mode: 'act',
      content: 'delete smoke',
      contentType: 'text',
      parts: [{ type: 'text', text: 'delete smoke' }],
      modelId: 'openrouter/free',
    })
    const assistantMessageId = await conversationsRepository.startGeneratingMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      mode: 'act',
      modelId: 'openrouter/free',
    })
    assert.ok(assistantMessageId)
    await conversationsRepository.appendGeneratingMessageDelta({
      messageId: assistantMessageId,
      textDelta: 'ok',
      newParts: [{ type: 'text', text: 'ok' }],
    })
    await conversationsRepository.finalizeGeneratingMessage({
      messageId: assistantMessageId,
      content: 'ok',
      parts: [{ type: 'text', text: 'ok' }],
      tokens: { input: 1, output: 1 },
    })
    await conversationsRepository.upsertContextSummary({
      conversationId,
      userId,
      scope: 'smoke',
      summary: 'delete smoke summary',
      summarizedThroughMessageId: assistantMessageId,
      summarizedThroughCreatedAt: Date.now(),
      sourceMessageCount: 2,
      sourceEstimatedTokens: 2,
      summaryEstimatedTokens: 1,
      contextWindow: 8000,
      targetModelId: 'openrouter/free',
      summarizerModelId: 'openrouter/free',
    })

    const fileId = `file_${randomUUID()}`
    const r2Key = `smoke/account-delete/${fileId}`
    await appDataDb.insert(files).values({
      id: fileId,
      userId,
      name: 'delete-smoke.txt',
      type: 'file',
      kind: 'upload',
      r2Key,
      mimeType: 'text/plain',
      sizeBytes: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await appDataDb.insert(r2UploadIntents).values({
      id: `upload_${randomUUID()}`,
      userId,
      fileId,
      r2Key,
      declaredSizeBytes: 12,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    })

    const result = await new AccountDeletionService(context).deleteAccount({
      userId,
      request: new Request(`${betterAuthConfig.baseUrl}/api/account/delete`, { headers }),
    })
    assert.equal(result.verification?.orphanedRowCount, 0)
    assert.equal(result.verification?.remainingRowsByTable.users, 0)

    const authCounts = await countBetterAuthRows(betterAuthPool, userId)
    assert.deepEqual(authCounts, {
      accounts: 0,
      sessions: 0,
      users: 0,
    })

    console.log(JSON.stringify({
      ok: true,
      deletedRowCount: result.deletedRowCount,
      collectedR2Keys: result.r2Keys.length,
      verification: result.verification,
      authCounts,
    }, null, 2))
  } finally {
    await cleanupBestEffort(betterAuthPool, appDataDb, userId)
    await betterAuthPool.end()
    await appDataPool.end()
  }
}

function createAccountDeletionSmokeContext(args: {
  accountDeletionRepository: PostgresAccountDataDeletionRepository
  authDeleteUser: (userId: string, request?: Request) => Promise<void>
}): OverlayServerContext {
  return {
    appDataCapabilities: {
      provider: 'postgres',
    },
    appData: {
      repositories: {
        accountDeletion: args.accountDeletionRepository,
      },
    },
    auth: {
      deleteUser: args.authDeleteUser,
    },
    objectStore: {
      deleteObject: async () => {},
    },
  } as unknown as OverlayServerContext
}

function resolveSmokeBetterAuthConfig(): SmokeBetterAuthConfig {
  return {
    baseUrl: env('BETTER_AUTH_URL', 'http://localhost:3000'),
    basePath: env('BETTER_AUTH_BASE_PATH', '/api/better-auth'),
    secret: requiredEnv('BETTER_AUTH_SECRET'),
    databaseUrl: requiredEnv('BETTER_AUTH_DATABASE_URL'),
    trustedOrigins: splitOrigins(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

async function createSignedSessionHeaders(
  authContext: BetterAuthInternalContext,
  sessionToken: string,
): Promise<Headers> {
  const signature = await makeSignature(sessionToken, authContext.secret)
  const headers = new Headers()
  headers.set(
    'cookie',
    `${authContext.authCookies.sessionToken.name}=${sessionToken}.${signature}`,
  )
  return headers
}

async function countBetterAuthRows(pool: Pool, userId: string): Promise<{
  accounts: number
  sessions: number
  users: number
}> {
  const result = await pool.query<{
    accounts: number
    sessions: number
    users: number
  }>(`
    SELECT
      (SELECT count(*)::int FROM "account" WHERE "userId" = $1) AS accounts,
      (SELECT count(*)::int FROM "session" WHERE "userId" = $1) AS sessions,
      (SELECT count(*)::int FROM "user" WHERE id = $1) AS users
  `, [userId])
  const row = result.rows[0]
  return {
    accounts: Number(row?.accounts ?? 0),
    sessions: Number(row?.sessions ?? 0),
    users: Number(row?.users ?? 0),
  }
}

async function cleanupBestEffort(
  betterAuthPool: Pool,
  appDataDb: ReturnType<typeof createOverlayPostgresDb>,
  userId: string,
): Promise<void> {
  await Promise.allSettled([
    betterAuthPool.query('DELETE FROM "session" WHERE "userId" = $1', [userId]),
    betterAuthPool.query('DELETE FROM "account" WHERE "userId" = $1', [userId]),
    betterAuthPool.query('DELETE FROM "user" WHERE id = $1', [userId]),
    appDataDb.delete(users).where(eq(users.id, userId)),
  ])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
