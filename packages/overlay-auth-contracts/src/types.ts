/** Authenticated user identity (provider-agnostic). */
export interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

/** @deprecated Prefer `User`; kept for existing imports. */
export type AuthUser = User

export interface Session {
  accessToken: string
  refreshToken?: string
  user: User
  expiresAt?: number
}

export interface TokenClaims {
  iss: string
  sub: string
  aud?: string | string[]
  exp: number
  iat?: number
  [claim: string]: unknown
}

export interface UserProfile {
  id: string
  email?: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

export interface AuthProvider {
  getSession(req: Request): Promise<Session | null>
  refreshSession?(req: Request): Promise<Session | null>
  signOut?(req: Request): Promise<Response | Headers | void>
  verifyAccessToken(token: string): Promise<TokenClaims | null>
  getUserProfile(token: string): Promise<UserProfile | null>
  deleteUser?(userId: string, req?: Request): Promise<void>
}
