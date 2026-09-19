import 'server-only'

import type { OverlayRuntimeConfig } from '@/shared/config'
import { ConvexUserRepository } from './ConvexUserRepository'
import { UserService } from './UserService'
import type { UserAuthProvider } from './types'

export function createUserService(runtimeConfig: OverlayRuntimeConfig | null): UserService {
  return new UserService({
    authProvider: selectedAuthProvider(runtimeConfig),
    repository: new ConvexUserRepository(),
  })
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
