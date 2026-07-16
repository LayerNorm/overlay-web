import { createOverlayPostgresDb, createOverlayPostgresPool } from '../src/server/database/postgres/client'
import {
  AuditService,
  PostgresAdministrativeRepository,
  PostgresAuditRepository,
  isAdministrativeRole,
} from '../src/server/admin'

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL or DATABASE_URL is required')

  const [command, ...argv] = process.argv.slice(2)
  const values = parseArgs(argv)
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 1,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresAdministrativeRepository(db)
  const audit = new AuditService(new PostgresAuditRepository(db))

  try {
    if (command === 'list') {
      process.stdout.write(`${JSON.stringify(await repository.list(), null, 2)}\n`)
    } else if (command === 'grant') {
      const userId = required(values, 'user-id')
      const role = required(values, 'role')
      if (!isAdministrativeRole(role)) throw new Error(`Invalid role: ${role}`)
      const principal = await repository.grant({
        grantedBy: 'system:app-data-admin',
        reason: values.reason,
        role,
        userId,
      })
      await audit.record({
        action: 'administration.principal.bootstrap_grant',
        actorType: 'system',
        metadata: { reason: values.reason, role },
        outcome: 'success',
        resourceId: userId,
        resourceType: 'administrative_principal',
      })
      process.stdout.write(`${JSON.stringify(principal, null, 2)}\n`)
    } else if (command === 'revoke') {
      const userId = required(values, 'user-id')
      const revoked = await repository.revoke({ revokedBy: 'system:app-data-admin', userId })
      await audit.record({
        action: 'administration.principal.bootstrap_revoke',
        actorType: 'system',
        outcome: revoked ? 'success' : 'failure',
        resourceId: userId,
        resourceType: 'administrative_principal',
      })
      process.stdout.write(`${JSON.stringify({ revoked })}\n`)
    } else {
      throw new Error('Usage: app-data-admin <list|grant|revoke> [--user-id ID] [--role admin|auditor|billing_admin|support] [--reason TEXT]')
    }
  } finally {
    await pool.end()
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key ?? ''}`)
    parsed[key.slice(2)] = value
  }
  return parsed
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key]?.trim()
  if (!value) throw new Error(`--${key} is required`)
  return value
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
