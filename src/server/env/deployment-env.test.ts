import assert from 'node:assert/strict'
import test from 'node:test'
import { deploymentEnv } from './deployment-env'

test('isolated server and browser use the same Convex-injected build URL', () => {
  const built = { appUrl: 'https://pr-123.preview.getoverlay.io', convexUrl: 'https://pr-backend.convex.cloud' }
  const env = { OVERLAY_DEPLOYMENT_ENV: 'preview', NEXT_PUBLIC_CONVEX_URL: 'https://shared.convex.cloud',
    NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io', INTERNAL_API_SECRET: 'fixture' }
  const resolved = deploymentEnv(env, built)
  assert.equal(resolved.NEXT_PUBLIC_CONVEX_URL, built.convexUrl)
  assert.equal(resolved.NEXT_PUBLIC_APP_URL, built.appUrl)
  assert.equal(resolved.INTERNAL_API_SECRET, 'fixture')
  assert.equal(deploymentEnv(env, { ...built, convexUrl: '' }).NEXT_PUBLIC_CONVEX_URL, '')
})

test('dedicated staging captures build URLs while ordinary environments keep runtime overrides', () => {
  const built = { appUrl: 'https://staging.getoverlay.io', convexUrl: 'https://staging-backend.convex.cloud' }
  const env = { OVERLAY_DEPLOYMENT_ENV: 'staging', OVERLAY_RELEASE_LANE: 'staging' }
  assert.equal(deploymentEnv(env, built).NEXT_PUBLIC_CONVEX_URL, built.convexUrl)
  for (const value of ['production', 'development', 'onprem', 'test']) {
    const ordinary = { ...env, OVERLAY_DEPLOYMENT_ENV: value }
    assert.equal(deploymentEnv(ordinary, built), ordinary)
  }
})
