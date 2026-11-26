/**
 * Stored files are served from the app's own origin, so anything a browser could run (an HTML page, SVG, XML or a
 * script) is served under a CSP sandbox: it displays, but runs no script and gets an opaque origin with no access to
 * the app, its cookies or its APIs. Previews in the app render HTML in a sandboxed iframe instead.
 */
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
])

export function applyStoredContentSafetyHeaders(headers: Headers): Headers {
  headers.set('x-content-type-options', 'nosniff')
  const contentType = (headers.get('content-type') ?? '').toLowerCase().split(';')[0]!.trim()
  if (!contentType || ACTIVE_CONTENT_TYPES.has(contentType)) headers.set('content-security-policy', 'sandbox')
  return headers
}
