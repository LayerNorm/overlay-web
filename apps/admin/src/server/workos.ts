import 'server-only'

import { WorkOS } from '@workos-inc/node'
import { workosApiKey, workosClientId } from '@/server/env'

let cached: WorkOS | null = null

export function workos(): WorkOS {
  if (!cached) cached = new WorkOS(workosApiKey())
  return cached
}

/** Authorization URL for the hosted AuthKit sign-in (provider = 'authkit'). */
export function adminAuthorizationUrl(redirectUri: string, state: string): string {
  return workos().userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: workosClientId(),
    redirectUri,
    state,
  })
}

export async function authenticateAdminWithCode(code: string) {
  return workos().userManagement.authenticateWithCode({
    clientId: workosClientId(),
    code,
  })
}

export async function refreshAdminSession(refreshToken: string) {
  return workos().userManagement.authenticateWithRefreshToken({
    clientId: workosClientId(),
    refreshToken,
  })
}
