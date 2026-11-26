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

/**
 * An HTML file opened as a page (`?view=page`). It is its own document with its own policy, so its inline scripts run
 * (an iframe given the page inline would inherit the app's nonce-only script policy and run nothing), while the sandbox
 * keeps it on an opaque origin: no same-origin access, cookies, top navigation, popups or downloads.
 */
export const HTML_PAGE_CONTENT_SECURITY_POLICY = [
  'sandbox allow-scripts allow-forms allow-modals',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  'font-src data: https:',
  'connect-src https:',
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ')

export function htmlPageHeaders(name: string): Headers {
  return new Headers({
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'content-security-policy': HTML_PAGE_CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'private, no-store',
  })
}
