import 'server-only'

import type { Pool } from 'pg'
import { createOverlayPostgresPool } from './client'

export const APP_DATA_SCHEMA_VERSION = 32
export const APP_DATA_MINIMUM_SCHEMA_VERSION = 32
export const APP_DATA_MIGRATION_LOCK_ID = 6_849_331_027

export type AppDataSchemaCompatibility = {
  compatible: boolean
  databaseMinimumRuntimeVersion: number
  databaseSchemaVersion: number
  runtimeMaximumSchemaVersion: number
  runtimeMinimumSchemaVersion: number
}

export function evaluateAppDataSchemaCompatibility(args: {
  databaseMinimumRuntimeVersion: number
  databaseSchemaVersion: number
  runtimeMaximumSchemaVersion: number
  runtimeMinimumSchemaVersion: number
}): AppDataSchemaCompatibility {
  return {
    ...args,
    compatible:
      args.databaseSchemaVersion >= args.runtimeMinimumSchemaVersion &&
      args.databaseMinimumRuntimeVersion <= args.runtimeMaximumSchemaVersion,
  }
}

export class AppDataSchemaCompatibilityError extends Error {
  constructor(
    message: string,
    readonly compatibility?: AppDataSchemaCompatibility,
  ) {
    super(message)
    this.name = 'AppDataSchemaCompatibilityError'
  }
}

export async function readAppDataSchemaCompatibility(
  pool: Pool,
): Promise<AppDataSchemaCompatibility> {
  const result = await pool.query<{ key: string; value: string }>(`
    SELECT key, value
    FROM overlay_app_data_metadata
    WHERE key IN ('schema_version', 'schema_min_compatible_version')
  `).catch((error) => {
    throw new AppDataSchemaCompatibilityError(
      `Overlay app-data schema metadata is unavailable. Run npm run app-db:migrate before starting the runtime. ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  const values = new Map(result.rows.map((row) => [row.key, row.value]))
  const databaseSchemaVersion = parseVersion(values.get('schema_version'))
  const databaseMinimumRuntimeVersion = parseVersion(values.get('schema_min_compatible_version'))
  if (databaseSchemaVersion === null || databaseMinimumRuntimeVersion === null) {
    throw new AppDataSchemaCompatibilityError(
      'Overlay app-data schema metadata is incomplete. Run npm run app-db:migrate before starting the runtime.',
    )
  }

  const compatibility = evaluateAppDataSchemaCompatibility({
    databaseMinimumRuntimeVersion,
    databaseSchemaVersion,
    runtimeMaximumSchemaVersion: APP_DATA_SCHEMA_VERSION,
    runtimeMinimumSchemaVersion: APP_DATA_MINIMUM_SCHEMA_VERSION,
  })
  return compatibility
}

export async function assertAppDataSchemaCompatible(pool: Pool): Promise<void> {
  const compatibility = await readAppDataSchemaCompatibility(pool)
  if (compatibility.compatible) return

  throw new AppDataSchemaCompatibilityError(
    `Overlay app-data schema is incompatible: database=${compatibility.databaseSchemaVersion}, ` +
    `databaseMinimumRuntime=${compatibility.databaseMinimumRuntimeVersion}, ` +
    `runtimeSupported=${compatibility.runtimeMinimumSchemaVersion}-${compatibility.runtimeMaximumSchemaVersion}. ` +
    'Run the matching release migration before starting or rolling back the application.',
    compatibility,
  )
}

export async function assertConfiguredPostgresSchemaCompatible(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { getOverlayRuntimeConfig } = await import('@/server/config/loadOverlayConfig')
  const runtimeConfig = await getOverlayRuntimeConfig()
  const selectedProvider = runtimeConfig.providers.database?.provider ?? runtimeConfig.database.provider
  if (selectedProvider !== 'postgres') return

  const connectionString = runtimeConfig.database.postgres.connectionString
  if (!connectionString) {
    throw new AppDataSchemaCompatibilityError(
      'database.postgres.connectionString is required for the Postgres runtime compatibility check.',
    )
  }
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 1,
    sslMode: runtimeConfig.database.postgres.sslMode,
  })
  try {
    await assertAppDataSchemaCompatible(pool)
  } finally {
    await pool.end()
  }
}

function parseVersion(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
