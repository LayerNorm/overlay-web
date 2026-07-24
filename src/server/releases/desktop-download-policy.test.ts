import assert from 'node:assert/strict'
import test from 'node:test'
import { areOfficialDesktopDownloadsEnabled } from './desktop-download-policy'

test('official desktop downloads remain disabled unless explicitly enabled', () => {
  assert.equal(areOfficialDesktopDownloadsEnabled({}), false)
  assert.equal(
    areOfficialDesktopDownloadsEnabled({ OVERLAY_DESKTOP_DOWNLOADS_ENABLED: '0' }),
    false
  )
  assert.equal(
    areOfficialDesktopDownloadsEnabled({ OVERLAY_DESKTOP_DOWNLOADS_ENABLED: 'true' }),
    false
  )
})

test('official desktop downloads require the exact enabled value', () => {
  assert.equal(
    areOfficialDesktopDownloadsEnabled({ OVERLAY_DESKTOP_DOWNLOADS_ENABLED: '1' }),
    true
  )
  assert.equal(
    areOfficialDesktopDownloadsEnabled({ OVERLAY_DESKTOP_DOWNLOADS_ENABLED: ' 1 ' }),
    true
  )
})
