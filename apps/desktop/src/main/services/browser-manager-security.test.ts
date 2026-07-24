import { describe, expect, it } from 'vitest'
import {
  isSupportedBrowserPermission,
  normalizeBrowserPermissionOrigin,
  normalizeInteractiveBrowserUrl,
  sanitizeBrowserDownloadFilename
} from './security/browser-security-policy'

describe('browser manager security policy', () => {
  it('allows only the explicit interactive permission set', () => {
    expect(isSupportedBrowserPermission('media')).toBe(true)
    expect(isSupportedBrowserPermission('geolocation')).toBe(true)
    expect(isSupportedBrowserPermission('openExternal')).toBe(false)
    expect(isSupportedBrowserPermission('unknown')).toBe(false)
  })

  it('binds persisted permissions to exact credential-free HTTP origins', () => {
    expect(normalizeBrowserPermissionOrigin('https://example.com/path')).toBe(
      'https://example.com'
    )
    expect(normalizeBrowserPermissionOrigin('https://user@example.com/path')).toBeNull()
    expect(normalizeBrowserPermissionOrigin('file:///etc/passwd')).toBeNull()
    expect(normalizeBrowserPermissionOrigin('not a url')).toBeNull()
  })

  it('blocks privileged browser navigation schemes and embedded credentials', () => {
    expect(normalizeInteractiveBrowserUrl('https://example.com/path')).toBe(
      'https://example.com/path'
    )
    expect(normalizeInteractiveBrowserUrl('http://localhost:3000/')).toBe(
      'http://localhost:3000/'
    )
    expect(normalizeInteractiveBrowserUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeInteractiveBrowserUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeInteractiveBrowserUrl('https://user:pass@example.com')).toBeNull()
  })

  it('contains untrusted download names to a normalized basename', () => {
    expect(sanitizeBrowserDownloadFilename('../../.ssh/config')).toBe('config')
    expect(sanitizeBrowserDownloadFilename('report\u0000.pdf')).toBe('report.pdf')
    expect(sanitizeBrowserDownloadFilename('．．／secret.txt')).toBe('secret.txt')
  })
})
