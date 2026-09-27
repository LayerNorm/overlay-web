export const API_KEY_SCOPES = [
  'chat:read',
  'chat:write',
  'files:read',
  'files:write',
  'admin',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES)

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && API_KEY_SCOPE_SET.has(value)
}

export function normalizeApiKeyScopes(scopes: readonly unknown[]): ApiKeyScope[] {
  const normalized: ApiKeyScope[] = []
  const seen = new Set<ApiKeyScope>()
  for (const scope of scopes) {
    if (!isApiKeyScope(scope)) {
      throw new Error(`Invalid API key scope: ${String(scope)}`)
    }
    if (!seen.has(scope)) {
      seen.add(scope)
      normalized.push(scope)
    }
  }
  return normalized
}

export function hasRequiredApiKeyScopes(
  grantedScopes: readonly ApiKeyScope[],
  requiredScopes: readonly ApiKeyScope[] | undefined,
): boolean {
  if (!requiredScopes?.length) return true
  if (grantedScopes.includes('admin')) return true

  const granted = new Set(grantedScopes)
  return requiredScopes.every((scope) => granted.has(scope))
}
