import type { ApiKeyScope } from '@/shared/auth/api-key-scopes'

const CHAT_READ_PATHS = new Set([
  '/api/v1/chat-suggestions',
  '/api/v1/link-preview',
])

const CHAT_WRITE_PATHS = new Set([
  '/api/v1/browser-task',
  '/api/v1/generate-image',
  '/api/v1/generate-tab-group-label',
  '/api/v1/generate-title',
  '/api/v1/generate-video',
  '/api/v1/notebook-agent',
])

const FILE_RESOURCE_PREFIXES = [
  '/api/v1/files',
  '/api/v1/notes',
  '/api/v1/outputs',
]

const FILE_READ_POST_PATHS = new Set([
  '/api/v1/files/search-text',
  '/api/v1/knowledge/search',
])

const FILE_WRITE_GET_PATHS = new Set([
  '/api/v1/files/presign',
])

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function isReadMethod(method: string): boolean {
  const normalized = method.toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD'
}

export function getRequiredApiKeyScopesForRoute(
  method: string,
  pathname: string,
): ApiKeyScope[] {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = normalizePath(pathname)

  if (normalizedPath === '/api/v1/conversations' || normalizedPath.startsWith('/api/v1/conversations/')) {
    return [isReadMethod(normalizedMethod) ? 'chat:read' : 'chat:write']
  }
  if (CHAT_READ_PATHS.has(normalizedPath)) {
    return ['chat:read']
  }
  if (CHAT_WRITE_PATHS.has(normalizedPath)) {
    return ['chat:write']
  }

  if (FILE_WRITE_GET_PATHS.has(normalizedPath)) {
    return ['files:write']
  }
  if (FILE_READ_POST_PATHS.has(normalizedPath)) {
    return ['files:read']
  }
  if (FILE_RESOURCE_PREFIXES.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))) {
    return [isReadMethod(normalizedMethod) ? 'files:read' : 'files:write']
  }

  return ['admin']
}
