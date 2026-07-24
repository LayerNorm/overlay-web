import { basename } from 'node:path'

export const MAX_BROWSER_DOWNLOAD_BYTES = 250 * 1024 * 1024

const SUPPORTED_BROWSER_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'fullscreen',
  'pointerLock'
])

export function isSupportedBrowserPermission(permission: string): boolean {
  return SUPPORTED_BROWSER_PERMISSIONS.has(permission)
}

export function normalizeBrowserPermissionOrigin(input: string): string | null {
  try {
    const url = new URL(input)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function normalizeInteractiveBrowserUrl(input: string): string | null {
  try {
    if (typeof input !== 'string' || input.length > 8192) return null
    const url = new URL(input)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function sanitizeBrowserDownloadFilename(input: string): string {
  const normalized = basename(input.normalize('NFKC'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/:\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180)
  return normalized || 'download'
}
