export interface AppApiRequestInput {
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export type NormalizedAppApiRequest = Required<AppApiRequestInput>

const APP_API_ROUTE_METHODS = new Map<string, ReadonlySet<string>>([
  ['/api/v1/projects', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/conversations', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/conversations/message', new Set(['POST', 'PATCH'])],
  ['/api/v1/conversations/act', new Set(['POST'])],
  ['/api/v1/files', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/files/upload-url', new Set(['POST'])],
  ['/api/v1/notes', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/memory', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/settings', new Set(['GET', 'PATCH'])],
  ['/api/v1/integrations', new Set(['GET', 'POST', 'DELETE'])],
  ['/api/v1/skills', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/mcps', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/mcps/test', new Set(['POST'])],
  ['/api/v1/automations', new Set(['GET', 'POST', 'PATCH', 'DELETE'])],
  ['/api/v1/generate-title', new Set(['POST'])],
  ['/api/v1/generate-image', new Set(['POST'])],
  ['/api/v1/generate-video', new Set(['POST'])],
  ['/api/v1/notebook-agent', new Set(['POST'])],
  ['/api/v1/outputs', new Set(['GET', 'PATCH', 'DELETE'])],
  ['/api/v1/bootstrap', new Set(['GET'])],
  ['/api/subscription/settings', new Set(['GET', 'PATCH'])]
])
const STREAM_APP_API_ROUTES = new Set([
  'POST /api/v1/conversations/act',
  'POST /api/v1/generate-video'
])
const FORBIDDEN_FORWARD_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'x-overlay-service-auth',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'trailer',
  'te',
  'origin',
  'referer'
])

export function normalizeAppApiInput(
  input: AppApiRequestInput,
  options: { stream?: boolean } = {}
): NormalizedAppApiRequest {
  if (!input || typeof input.path !== 'string') {
    throw new Error('Invalid app API request')
  }

  const path = normalizeBackendPath(input.path)
  const method = (input.method || 'GET').toUpperCase()
  const pathname = path.split('?')[0] || '/'
  if (options.stream && !STREAM_APP_API_ROUTES.has(`${method} ${pathname}`)) {
    throw new Error(`Unsupported app API stream path: ${path}`)
  }
  const allowedMethods =
    APP_API_ROUTE_METHODS.get(pathname) ??
    (/^\/api\/v1\/(?:files|outputs)\/[A-Za-z0-9_-]{1,512}\/content$/.test(pathname)
      ? new Set(['GET'])
      : undefined)
  if (!allowedMethods?.has(method)) {
    throw new Error(`Unsupported app API route: ${method} ${pathname}`)
  }
  return {
    path,
    method,
    headers: headersToRecord(sanitizeForwardedHeaders(input.headers)),
    body: input.body ?? null
  }
}

export function normalizeBackendPath(path: string): string {
  const trimmed = path.trim()
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /%(2e|2f|5c)/i.test(trimmed) ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new Error('Invalid app API path')
  }

  const parsed = new URL(trimmed, 'https://overlay.local')
  if (parsed.origin !== 'https://overlay.local' || parsed.hash) {
    throw new Error('Invalid app API path')
  }
  return `${parsed.pathname}${parsed.search}`
}

export function sanitizeForwardedHeaders(headersInit: Record<string, string> | undefined): Headers {
  const headers = new Headers(headersInit || {})
  const sanitized = new Headers()
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (FORBIDDEN_FORWARD_HEADERS.has(normalizedKey)) return
    if (normalizedKey.startsWith('proxy-') || normalizedKey.startsWith('sec-')) return
    sanitized.set(key, value)
  })
  return sanitized
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

export function isFirstPartyBackendPath(path: string): boolean {
  return APP_API_ROUTE_METHODS.has(path)
}

export function isBinaryContentPath(path: string): boolean {
  try {
    return new URL(path, 'https://overlay.local').pathname.endsWith('/content')
  } catch {
    return path.endsWith('/content')
  }
}

export function appApiPathForLog(path: string): string {
  try {
    return new URL(path, 'https://overlay.local').pathname
  } catch {
    return '[invalid-path]'
  }
}

export function shouldRecoverAppApiAuthentication(response: Response): boolean {
  if (response.status !== 401) return false
  const challenge = response.headers.get('www-authenticate')?.toLowerCase() ?? ''
  return challenge.includes('bearer') && challenge.includes('error="invalid_token"')
}

export function shouldProbeLegacyBearerUserId(path: string, response: Response): boolean {
  if (response.status !== 401 || appApiPathForLog(path) !== '/api/v1/bootstrap') return false
  return !response.headers.has('www-authenticate')
}
