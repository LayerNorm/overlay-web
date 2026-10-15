import 'server-only'

/** Store a local destination only; URL parsing normalizes authority tricks. */
export function safeReturnTo(value: string | null | undefined, origin: string): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  try {
    const url = new URL(value, origin)
    return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}
