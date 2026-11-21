import assert from 'node:assert/strict'
import test from 'node:test'
import { previewHostnameAllowed } from './preview-host'

test('unassigned wildcard hosts cannot serve staging or production', () => {
  for (const lane of [undefined, 'staging', 'production']) {
    assert.equal(previewHostnameAllowed('pr-123.preview.overlay.works', lane, 'https://staging.getoverlay.io'), false)
  }
})
test('a preview serves only its canonical PR hostname under the wildcard', () => {
  assert.equal(previewHostnameAllowed('pr-123.preview.overlay.works', 'preview', 'https://pr-123.preview.overlay.works'), true)
  assert.equal(previewHostnameAllowed('pr-124.preview.overlay.works', 'preview', 'https://pr-123.preview.overlay.works'), false)
  assert.equal(previewHostnameAllowed('random.preview.overlay.works', 'preview', 'https://random.preview.overlay.works'), false)
  assert.equal(previewHostnameAllowed('pr-123.preview.overlay.works', 'preview', ''), false)
  assert.equal(previewHostnameAllowed('pr-123.preview.overlay.works', 'preview', 'http://pr-123.preview.overlay.works'), false)
})
test('existing app and generated deployment hosts retain their normal behavior', () => {
  for (const hostname of ['overlay.works', 'staging.getoverlay.io', 'localhost', 'deployment.vercel.app']) {
    assert.equal(previewHostnameAllowed(hostname, 'staging', ''), true)
  }
})
