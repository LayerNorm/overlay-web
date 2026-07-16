import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import {
  AdministrativeAuthorizationError,
  AdministrativeService,
  AuditService,
  PostgresAdministrativeRepository,
  PostgresAuditRepository,
} from '@/server/admin'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres administration enforces roles and emits sanitized append-only audit records', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres administration contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p7f_${randomUUID().replaceAll('-', '')}`
  const adminId = `${scope}_admin`
  const auditorId = `${scope}_auditor`
  const userId = `${scope}_user`
  const repository = new PostgresAdministrativeRepository(db)
  const auditRepository = new PostgresAuditRepository(db)
  const audit = new AuditService(auditRepository)
  const service = new AdministrativeService({ audit, repository })

  try {
    await db.insert(users).values([
      { id: adminId, email: `${scope}-admin@example.com`, emailVerified: true },
      { id: auditorId, email: `${scope}-auditor@example.com`, emailVerified: true },
      { id: userId, email: `${scope}-user@example.com`, emailVerified: true },
    ])
    await assert.rejects(service.list(userId), AdministrativeAuthorizationError)
    await repository.grant({
      grantedBy: 'system:contract-test',
      reason: 'bootstrap',
      role: 'admin',
      userId: adminId,
    })
    assert.equal(await service.canManageAdministrators(adminId), true)
    const auditor = await service.grant({
      actorUserId: adminId,
      reason: 'read-only compliance review',
      role: 'auditor',
      userId: auditorId,
    })
    assert.equal(auditor.role, 'auditor')
    assert.equal(await service.canViewAudit(auditorId), true)
    assert.equal(await service.canManageAdministrators(auditorId), false)
    await assert.rejects(
      service.grant({ actorUserId: auditorId, role: 'support', userId }),
      AdministrativeAuthorizationError,
    )

    await audit.record({
      action: 'contract.secret_redaction',
      actorType: 'user',
      actorUserId: adminId,
      metadata: {
        apiKey: 'must-not-persist',
        nested: { accessToken: 'must-not-persist', safe: 'visible' },
      },
      outcome: 'success',
      resourceId: userId,
      resourceType: 'contract',
    })
    const events = await audit.list({ actorUserId: adminId, limit: 20 })
    const redacted = events.find((event) => event.action === 'contract.secret_redaction')
    assert.equal(redacted?.metadata.apiKey, '[REDACTED]')
    assert.deepEqual(redacted?.metadata.nested, { accessToken: '[REDACTED]', safe: 'visible' })
    assert.ok(events.some((event) => event.action === 'administration.principal.grant'))

    assert.equal(await service.revoke({ actorUserId: adminId, userId: auditorId }), true)
    assert.equal(await service.canViewAudit(auditorId), false)
    await assert.rejects(
      service.revoke({ actorUserId: adminId, userId: adminId }),
      /cannot revoke their own/,
    )
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id IN (${adminId}, ${auditorId}, ${userId})`)
    await db.execute(sql`DELETE FROM audit_events WHERE id LIKE 'audit_%' AND resource_id LIKE ${`${scope}%`}`)
    await pool.end()
  }
})
