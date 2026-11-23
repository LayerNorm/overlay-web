import 'server-only'

import type { UserProfile } from '@overlay/app-core'

export type InviteeIdentity = { email: string; displayName: string }

type Person = { email?: string; firstName?: string; lastName?: string }

/**
 * Who is accepting a workspace invitation. A browser session already carries
 * the verified profile; the native app's access token may not, so fall back to
 * the token's profile claims and then to the auth provider's user record.
 * Only verified emails are trusted, because invitations are bound to an email.
 */
export async function resolveInviteeIdentity(input: {
  authType: string
  userId: string
  accessToken: string
  session: { user: Person } | null
  provider: {
    getUserProfile(token: string): Promise<UserProfile | null>
    getUserById?(userId: string): Promise<UserProfile | null>
  }
}): Promise<InviteeIdentity | null> {
  if (input.session?.user.email) return identity(input.session.user)
  if (input.authType !== 'access-token') return null
  const claims = input.accessToken ? await input.provider.getUserProfile(input.accessToken) : null
  if (claims?.id === input.userId && claims.email && claims.emailVerified) return identity(claims)
  const user = await input.provider.getUserById?.(input.userId)
  if (user?.id === input.userId && user.email && user.emailVerified) return identity(user)
  return null
}

function identity(person: Person & { email?: string }): InviteeIdentity {
  const email = person.email!
  return {
    email,
    displayName: [person.firstName, person.lastName].filter(Boolean).join(' ') || email,
  }
}
