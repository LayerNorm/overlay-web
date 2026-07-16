import 'server-only'

import type {
  UserAuthProvider,
  UserRepository,
  UserServiceOptions,
  UserSession,
  UserUpsertResult,
} from './types'

export class UserService {
  private readonly authProvider: UserAuthProvider
  private readonly repository: UserRepository

  constructor(options: UserServiceOptions) {
    this.authProvider = options.authProvider
    this.repository = options.repository
  }

  async upsertFromSession(session: UserSession): Promise<UserUpsertResult> {
    const userId = normalizeRequiredString(session.user.id, 'session.user.id')
    const email = normalizeEmail(session.user.email)

    return await this.repository.upsertFromIdentity({
      identity: {
        provider: this.authProvider,
        subject: userId,
        email,
      },
      user: {
        ...session.user,
        id: userId,
        email,
        firstName: normalizeOptionalString(session.user.firstName),
        lastName: normalizeOptionalString(session.user.lastName),
        profilePictureUrl: normalizeOptionalString(session.user.profilePictureUrl),
        emailVerified: session.user.emailVerified ?? false,
      },
      now: new Date(),
    })
  }
}

function normalizeRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`Cannot sync authenticated user without ${label}`)
  }
  return normalized
}

function normalizeEmail(value: string | undefined): string {
  const normalized = normalizeRequiredString(value, 'session.user.email').toLowerCase()
  if (!normalized.includes('@')) {
    throw new Error('Cannot sync authenticated user without a valid email')
  }
  return normalized
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
