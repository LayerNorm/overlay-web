import 'server-only'
import { isAuthorizationCapability, type AuthorizationCapability } from '@overlay/authz-contracts'
import { AdminValidationError } from './guard'

export function choice<const T extends string>(value: unknown, options: readonly T[]): T {
  const selected = options.find((option) => value === option)
  if (!selected) throw new AdminValidationError('Invalid field value')
  return selected
}

export function capabilities(value: unknown): AuthorizationCapability[] {
  if (!Array.isArray(value) || !value.every(isAuthorizationCapability)) throw new AdminValidationError('Invalid capabilities')
  return value
}
