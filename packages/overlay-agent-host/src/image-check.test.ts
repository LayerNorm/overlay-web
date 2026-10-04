import assert from 'node:assert/strict'
import test from 'node:test'
import { checkOverlayImage, credentialFilePaths } from './image-check'

const manifest = { imageVersion: 4, hostVersion: '0.3.9', packages: {}, builtAt: '2026-10-01T00:00:00Z' }
const byName = (checks: ReturnType<typeof checkOverlayImage>) => Object.fromEntries(checks.map((check) => [check.name, check.ok]))

test('a prepared image passes every check', () => {
  const checks = checkOverlayImage({ manifest, home: '/home/user', exists: () => false, resolveAgent: () => ({ source: 'installed' }) })
  assert.deepEqual(byName(checks), {
    'image-version': true, 'agent:claude-code': true, 'agent:codex': true, 'credential-free': true,
  })
})

test('missing manifest, unsupported version, missing adapters, and leaked credentials all fail', () => {
  assert.equal(byName(checkOverlayImage({ manifest: null, exists: () => false, resolveAgent: () => ({}) }))['image-version'], false)
  assert.equal(byName(checkOverlayImage({ manifest: { ...manifest, imageVersion: 99 }, exists: () => false, resolveAgent: () => ({}) }))['image-version'], false)
  assert.equal(byName(checkOverlayImage({ manifest, exists: () => false, resolveAgent: () => undefined }))['agent:codex'], false)
  const leaked = checkOverlayImage({ manifest, home: '/home/user', exists: (path) => path.endsWith('.credentials.json'), resolveAgent: () => ({}) })
  assert.equal(byName(leaked)['credential-free'], false)
  assert.ok(credentialFilePaths('/home/user').includes('/home/user/.codex/auth.json'))
})
