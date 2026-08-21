/**
 * Whether a page's response headers permit framing it in the link preview panel.
 *
 * Kept separate from the route so it can be tested without a request context.
 */
export function framedByHeaders(headers: Headers, appOrigin: string): boolean {
  const xfo = headers.get('x-frame-options')?.trim().toLowerCase()
  // SAMEORIGIN and DENY both exclude us; ALLOW-FROM is obsolete and ignored by
  // modern browsers, which fall back to blocking.
  if (xfo && (xfo.startsWith('deny') || xfo.startsWith('sameorigin') || xfo.startsWith('allow-from'))) {
    return false
  }

  const csp = headers.get('content-security-policy')
  if (!csp) return true
  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('frame-ancestors'))
  if (!directive) return true

  const sources = directive.split(/\s+/).slice(1).map((value) => value.toLowerCase().replace(/^'|'$/g, ''))
  if (sources.length === 0 || sources.includes('none')) return false
  return sources.some((source) => (
    source === '*' ||
    source === 'https:' ||
    source === appOrigin.toLowerCase() ||
    (source.startsWith('*.') && appOrigin.toLowerCase().endsWith(source.slice(1)))
  ))
}
