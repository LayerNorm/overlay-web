import assert from 'node:assert/strict'
import test from 'node:test'
import { skipDuplicateBuildTypecheck } from './build-typecheck-policy.mjs'

test('only the explicitly selected GitHub compilation lane skips its duplicate typecheck', () => {
  assert.equal(skipDuplicateBuildTypecheck({ GITHUB_ACTIONS: 'true', OVERLAY_SKIP_BUILD_TYPECHECK: '1' }), true)
  for (const env of [{}, { OVERLAY_SKIP_BUILD_TYPECHECK: '1' }, { CI: 'true', OVERLAY_SKIP_BUILD_TYPECHECK: '1' },
    { GITHUB_ACTIONS: 'true' }, { GITHUB_ACTIONS: 'true', OVERLAY_SKIP_BUILD_TYPECHECK: '0' }]) assert.equal(skipDuplicateBuildTypecheck(env), false)
})
test('inherited skip flags cannot bypass types on any hosted environment', () => {
  for (const VERCEL_ENV of ['preview', 'production', 'development']) {
    assert.equal(skipDuplicateBuildTypecheck({ GITHUB_ACTIONS: 'true', VERCEL_ENV, OVERLAY_SKIP_BUILD_TYPECHECK: '1' }), false)
  }
  assert.equal(skipDuplicateBuildTypecheck({ GITHUB_ACTIONS: 'true', VERCEL: '1', OVERLAY_SKIP_BUILD_TYPECHECK: '1' }), false)
})
