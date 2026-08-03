import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { providerConnections, users } from '@/server/database/postgres/schema'
import { PostgresProviderConnectionRepository } from './PostgresProviderConnectionRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres provider connections enforce owner scoping and keep only opaque secret references', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres provider connection contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const suffix = randomUUID()
  const userId = `byok_owner_${suffix}`
  const otherUserId = `byok_other_${suffix}`
  const repository = new PostgresProviderConnectionRepository(db)

  try {
    await db.insert(users).values([
      { id: userId, email: `${userId}@example.com` },
      { id: otherUserId, email: `${otherUserId}@example.com` },
    ])
    const connectionId = await repository.create({
      userId,
      providerId: 'custom-openai-compatible',
      endpoint: 'https://models.jpgs.example/v1',
      displayName: 'JPGS model gateway',
      credentialRef: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:opaque',
      enabledModelIds: ['school-model-v1'],
      isDefault: false,
      isDeletable: true,
    })

    assert.match(connectionId, /^byok_[a-f0-9]{32}$/)
    assert.equal(await repository.count({ userId }), 1)
    assert.equal(await repository.get({ connectionId, userId: otherUserId }), null)
    await assert.rejects(repository.update({
      connectionId,
      userId: otherUserId,
      status: 'active',
    }))
    assert.equal(await repository.remove({ connectionId, userId: otherUserId }), null)

    await repository.update({
      connectionId,
      userId,
      discoveredModelsJson: JSON.stringify({ data: [{ id: 'school-model-v1' }] }),
      discoveredAt: Date.now(),
      enabledModelIds: ['school-model-v1'],
      lastTestedAt: Date.now(),
      status: 'active',
    })
    const publicRows = await repository.listPublic({ userId })
    assert.equal(publicRows.length, 1)
    assert.equal('credentialRef' in publicRows[0], false)
    assert.equal(publicRows[0]?.status, 'active')
    assert.deepEqual(await repository.listCredentialRefs({ userId }), [
      'arn:aws:secretsmanager:ap-south-1:123456789012:secret:opaque',
    ])

    const gateway = await repository.ensureDefaultGateway({
      userId,
      endpoint: 'https://ai.gateway.vercel.sh/v1',
      displayName: 'Overlay gateway',
      enabledModelIds: ['gateway-model'],
    })
    const reseeded = await repository.ensureDefaultGateway({
      userId,
      endpoint: 'https://ai.gateway.vercel.sh/v1',
      displayName: 'Overlay gateway',
      enabledModelIds: ['gateway-model'],
    })
    assert.equal(gateway._id, reseeded._id)
    assert.equal(gateway.isDeletable, false)

    await db.delete(users).where(eq(users.id, userId))
    const rowsAfterDeletion = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.userId, userId))
    assert.deepEqual(rowsAfterDeletion, [])
  } finally {
    await db.delete(users).where(eq(users.id, userId))
    await db.delete(users).where(eq(users.id, otherUserId))
    await pool.end()
  }
})
