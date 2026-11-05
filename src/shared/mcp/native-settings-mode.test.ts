import { expect, test } from 'vitest'
import { nativeMcpSettingsMode } from './native-settings-mode'

test('native MCP surfaces retain legacy mode only when native auth is disabled', () => {
  expect(nativeMcpSettingsMode({ nativeAuthConfigured: false, hasConvexClient: false })).toBe('legacy')
  expect(nativeMcpSettingsMode({ nativeAuthConfigured: false, hasConvexClient: true })).toBe('legacy')
  expect(nativeMcpSettingsMode({ nativeAuthConfigured: true, hasConvexClient: false })).toBe('unavailable')
  expect(nativeMcpSettingsMode({ nativeAuthConfigured: true, hasConvexClient: true })).toBe('native')
})
