import 'server-only'

import type { Session, User } from '@overlay/app-core'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events'

export type UserAuthProvider = 'workos' | 'better-auth' | 'oidc' | 'none'

export interface UserIdentityInput {
  provider: UserAuthProvider
  subject: string
  email: string
}

export interface UserUpsertInput {
  identity: UserIdentityInput
  user: User
  now: Date
}

export interface UserUpsertResult {
  success: boolean
  isNewUser: boolean
  userId: string
}

export interface UserRepository {
  upsertFromIdentity(input: UserUpsertInput): Promise<UserUpsertResult>
}

export interface UserServiceOptions {
  authProvider: UserAuthProvider
  lifecycleEvents?: LifecycleEventPublisher
  repository: UserRepository
}

export type UserSession = Pick<Session, 'user'>
