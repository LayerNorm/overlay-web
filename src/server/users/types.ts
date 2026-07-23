import 'server-only'

import type { Session, User } from '@overlay/app-core'

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

export type UserDirectoryEntry = {
  id: string
  email: string
  name?: string
  profilePictureUrl?: string
}

export interface UserRepository {
  upsertFromIdentity(input: UserUpsertInput): Promise<UserUpsertResult>
  listDirectory?(): Promise<UserDirectoryEntry[]>
}

export interface UserServiceOptions {
  authProvider: UserAuthProvider
  afterUpsert?: (result: UserUpsertResult) => Promise<void>
  repository: UserRepository
}

export type UserSession = Pick<Session, 'user'>
