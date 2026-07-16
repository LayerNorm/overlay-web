import 'server-only'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { ConvexUserRepository } from './ConvexUserRepository'
import { PostgresUserRepository } from './PostgresUserRepository'
import { UserService } from './UserService'
import type { UserAuthProvider, UserRepository } from './types'

export function createUserService(runtimeConfig: OverlayRuntimeConfig | null): UserService {
  return new UserService({
    authProvider: selectedAuthProvider(runtimeConfig),
    repository: createUserRepository(runtimeConfig),
  })
}

function createUserRepository(runtimeConfig: OverlayRuntimeConfig | null): UserRepository {
  const databaseProvider = runtimeConfig
    ? runtimeConfig.providers.database?.provider ?? runtimeConfig.database.provider
    : 'convex'

  if (databaseProvider === 'postgres') {
    const connectionString = runtimeConfig?.database.postgres.connectionString
    if (!connectionString) {
      throw new Error('database.postgres.connectionString is required for Postgres user sync')
    }
    const pool = createOverlayPostgresPool({
      connectionString,
      sslMode: runtimeConfig.database.postgres.sslMode,
    })
    return new PostgresUserRepository(createOverlayPostgresDb(pool))
  }

  return new ConvexUserRepository()
}

function selectedAuthProvider(runtimeConfig: OverlayRuntimeConfig | null): UserAuthProvider {
  const provider = runtimeConfig
    ? runtimeConfig.providers.auth?.provider ?? runtimeConfig.auth.provider
    : 'workos'
  switch (provider) {
    case 'workos':
    case 'better-auth':
    case 'oidc':
    case 'none':
      return provider
  }
}
