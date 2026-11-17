import assert from 'node:assert/strict'
import test from 'node:test'
import { detectVisitorPlatform } from './visitor-platform'

const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

test('recognizes a Mac', () => {
  assert.equal(detectVisitorPlatform({ platform: 'MacIntel', userAgent: mac, maxTouchPoints: 0 }), 'mac')
})

test('does not offer the Mac app to an iPad that reports itself as a Mac', () => {
  assert.equal(detectVisitorPlatform({ platform: 'MacIntel', userAgent: mac, maxTouchPoints: 5 }), 'other')
})

test('treats Windows, Linux and phones as other', () => {
  assert.equal(detectVisitorPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), 'other')
  assert.equal(detectVisitorPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 }), 'other')
  assert.equal(detectVisitorPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 }), 'other')
})
