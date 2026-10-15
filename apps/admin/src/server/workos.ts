import 'server-only'

import { WorkOS } from '@workos-inc/node'

import { workosApiKey, workosClientId } from './env'

let cached: WorkOS | null = null

function client(): WorkOS {
  return (cached ??= new WorkOS(workosApiKey()))
}

/** Hosted AuthKit sign-in: staff authenticate with whatever providers WorkOS has configured. */
export function adminAuthorizationUrl(args: { codeChallenge: string; origin: string; state: string }): string {
  const url = new URL(client().userManagement.getAuthorizationUrl({
    clientId: workosClientId(),
    codeChallenge: args.codeChallenge,
    codeChallengeMethod: 'S256',
    provider: 'authkit',
    redirectUri: `${args.origin}/auth/callback`,
    state: args.state,
  }))
  // The installed WorkOS SDK predates maxAge; AuthKit accepts the standard parameter.
  url.searchParams.set('max_age', '0')
  return url.toString()
}

export async function authenticateWithCode(code: string, codeVerifier: string) {
  return client().userManagement.authenticateWithCode({
    clientId: workosClientId(),
    code,
    codeVerifier,
  })
}

export async function refreshSession(refreshToken: string) {
  return client().userManagement.authenticateWithRefreshToken({
    clientId: workosClientId(),
    refreshToken,
  })
}
