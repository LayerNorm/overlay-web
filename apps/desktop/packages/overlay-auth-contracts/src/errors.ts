export type AuthErrorCode =
  | 'unauthorized'
  | 'invalid_token'
  | 'session_expired'
  | 'configuration'
  | 'forbidden'

export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(message: string, code: AuthErrorCode = 'unauthorized') {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Unauthorized') {
    super(message, 'unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class InvalidTokenError extends AuthError {
  constructor(message = 'Invalid or missing access token') {
    super(message, 'invalid_token')
    this.name = 'InvalidTokenError'
  }
}

export class SessionExpiredError extends AuthError {
  constructor(message = 'Session expired') {
    super(message, 'session_expired')
    this.name = 'SessionExpiredError'
  }
}

export class AuthConfigurationError extends AuthError {
  constructor(message = 'Auth provider is not configured') {
    super(message, 'configuration')
    this.name = 'AuthConfigurationError'
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Forbidden') {
    super(message, 'forbidden')
    this.name = 'ForbiddenError'
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}
