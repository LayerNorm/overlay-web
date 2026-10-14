import assert from 'node:assert/strict'
import test from 'node:test'
import { previewHostnameAllowed } from './preview-host'

test('unassigned wildcard hosts cannot serve staging or production', () => {
  for (const lane of [undefined, 'staging', 'production']) {
    assert.equal(previewHostnameAllowed('pr-123.preview.getoverlay.io', lane, 'https://staging.getoverlay.io'), false)
  }
})
test('a preview serves only its canonical PR hostname under the wildcard', () => {
  assert.equal(previewHostnameAllowed('pr-123.preview.getoverlay.io', 'preview', 'https://pr-123.preview.getoverlay.io'), true)
  assert.equal(previewHostnameAllowed('pr-124.preview.getoverlay.io', 'preview', 'https://pr-123.preview.getoverlay.io'), false)
  assert.equal(previewHostnameAllowed('random.preview.getoverlay.io', 'preview', 'https://random.preview.getoverlay.io'), false)
  assert.equal(previewHostnameAllowed('pr-123.preview.getoverlay.io', 'preview', ''), false)
  assert.equal(previewHostnameAllowed('pr-123.preview.getoverlay.io', 'preview', 'http://pr-123.preview.getoverlay.io'), false)
})
test('existing app and generated deployment hosts retain their normal behavior', () => {
  for (const hostname of ['getoverlay.io', 'staging.getoverlay.io', 'localhost', 'deployment.vercel.app']) {
    assert.equal(previewHostnameAllowed(hostname, 'staging', ''), true)
  }
})
