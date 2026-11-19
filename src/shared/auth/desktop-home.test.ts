import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOverlayDesktopUserAgent } from './desktop-home'

test('recognizes the desktop app window', () => {
  assert.equal(isOverlayDesktopUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Overlay/0.3.1 Chrome/148.0.7778.280 Electron/42.11.18 Safari/537.36'), true)
})

test('treats browsers and other Electron apps as browsers', () => {
  assert.equal(isOverlayDesktopUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'), false)
  assert.equal(isOverlayDesktopUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.41.105 Chrome/130.0 Electron/33.2.0 Safari/537.36'), false)
  assert.equal(isOverlayDesktopUserAgent(null), false)
})
