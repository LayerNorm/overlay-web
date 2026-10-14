import assert from 'node:assert/strict'
import test from 'node:test'
import { previewOrigin } from './preview-origin'

test('preview OAuth uses the configured PR origin instead of generated Vercel URLs', () => {
  const env = { VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
    VERCEL_GIT_PULL_REQUEST_ID: '123', NEXT_PUBLIC_APP_URL: 'https://pr-123.preview.getoverlay.io',
    VERCEL_BRANCH_URL: 'wrong.vercel.app' }
  assert.equal(previewOrigin(env), env.NEXT_PUBLIC_APP_URL)
  for (const url of ['', 'http://pr-123.preview.getoverlay.io',
    'https://staging.getoverlay.io', 'https://wrong.vercel.app',
    'https://pr-124.preview.getoverlay.io', 'https://pr-123.preview.getoverlay.io/path',
    'https://pr-123.preview.getoverlay.io.evil.test']) {
    assert.throws(() => previewOrigin({ ...env, NEXT_PUBLIC_APP_URL: url }))
  }
  assert.throws(() => previewOrigin({ ...env, VERCEL_ENV: 'production' }))
})

test('local, staging, and production retain their configured origins', () => {
  for (const environment of ['development', 'staging', 'production', 'onprem', undefined]) {
    assert.equal(previewOrigin({ OVERLAY_DEPLOYMENT_ENV: environment }), undefined)
  }
})
