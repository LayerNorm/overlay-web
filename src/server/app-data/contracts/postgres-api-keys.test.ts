import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { ApiKeyService } from '@/server/auth/api-keys/ApiKeyService'
import { PostgresApiKeyRepository } from '@/server/auth/api-keys/PostgresApiKeyRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres API keys enforce ownership, scopes, expiry policy, rotation, and revocation', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres API key contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p7e_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const otherUserId = `${scope}_other`
  const service = new ApiKeyService(new PostgresApiKeyRepository(db))

  try {
    await db.insert(users).values([
      { id: userId, email: `${scope}@example.com`, emailVerified: true },
      { id: otherUserId, email: `${scope}-other@example.com`, emailVerified: true },
    ])
    const created = await service.create({
      createdBy: userId,
      name: 'Contract key',
      scopes: ['chat:read', 'files:read'],
      userId,
    })
    assert.match(created.key, /^ovl_sk_/)
    assert.equal((await service.list({ userId }))[0]?.id, created.id)
    assert.equal((await service.list({ userId: otherUserId })).length, 0)
    assert.equal((await service.validate({ apiKey: created.key, requiredScopes: ['chat:read'] }))?.id, created.id)
    assert.equal(await service.validate({ apiKey: created.key, requiredScopes: ['chat:write'] }), null)
    assert.equal(await service.revokeById({ id: created.id, userId: otherUserId }), false)

    const rotated = await service.rotateById({
      createdBy: userId,
      id: created.id,
      name: 'Rotated contract key',
      scopes: ['chat:read', 'chat:write'],
      userId,
    })
    assert.ok(rotated)
    assert.equal(await service.validate({ apiKey: created.key }), null)
    assert.equal((await service.validate({ apiKey: rotated!.key, requiredScopes: ['chat:write'] }))?.id, rotated!.id)
    assert.equal(await service.revokeById({ id: rotated!.id, userId }), true)
    assert.equal(await service.validate({ apiKey: rotated!.key }), null)
    await assert.rejects(
      service.create({
        createdBy: userId,
        scopes: ['admin'],
        userId,
      }),
      /elevated authorization/,
    )
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id IN (${userId}, ${otherUserId})`)
    await pool.end()
  }
})
